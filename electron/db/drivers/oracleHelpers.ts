import type { Result } from 'oracledb'
import { assertIdent, serializeCell } from '../common'
import type { LiveSession } from './oracleTypes'

/** Strip optional schema. prefix; Oracle unquoted names are uppercased in dictionary. */
export function parseOracleTableName(table: string): string {
  assertIdent(table)
  const idx = table.indexOf('.')
  const name = idx > 0 ? table.slice(idx + 1) : table
  assertIdent(name)
  // Dictionary views store unquoted identifiers in uppercase
  if (name === name.toUpperCase() || /^[A-Za-z0-9_$#]+$/.test(name)) {
    return name.toUpperCase()
  }
  return name
}

export function mapRows(result: Result<Record<string, unknown>>): {
  columns: string[]
  rows: Array<Record<string, unknown>>
} {
  const meta = result.metaData || []
  const columns = meta.map((m) => m.name)
  const rawRows = (result.rows || []) as Array<Record<string, unknown> | unknown[]>
  const rows = rawRows.map((row) => {
    const out: Record<string, unknown> = {}
    if (row && !Array.isArray(row) && typeof row === 'object') {
      for (const col of columns) {
        out[col] = serializeCell((row as Record<string, unknown>)[col], { column: col })
      }
      return out
    }
    if (Array.isArray(row)) {
      columns.forEach((col, i) => {
        out[col] = serializeCell(row[i], { column: col })
      })
      return out
    }
    return out
  })
  return { columns, rows }
}

export function rowVal(row: Record<string, unknown> | undefined, key: string): unknown {
  if (!row) return undefined
  if (key in row) return row[key]
  const upper = key.toUpperCase()
  if (upper in row) return row[upper]
  const lower = key.toLowerCase()
  if (lower in row) return row[lower]
  return undefined
}

export function schemaOf(session: LiveSession, database?: string | null): string {
  const s = (
    typeof database === 'string' && database.trim()
      ? database.trim()
      : session.database || session.username || ''
  ).trim()
  if (!s) throw new Error('Schema is required')
  assertIdent(s)
  return s
}
