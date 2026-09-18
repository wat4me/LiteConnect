/**
 * Global defaults for newly created DB query tabs (main-process validation).
 * Independent of renderer queryTabOptions; bounds kept in sync intentionally.
 */

export const DB_DEFAULT_MAX_ROWS_MIN = 1
export const DB_DEFAULT_MAX_ROWS_MAX = 100_000
export const DB_DEFAULT_MAX_ROWS = 1000

export const DB_DEFAULT_QUERY_TIMEOUT_SEC_MIN = 1
export const DB_DEFAULT_QUERY_TIMEOUT_SEC_MAX = 600
export const DB_DEFAULT_QUERY_TIMEOUT_SEC = 120

export type DbDefaultRunScope = 'smart' | 'selection' | 'statement' | 'all'

/** Sanitize persisted / IPC max-rows default; corrupt/legacy → 1000. */
export function sanitizeDbDefaultMaxRows(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DB_DEFAULT_MAX_ROWS
  return Math.max(DB_DEFAULT_MAX_ROWS_MIN, Math.min(DB_DEFAULT_MAX_ROWS_MAX, Math.round(n)))
}

/** Sanitize persisted / IPC timeout default (seconds); corrupt/legacy → 120. */
export function sanitizeDbDefaultQueryTimeoutSec(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DB_DEFAULT_QUERY_TIMEOUT_SEC
  return Math.max(
    DB_DEFAULT_QUERY_TIMEOUT_SEC_MIN,
    Math.min(DB_DEFAULT_QUERY_TIMEOUT_SEC_MAX, Math.round(n)),
  )
}

/** Sanitize persisted / IPC run-scope default; corrupt/legacy → smart. */
export function sanitizeDbDefaultRunScope(v: unknown): DbDefaultRunScope {
  if (v === 'selection' || v === 'statement' || v === 'all' || v === 'smart') return v
  return 'smart'
}
