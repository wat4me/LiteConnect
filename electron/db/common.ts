import { t } from '../i18n'

export const DEFAULT_QUERY_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_ROWS = 1_000
export const MAX_SQL_CHARS = 200_000

/** Marker prefix for binary cells returned to the renderer (download via db:getBlob). */
export const BLOB_PLACEHOLDER_PREFIX = '<BLOB '

export function blobPlaceholder(length: number, column?: string, rowHint?: string): string {
  const col = column ? ` col=${column}` : ''
  const row = rowHint ? ` row=${rowHint}` : ''
  return `${BLOB_PLACEHOLDER_PREFIX}${length} bytes${col}${row}>`
}

export function isBlobPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(BLOB_PLACEHOLDER_PREFIX)
}

export function serializeCell(value: unknown, opts?: { column?: string }): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return value.toString()
  if (Buffer.isBuffer(value)) {
    if (value.length > 256) return blobPlaceholder(value.length, opts?.column)
    // Try utf8; if mostly binary, still show placeholder for safety
    const asText = value.toString('utf8')
    if (asText.includes('\0')) return blobPlaceholder(value.length, opts?.column)
    return asText
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value))
    } catch {
      return String(value)
    }
  }
  return value
}

export function assertIdent(name: string): void {
  if (typeof name !== 'string' || !name.trim() || /[\0]/.test(name)) {
    throw new Error('Invalid identifier')
  }
}

/** MySQL-style backtick identifiers */
export function quoteIdentMysql(name: string): string {
  return '`' + String(name).replace(/`/g, '``') + '`'
}

/** PostgreSQL-style double-quote identifiers */
export function quoteIdentPostgres(name: string): string {
  return '"' + String(name).replace(/"/g, '""') + '"'
}

export function cancelledError(): Error {
  const err = new Error(t('db.queryCancelled'))
  ;(err as any).code = 'QUERY_CANCELLED'
  return err
}

export function clampQueryLimits(options?: {
  maxRows?: number
  timeoutMs?: number
}): { maxRows: number; timeoutMs: number } {
  return {
    maxRows: Math.min(Math.max(options?.maxRows ?? DEFAULT_MAX_ROWS, 1), 5_000),
    timeoutMs: Math.min(
      Math.max(options?.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS, 1_000),
      120_000,
    ),
  }
}

export function validateSqlInput(sql: string): string {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('Invalid SQL')
  if (sql.length > MAX_SQL_CHARS) throw new Error(`SQL too long (max ${MAX_SQL_CHARS} chars)`)
  if (sql.includes('\0')) throw new Error('Invalid SQL')
  return sql.trim()
}

/** Strip credentials / connection strings from cancel error text for renderer. */
export function sanitizeCancelError(raw: string): string {
  let s = String(raw || 'cancel failed')
  s = s.replace(/(password|pwd|passwd)\s*=\s*[^;\s]+/gi, '$1=***')
  s = s.replace(/:\/\/[^@\s]+@/g, '://***@')
  if (s.length > 200) s = s.slice(0, 200) + '…'
  return s
}
