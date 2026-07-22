import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DbExportService } from './exportService'
import type { DatabaseManager } from './manager'

/**
 * Real filesystem + mocked driver stream — covers writer close before unlink (Windows).
 */
describe('DbExportService resource cleanup', () => {
  let dir: string
  let finalPath: string
  let exportImpl: DatabaseManager['exportTableStream']

  beforeEach(async () => {
    dir = await fsp.mkdtemp(join(tmpdir(), 'litesh-export-'))
    finalPath = join(dir, 'out.csv')
  })

  afterEach(async () => {
    try {
      const files = await fsp.readdir(dir)
      for (const f of files) {
        await fsp.unlink(join(dir, f)).catch(() => {})
      }
      await fsp.rmdir(dir).catch(() => {})
    } catch {}
  })

  function makeService() {
    const dbManager = {
      exportTableStream: (...args: any[]) => (exportImpl as any)(...args),
    } as unknown as DatabaseManager
    return new DbExportService(dbManager, () => null)
  }

  async function listDir() {
    return fsp.readdir(dir)
  }

  it('success: ends writer, renames temp → final, clears active', async () => {
    exportImpl = async (_sid, _db, _table, opts) => {
      await opts.onColumns?.(['id', 'name'])
      await opts.onRow({ id: 1, name: 'a' }, ['id', 'name'])
      await opts.onRow({ id: 2, name: 'b' }, ['id', 'name'])
      return { columns: ['id', 'name'], rowsWritten: 2, truncated: false }
    }
    const svc = makeService()
    const res = await svc.exportTableToPath(
      { sessionId: '00000000-0000-4000-8000-000000000001', database: 'db', table: 't' },
      finalPath,
    )
    expect(res.ok).toBe(true)
    expect(res.rowsWritten).toBe(2)
    expect(svc.getActiveCount()).toBe(0)
    const files = await listDir()
    expect(files).toContain('out.csv')
    expect(files.every((f) => !f.endsWith('.tmp'))).toBe(true)
    const body = await fsp.readFile(finalPath, 'utf8')
    expect(body).toContain('id,name')
    expect(body).toContain('1,a')
  })

  it('driver throw: destroys writer, deletes temp, no final file, active cleared', async () => {
    exportImpl = async (_sid, _db, _table, opts) => {
      await opts.onColumns?.(['id'])
      await opts.onRow({ id: 1 }, ['id'])
      throw new Error('driver boom password=secret')
    }
    const svc = makeService()
    const res = await svc.exportTableToPath(
      { sessionId: '00000000-0000-4000-8000-000000000001', database: 'db', table: 't' },
      finalPath,
    )
    expect(res.ok).toBe(false)
    expect(res.cancelled).toBeFalsy()
    expect(res.error).toBeTruthy()
    expect(res.error).not.toContain('secret')
    expect(svc.getActiveCount()).toBe(0)
    const files = await listDir()
    expect(files).not.toContain('out.csv')
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('user cancel mid-stream: destroy writer, unlink temp, active cleared', async () => {
    const svc = makeService()
    let exportIdSeen: string | null = null
    exportImpl = async (_sid, _db, _table, opts) => {
      await opts.onColumns?.(['id'])
      for (let i = 0; i < 50; i++) {
        if (opts.isCancelled()) {
          throw Object.assign(new Error('Export cancelled'), { code: 'EXPORT_CANCELLED' })
        }
        await opts.onRow({ id: i }, ['id'])
        if (i === 2) {
          // cancel after a few rows — service.cancel needs exportId from active map
          const ids = [...(svc as any).active.keys()] as string[]
          exportIdSeen = ids[0] || null
          if (exportIdSeen) svc.cancel(exportIdSeen)
        }
      }
      if (opts.isCancelled()) {
        throw Object.assign(new Error('Export cancelled'), { code: 'EXPORT_CANCELLED' })
      }
      return { columns: ['id'], rowsWritten: 50, truncated: false }
    }
    const res = await svc.exportTableToPath(
      { sessionId: '00000000-0000-4000-8000-000000000001', database: 'db', table: 't' },
      finalPath,
    )
    expect(res.ok).toBe(false)
    expect(res.cancelled).toBe(true)
    expect(exportIdSeen).toBeTruthy()
    expect(svc.hasActive(exportIdSeen!)).toBe(false)
    expect(svc.getActiveCount()).toBe(0)
    const files = await listDir()
    expect(files).not.toContain('out.csv')
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('onRow / write failure: destroy writer, unlink temp', async () => {
    exportImpl = async (_sid, _db, _table, opts) => {
      await opts.onColumns?.(['id'])
      await opts.onRow({ id: 1 }, ['id'])
      // Simulate writer failure by destroying stream mid-flight via throwing from onRow
      // after a fake write error
      throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })
    }
    const svc = makeService()
    const res = await svc.exportTableToPath(
      { sessionId: '00000000-0000-4000-8000-000000000001', database: 'db', table: 't' },
      finalPath,
    )
    expect(res.ok).toBe(false)
    expect(svc.getActiveCount()).toBe(0)
    const files = await listDir()
    expect(files).not.toContain('out.csv')
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('writeStreamChunk after destroy rejects; cleanup still unlinks', async () => {
    let wrote = 0
    exportImpl = async (_sid, _db, _table, opts) => {
      await opts.onColumns?.(['id'])
      await opts.onRow({ id: 1 }, ['id'])
      wrote = 1
      // Force cancel so service destroys writer while driver still tries a row
      const ids = [...(svc as any).active.keys()] as string[]
      if (ids[0]) svc.cancel(ids[0])
      try {
        await opts.onRow({ id: 2 }, ['id'])
      } catch (e: any) {
        throw Object.assign(e || new Error('cancelled'), { code: 'EXPORT_CANCELLED' })
      }
      return { columns: ['id'], rowsWritten: wrote, truncated: false }
    }
    const svc = makeService()
    const res = await svc.exportTableToPath(
      { sessionId: '00000000-0000-4000-8000-000000000001', database: 'db', table: 't' },
      finalPath,
    )
    expect(res.ok).toBe(false)
    expect(res.cancelled).toBe(true)
    expect(svc.getActiveCount()).toBe(0)
    const files = await listDir()
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('openExportWriteStream destroy before unlink', () => {
  it('destroy closes fd so unlink succeeds', async () => {
    const { openExportWriteStream, createTempExportFile } = await import('./exportWriter')
    const dir = await fsp.mkdtemp(join(tmpdir(), 'litesh-w-'))
    const finalPath = join(dir, 'x.csv')
    const temp = await createTempExportFile(finalPath)
    const w = openExportWriteStream(temp.tempPath)
    w.stream.write('hello\n')
    await w.destroy()
    expect(w.isClosed()).toBe(true)
    await temp.cleanup()
    await expect(fsp.access(temp.tempPath)).rejects.toBeTruthy()
    await fsp.rmdir(dir).catch(() => {})
  })
})
