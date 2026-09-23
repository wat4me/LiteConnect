import type { PoolClient, QueryResult, QueryResultRow } from 'pg'
import { cancelledError, serializeCell } from '../common'
import type { DbQueryResult } from '../types'

export function mapQueryResult(
  result: QueryResult<QueryResultRow>,
  maxRows: number,
  start: number,
  allowTruncate: boolean,
): DbQueryResult {
  const durationMs = Date.now() - start
  if (result.fields && result.fields.length > 0) {
    const columns = result.fields.map((f) => f.name)
    const truncated = allowTruncate && result.rows.length > maxRows
    const sliced = truncated ? result.rows.slice(0, maxRows) : result.rows
    const mapped = sliced.map((row) => {
      const out: Record<string, unknown> = {}
      for (const col of columns) out[col] = serializeCell((row as any)[col])
      return out
    })
    return {
      columns,
      rows: mapped,
      rowCount: mapped.length,
      truncated,
      durationMs,
      hasResultSet: true,
    }
  }
  return {
    columns: [],
    rows: [],
    rowCount: 0,
    truncated: false,
    affectedRows: result.rowCount ?? 0,
    durationMs,
    hasResultSet: false,
  }
}

/**
 * Cursor-based fetch: stop after maxRows rows without loading the full result set.
 * Caller must ensure isPostgresCursorSafe(sql).
 */
export async function queryCursorCapped(
  client: PoolClient,
  sql: string,
  maxRows: number,
  start: number,
  isCancelled: () => boolean,
): Promise<DbQueryResult> {
  const cursorName = `litesh_c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  // DECLARE CURSOR requires a transaction
  await client.query('BEGIN')
  try {
    const body = sql.replace(/;+\s*$/g, '').trim()
    await client.query(`DECLARE ${cursorName} NO SCROLL CURSOR FOR ${body}`)
    const batch = Math.min(Math.max(maxRows + 1, 1), 500)
    const rows: Record<string, unknown>[] = []
    let columns: string[] = []
    let truncated = false

    while (rows.length <= maxRows) {
      if (isCancelled()) {
        throw cancelledError()
      }
      const need = maxRows + 1 - rows.length
      const fetchN = Math.min(batch, need)
      const chunk = await client.query(`FETCH ${fetchN} FROM ${cursorName}`)
      if (columns.length === 0 && chunk.fields?.length) {
        columns = chunk.fields.map((f) => f.name)
      }
      if (!chunk.rows.length) break
      for (const row of chunk.rows) {
        if (rows.length >= maxRows) {
          truncated = true
          break
        }
        const out: Record<string, unknown> = {}
        if (columns.length === 0) columns = Object.keys(row)
        for (const col of columns) out[col] = serializeCell((row as any)[col])
        rows.push(out)
      }
      if (truncated || chunk.rows.length < fetchN) break
    }

    await client.query(`CLOSE ${cursorName}`)
    await client.query('COMMIT')

    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated,
      durationMs: Date.now() - start,
      hasResultSet: true,
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {}
    throw err
  }
}
