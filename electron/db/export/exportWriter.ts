import { createWriteStream, promises as fsp } from 'fs'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import type { WriteStream } from 'fs'
import { serializeCell, isBlobPlaceholder, BLOB_PLACEHOLDER_PREFIX } from '../common'

export type DbExportFormat = 'csv' | 'jsonl'

export type DbExportProgress = {
  exportId: string
  rowsWritten: number
  bytesWritten: number
  phase: 'running' | 'finalizing' | 'done' | 'cancelled' | 'error'
  error?: string
}

/** CSV cell: quotes, newlines, NULL, BigInt, binary placeholder. */
export function formatCsvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  let s = String(value)
  if (s.startsWith(BLOB_PLACEHOLDER_PREFIX) || isBlobPlaceholder(s)) {
    // fall through
  }
  const needsQuote =
    s.includes('"')
    || s.includes(',')
    || s.includes('\n')
    || s.includes('\r')
    || s.includes('\t')
  if (needsQuote) {
    s = `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function formatCsvRow(columns: string[], row: Record<string, unknown>): string {
  return columns.map((c) => formatCsvCell(row[c])).join(',') + '\n'
}

export function formatCsvHeader(columns: string[]): string {
  return columns.map((c) => formatCsvCell(c)).join(',') + '\n'
}

export function formatJsonlRow(columns: string[], row: Record<string, unknown>): string {
  const obj: Record<string, unknown> = {}
  for (const c of columns) {
    let v = row[c]
    if (typeof v === 'bigint') v = v.toString()
    obj[c] = v === undefined ? null : v
  }
  return JSON.stringify(obj) + '\n'
}

export function exportSerializeCell(value: unknown, column?: string): unknown {
  return serializeCell(value, column ? { column } : undefined)
}

export type TempExportFile = {
  finalPath: string
  tempPath: string
  cleanup: () => Promise<void>
  finalize: () => Promise<void>
}

async function unlinkWithRetry(path: string, attempts = 8): Promise<void> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      await fsp.unlink(path)
      return
    } catch (err: any) {
      last = err
      if (err?.code === 'ENOENT') return
      // Windows: EBUSY / EPERM while handle still closing
      await new Promise((r) => setTimeout(r, 20 * (i + 1)))
    }
  }
  void last
}

export async function createTempExportFile(finalPath: string): Promise<TempExportFile> {
  if (typeof finalPath !== 'string' || !finalPath.trim()) {
    throw new Error('Invalid export path')
  }
  const dir = dirname(finalPath)
  await fsp.mkdir(dir, { recursive: true })
  const token = randomBytes(8).toString('hex')
  const tempPath = join(dir, `.litesh-export-${token}.tmp`)
  return {
    finalPath,
    tempPath,
    async cleanup() {
      await unlinkWithRetry(tempPath)
    },
    async finalize() {
      await fsp.rename(tempPath, finalPath)
    },
  }
}

export type ExportWriteHandle = {
  stream: WriteStream
  getBytesWritten: () => number
  end: () => Promise<void>
  destroy: () => Promise<void>
  isClosed: () => boolean
  /** Resolves when fd is open (or already closed/errored). */
  whenReady: () => Promise<void>
}

export function openExportWriteStream(tempPath: string): ExportWriteHandle {
  let bytes = 0
  let closed = false
  let opened = false
  let openError: Error | null = null

  const stream = createWriteStream(tempPath, { encoding: 'utf8', flags: 'w' })

  const ready = new Promise<void>((resolve) => {
    stream.once('open', () => {
      opened = true
      resolve()
    })
    stream.once('error', (err) => {
      openError = err
      // may fire before open
      resolve()
    })
  })

  const origWrite = stream.write.bind(stream)
  ;(stream as any).write = (chunk: any, encoding?: any, cb?: any) => {
    if (typeof chunk === 'string') bytes += Buffer.byteLength(chunk, 'utf8')
    else if (Buffer.isBuffer(chunk)) bytes += chunk.length
    return origWrite(chunk, encoding, cb)
  }

  const markClosed = () => {
    closed = true
  }

  stream.on('close', markClosed)

  const waitUntilClosed = (): Promise<void> => {
    if (closed || stream.destroyed || (stream as any).closed) {
      closed = true
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const done = () => {
        closed = true
        resolve()
      }
      stream.once('close', done)
      const t = setTimeout(done, 8_000)
      if (typeof t === 'object' && t && 'unref' in t) (t as NodeJS.Timeout).unref?.()
    })
  }

  return {
    stream,
    getBytesWritten: () => bytes,
    isClosed: () => closed || stream.destroyed || !!(stream as any).closed,
    whenReady: () => ready.then(() => {
      if (openError && !opened) throw openError
    }),
    async end() {
      await ready.catch(() => {})
      if (closed || stream.destroyed) {
        closed = true
        return
      }
      await new Promise<void>((resolve) => {
        stream.end(() => resolve())
        stream.once('error', () => resolve())
      })
      await waitUntilClosed()
    },
    async destroy() {
      await ready.catch(() => {})
      if (closed) return
      if (!stream.destroyed) {
        try {
          // Prefer destroy with callback when available
          await new Promise<void>((resolve) => {
            const done = () => resolve()
            stream.once('close', done)
            try {
              stream.destroy()
            } catch {
              done()
              return
            }
            const t = setTimeout(done, 8_000)
            if (typeof t === 'object' && t && 'unref' in t) (t as NodeJS.Timeout).unref?.()
          })
        } catch {}
      } else {
        await waitUntilClosed()
      }
      closed = true
    },
  }
}

export async function writeStreamChunk(
  stream: NodeJS.WritableStream,
  chunk: string,
): Promise<void> {
  if (!chunk) return
  if ((stream as any).destroyed || (stream as any).writableEnded) {
    throw Object.assign(new Error('Export write stream closed'), { code: 'EXPORT_STREAM_CLOSED' })
  }
  const ok = stream.write(chunk)
  if (!ok) {
    await new Promise<void>((resolve, reject) => {
      const onDrain = () => {
        cleanup()
        resolve()
      }
      const onError = (err: Error) => {
        cleanup()
        reject(err)
      }
      const cleanup = () => {
        stream.off('drain', onDrain)
        stream.off('error', onError)
      }
      stream.once('drain', onDrain)
      stream.once('error', onError)
    })
  }
}

export function endWriteStream(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end(() => resolve())
    stream.once('error', reject)
  })
}

export async function destroyWriteStream(stream: NodeJS.WritableStream): Promise<void> {
  const s = stream as WriteStream
  if (s.destroyed || (s as any).closed) return
  await new Promise<void>((resolve) => {
    const done = () => resolve()
    s.once('close', done)
    try {
      s.destroy()
    } catch {
      done()
      return
    }
    const t = setTimeout(done, 8_000)
    if (typeof t === 'object' && t && 'unref' in t) (t as NodeJS.Timeout).unref?.()
  })
}
