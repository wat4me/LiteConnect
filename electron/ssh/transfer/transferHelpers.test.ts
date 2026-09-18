import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  joinRemoteRelative,
  MonotonicByteProgress,
  runPool,
  sanitizeTransferError,
  TransferCancelledError,
  walkLocalTree,
} from './transferHelpers'

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
}

describe('walkLocalTree', () => {
  it('walks nested files asynchronously and reports totalSize', async () => {
    const root = tmpDir('litesh-walk-')
    try {
      writeFile(path.join(root, 'a.txt'), 'aa')
      writeFile(path.join(root, 'sub', 'b.txt'), 'bbbb')
      writeFile(path.join(root, 'sub', 'deep', 'c.txt'), 'c')

      const result = await walkLocalTree(root, { concurrency: 2, yieldEvery: 1 })
      const rels = result.files.map((f) => f.relativePosix).sort()
      expect(rels).toEqual(['a.txt', 'sub/b.txt', 'sub/deep/c.txt'])
      expect(result.totalSize).toBe(2 + 4 + 1)
      expect(result.dirs.map((d) => d.relativePosix).sort()).toEqual(['sub', 'sub/deep'])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips symlinks (no follow / no cycle)', async () => {
    const root = tmpDir('litesh-symlink-')
    try {
      writeFile(path.join(root, 'real.txt'), 'hello')
      const linkFile = path.join(root, 'link.txt')
      const linkDir = path.join(root, 'linkdir')
      try {
        fs.symlinkSync(path.join(root, 'real.txt'), linkFile)
        fs.symlinkSync(root, linkDir)
      } catch {
        // Windows without admin/dev mode may fail symlink creation
        return
      }

      const result = await walkLocalTree(root)
      expect(result.files.map((f) => f.relativePosix)).toEqual(['real.txt'])
      expect(result.files.some((f) => f.relativePosix.includes('link'))).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('supports cancel during scan', async () => {
    const root = tmpDir('litesh-cancel-walk-')
    try {
      for (let i = 0; i < 40; i++) {
        writeFile(path.join(root, `d${i}`, 'f.txt'), 'x')
      }
      let cancelled = false
      setTimeout(() => {
        cancelled = true
      }, 0)

      await expect(
        walkLocalTree(root, {
          concurrency: 2,
          yieldEvery: 1,
          isCancelled: () => cancelled,
        }),
      ).rejects.toBeInstanceOf(TransferCancelledError)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('yields to the event loop during large scans', async () => {
    const root = tmpDir('litesh-yield-')
    try {
      for (let i = 0; i < 80; i++) {
        writeFile(path.join(root, `f${i}.txt`), 'z')
      }
      let ticks = 0
      const timer = setInterval(() => {
        ticks++
      }, 1)

      await walkLocalTree(root, { concurrency: 4, yieldEvery: 8 })
      clearInterval(timer)
      expect(ticks).toBeGreaterThan(0)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('runPool', () => {
  it('respects concurrency upper bound', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const items = Array.from({ length: 20 }, (_, i) => i)

    await runPool(
      items,
      async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((r) => setTimeout(r, 15))
        inFlight--
      },
      { concurrency: 3 },
    )

    expect(maxInFlight).toBeLessThanOrEqual(3)
    expect(maxInFlight).toBeGreaterThan(1)
  })

  it('stops scheduling on first error when stopOnError', async () => {
    const started: number[] = []
    const items = [0, 1, 2, 3, 4, 5]

    await expect(
      runPool(
        items,
        async (item) => {
          started.push(item)
          await new Promise((r) => setTimeout(r, 5))
          if (item === 1) throw new Error('boom')
        },
        { concurrency: 2, stopOnError: true },
      ),
    ).rejects.toThrow('boom')

    // Not all items should start after stop
    expect(started.length).toBeLessThan(items.length)
  })

  it('continues on error when stopOnError=false', async () => {
    const items = [0, 1, 2, 3]
    const result = await runPool(
      items,
      async (item) => {
        if (item === 1 || item === 2) throw new Error(`fail-${item}`)
      },
      { concurrency: 2, stopOnError: false },
    )
    expect(result.failed).toBe(2)
    expect(result.completed).toBe(2)
    expect(result.errors).toHaveLength(2)
  })

  it('cancels and rejects TransferCancelledError', async () => {
    let cancelled = false
    const items = Array.from({ length: 30 }, (_, i) => i)

    const p = runPool(
      items,
      async () => {
        await new Promise((r) => setTimeout(r, 20))
      },
      { concurrency: 2, isCancelled: () => cancelled },
    )
    setTimeout(() => {
      cancelled = true
    }, 10)

    await expect(p).rejects.toBeInstanceOf(TransferCancelledError)
  })
})

describe('MonotonicByteProgress', () => {
  it('never exceeds total and never decreases', () => {
    const p = new MonotonicByteProgress(100)
    expect(p.add(40)).toBe(40)
    expect(p.add(30)).toBe(70)
    expect(p.add(50)).toBe(100)
    expect(p.add(10)).toBe(100)
    expect(p.current).toBe(100)
  })

  it('aggregates concurrent deltas monotonically', () => {
    const p = new MonotonicByteProgress(1000)
    const reports: number[] = []
    for (const d of [100, 50, 200, 0, -5, 300]) {
      reports.push(p.add(d))
    }
    for (let i = 1; i < reports.length; i++) {
      expect(reports[i]).toBeGreaterThanOrEqual(reports[i - 1])
    }
    expect(reports[reports.length - 1]).toBeLessThanOrEqual(1000)
  })

  it('complete forces total', () => {
    const p = new MonotonicByteProgress(50)
    p.add(10)
    expect(p.complete()).toBe(50)
  })

  it('empty total stays 0/0', () => {
    const p = new MonotonicByteProgress(0)
    expect(p.add(0)).toBe(0)
    expect(p.complete()).toBe(0)
  })
})

describe('joinRemoteRelative / sanitizeTransferError', () => {
  it('joins remote relative paths', () => {
    expect(joinRemoteRelative('/home/u', 'a/b.txt')).toBe('/home/u/a/b.txt')
    expect(joinRemoteRelative('/', 'a')).toBe('/a')
    expect(joinRemoteRelative('/root', '')).toBe('/root')
  })

  it('redacts user paths', () => {
    expect(sanitizeTransferError(new Error('Cannot read C:\\Users\\alice\\file'))).toContain(
      '%USERPROFILE%',
    )
    expect(sanitizeTransferError(new Error('fail /home/bob/x'))).toContain('/home/*')
  })
})
