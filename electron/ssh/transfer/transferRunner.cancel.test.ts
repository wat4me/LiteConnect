import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { TransferRunner } from './transferRunner'
import type { Session } from '../types'
import { TransferCancelledError } from './transferHelpers'
import { MonotonicByteProgress } from './transferHelpers'

function mockReadable() {
  const s = new EventEmitter() as EventEmitter & {
    destroy: ReturnType<typeof vi.fn>
    pipe: ReturnType<typeof vi.fn>
  }
  s.destroy = vi.fn()
  s.pipe = vi.fn(function (this: any, dest: any) {
    setImmediate(() => dest.emit('finish'))
    return dest
  })
  return s
}

function mockWritable() {
  const s = new EventEmitter() as EventEmitter & {
    destroy: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }
  s.destroy = vi.fn()
  s.close = vi.fn()
  return s
}

describe('TransferRunner cancel race (P0)', () => {
  it('does not create streams after parent cancel during delayed stat', async () => {
    let statCb: ((err: Error | null, stats?: { size: number }) => void) | null = null
    const createReadStream = vi.fn(() => mockReadable())
    const createWriteStream = vi.fn(() => mockWritable())

    const sftp = {
      stat: (_p: string, cb: (err: Error | null, stats?: { size: number }) => void) => {
        statCb = cb
      },
      createReadStream,
      createWriteStream,
    }

    const session: Session = {
      id: 'sess-1',
      client: {} as any,
      stream: {} as any,
      connectionId: 'c1',
      connectionName: 't',
      sftp: sftp as any,
    }

    const runner = new TransferRunner(() => session, {
      initSftp: async () => {},
      sftpReaddir: async () => [],
      sftpExists: async () => false,
      sftpMkdir: async () => {},
    })

    const parentId = 'dir-job-1'
    runner.map.set(parentId, {
      sessionId: 'sess-1',
      cancelled: false,
      childIds: new Set(['child-1']),
      keepPartial: true,
    })

    const isCancelled = () => runner.map.get(parentId)?.cancelled === true
    const localPath = path.join(os.tmpdir(), `litesh-cancel-${Date.now()}.bin`)

    const downloadP = runner.sftpDownload(
      'sess-1',
      '/remote/a.txt',
      localPath,
      'child-1',
      () => {},
      { isCancelled },
    )

    runner.cancelTransfer(parentId)
    expect(isCancelled()).toBe(true)
    expect(statCb).toBeTruthy()
    statCb!(null, { size: 100 })

    await expect(downloadP).rejects.toBeInstanceOf(TransferCancelledError)
    expect(createReadStream).not.toHaveBeenCalled()
    expect(createWriteStream).not.toHaveBeenCalled()
    expect(runner.map.has('child-1')).toBe(false)
  })

  it('upload resume path checks cancel before startUpload after delayed stat', async () => {
    let statCb: ((err: Error | null, stats?: { size: number }) => void) | null = null
    const createReadStream = vi.fn(() => mockReadable())
    const createWriteStream = vi.fn(() => mockWritable())
    const localPath = path.join(os.tmpdir(), `litesh-up-${Date.now()}.bin`)
    fs.writeFileSync(localPath, Buffer.alloc(200))

    const sftp = {
      stat: (_p: string, cb: (err: Error | null, stats?: { size: number }) => void) => {
        statCb = cb
      },
      createReadStream,
      createWriteStream,
    }

    const session: Session = {
      id: 'sess-1',
      client: {} as any,
      stream: {} as any,
      connectionId: 'c1',
      connectionName: 't',
      sftp: sftp as any,
    }

    const runner = new TransferRunner(() => session, {
      initSftp: async () => {},
      sftpReaddir: async () => [],
      sftpExists: async () => false,
      sftpMkdir: async () => {},
    })

    let cancelled = false
    const uploadP = runner.sftpUpload(
      'sess-1',
      localPath,
      '/remote/a.txt',
      'up-1',
      () => {},
      { resume: true, isCancelled: () => cancelled },
    )

    cancelled = true
    expect(statCb).toBeTruthy()
    statCb!(null, { size: 50 })

    await expect(uploadP).rejects.toBeInstanceOf(TransferCancelledError)
    expect(createReadStream).not.toHaveBeenCalled()
    expect(createWriteStream).not.toHaveBeenCalled()
    expect(runner.map.size).toBe(0)

    try {
      fs.unlinkSync(localPath)
    } catch {}
  })
})

describe('empty directory byte total', () => {
  it('MonotonicByteProgress keeps 0/0 for empty total', () => {
    const p = new MonotonicByteProgress(0)
    expect(p.current).toBe(0)
    expect(p.complete()).toBe(0)
    expect(p.current).toBe(0)
  })

  it('download empty remote dir returns completed with total 0', async () => {
    const session: Session = {
      id: 'sess-1',
      client: {} as any,
      stream: {} as any,
      connectionId: 'c1',
      connectionName: 't',
      sftp: {} as any,
    }

    const runner = new TransferRunner(() => session, {
      initSftp: async () => {},
      sftpReaddir: async () => [],
      sftpExists: async () => false,
      sftpMkdir: async () => {},
    })

    const out = path.join(os.tmpdir(), `litesh-empty-${Date.now()}`)
    const reports: Array<{ t: number; total: number }> = []

    try {
      const result = await runner.sftpDownloadDirectory(
        'sess-1',
        '/empty',
        out,
        'dl-empty',
        (transferred, total) => {
          reports.push({ t: transferred, total })
        },
      )
      expect(result.status).toBe('completed')
      expect(result.stats.totalFiles).toBe(0)
      expect(reports.every((r) => r.total === 0 && r.t === 0)).toBe(true)
      expect(runner.map.size).toBe(0)
    } finally {
      try {
        fs.rmSync(out, { recursive: true, force: true })
      } catch {}
    }
  })
})

describe('single-file transfer cleanup', () => {
  function runnerFor(sftp: any) {
    const session: Session = {
      id: 'sess-1',
      client: {} as any,
      stream: {} as any,
      connectionId: 'c1',
      connectionName: 't',
      sftp,
    }
    return new TransferRunner(() => session, {
      initSftp: async () => {},
      sftpReaddir: async () => [],
      sftpExists: async () => false,
      sftpMkdir: async () => {},
    })
  }

  it('removes a completed download from the active transfer map', async () => {
    const read = mockReadable()
    const sftp = {
      stat: (_path: string, cb: any) => cb(null, { size: 3 }),
      createReadStream: vi.fn(() => read),
    }
    const output = path.join(os.tmpdir(), `litesh-complete-${Date.now()}.txt`)
    const runner = runnerFor(sftp)
    const progress: number[] = []

    try {
      await runner.sftpDownload('sess-1', '/remote/file', output, 'done-1', (bytes) => progress.push(bytes))
      expect(runner.map.has('done-1')).toBe(false)
      expect(sftp.createReadStream).toHaveBeenCalledOnce()
      expect(progress).toEqual([])
    } finally {
      try { fs.unlinkSync(output) } catch {}
    }
  })

  it('cleans up an errored download and does not retain its transfer entry', async () => {
    const read = mockReadable()
    read.pipe.mockImplementation(() => {
      setImmediate(() => read.emit('error', new Error('network lost')))
      return {} as any
    })
    const sftp = {
      stat: (_path: string, cb: any) => cb(null, { size: 3 }),
      createReadStream: vi.fn(() => read),
    }
    const output = path.join(os.tmpdir(), `litesh-failed-${Date.now()}.txt`)
    const runner = runnerFor(sftp)

    try {
      await expect(runner.sftpDownload('sess-1', '/remote/file', output, 'fail-1', () => {}, { keepPartial: false }))
        .rejects.toThrow('Download error: network lost')
      expect(runner.map.has('fail-1')).toBe(false)
    } finally {
      try { fs.unlinkSync(output) } catch {}
    }
  })
})
