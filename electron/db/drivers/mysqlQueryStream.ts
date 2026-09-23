import type mysql from 'mysql2/promise'
import type { FieldPacket, RowDataPacket } from 'mysql2/promise'
import { cancelledError, serializeCell } from '../common'
import type { DbQueryResult } from '../types'

/** Consume at most maxRows while ensuring a partially read connection is discarded. */
export function queryStreamCapped(
  conn: mysql.PoolConnection,
  sql: string,
  maxRows: number,
  timeoutMs: number,
  start: number,
  isCancelled: () => boolean,
): Promise<{ result: DbQueryResult; connectionReusable: boolean }> {
  return new Promise((resolve, reject) => {
    const rows: Record<string, unknown>[] = []
    let columns: string[] = []
    let truncated = false
    let settled = false
    let sawResultSet = false
    let connectionReusable = true
    let stream: any = null

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    // mysql2's stream.destroy() does not stop COM_QUERY consumption.
    const discardConnection = () => {
      connectionReusable = false
      try { stream?.destroy() } catch {}
      try {
        if (typeof (conn as any).destroy === 'function') {
          ;(conn as any).destroy()
        } else {
          const rawConn = (conn as any).connection
          if (rawConn && typeof rawConn.destroy === 'function') rawConn.destroy()
        }
      } catch {}
    }

    const raw = (conn as any).connection
    if (!raw || typeof raw.query !== 'function') {
      finish(() => reject(new Error('MySQL streaming requires raw connection')))
      return
    }

    let queryCmd: any
    try {
      queryCmd = raw.query({ sql, timeout: timeoutMs })
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))))
      return
    }

    if (!queryCmd || typeof queryCmd.stream !== 'function') {
      finish(() => reject(new Error('MySQL driver does not support query streaming')))
      return
    }

    stream = queryCmd.stream({ highWaterMark: 32, objectMode: true })

    stream.on('fields', (fields: FieldPacket[]) => {
      sawResultSet = true
      if (Array.isArray(fields)) columns = fields.map((f) => f.name)
    })

    stream.on('data', (row: RowDataPacket) => {
      sawResultSet = true
      if (settled) return
      if (isCancelled()) {
        discardConnection()
        finish(() => reject(Object.assign(cancelledError(), { connectionReusable: false })))
        return
      }
      if (rows.length >= maxRows) {
        truncated = true
        discardConnection()
        finish(() => resolve({
          connectionReusable: false,
          result: { columns, rows, rowCount: rows.length, truncated: true,
            durationMs: Date.now() - start, hasResultSet: true },
        }))
        return
      }
      const out: Record<string, unknown> = {}
      if (columns.length === 0) columns = Object.keys(row)
      for (const col of columns) out[col] = serializeCell((row as any)[col])
      rows.push(out)
    })

    const rejectDiscarded = (err: Error) => {
      if (connectionReusable) discardConnection()
      finish(() => reject(Object.assign(err, { connectionReusable: false as const })))
    }

    stream.on('error', (err: Error) => {
      if (settled) return
      rejectDiscarded(isCancelled() ? cancelledError() : err)
    })

    stream.on('end', () => {
      if (settled) return
      if (isCancelled()) {
        rejectDiscarded(cancelledError())
        return
      }
      finish(() => resolve({
        connectionReusable: true,
        result: { columns, rows, rowCount: rows.length, truncated,
          durationMs: Date.now() - start,
          hasResultSet: sawResultSet || columns.length > 0 || rows.length > 0 },
      }))
    })
  })
}
