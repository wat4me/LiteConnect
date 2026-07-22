import type { DbBrowseOptions, DbTotalMode } from './types'

/** Build cache key for exact COUNT results (session/database/table/filter/search). */
export function browseCountCacheKey(
  sessionId: string,
  database: string,
  table: string,
  options?: DbBrowseOptions,
): string {
  const search = options?.search?.trim() || ''
  const filters = options?.filters?.length
    ? JSON.stringify(
        options.filters.map((f) => ({
          column: f.column,
          op: f.op,
          value: f.value ?? '',
        })),
      )
    : ''
  const searchCols = options?.searchColumns?.length
    ? options.searchColumns.join(',')
    : ''
  return `${sessionId}\0${database}\0${table}\0${search}\0${searchCols}\0${filters}`
}

export type CountCacheEntry = {
  total: number
  /** Absolute expiry time (ms) */
  expiresAt: number
}

const DEFAULT_COUNT_TTL_MS = 60_000

/**
 * In-memory exact COUNT cache shared per driver instance.
 * Key must include session/database/table/filter/search (see browseCountCacheKey).
 */
export class BrowseCountCache {
  private map = new Map<string, CountCacheEntry>()
  private ttlMs: number

  constructor(ttlMs = DEFAULT_COUNT_TTL_MS) {
    this.ttlMs = ttlMs
  }

  get(key: string): number | null {
    const entry = this.map.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key)
      return null
    }
    return entry.total
  }

  set(key: string, total: number): void {
    this.map.set(key, { total, expiresAt: Date.now() + this.ttlMs })
  }

  /** Drop all entries for a session (disconnect). */
  invalidateSession(sessionId: string): void {
    const prefix = `${sessionId}\0`
    for (const k of this.map.keys()) {
      if (k.startsWith(prefix)) this.map.delete(k)
    }
  }

  clear(): void {
    this.map.clear()
  }
}

/**
 * Slice pageSize+1 rows and derive hasNext / totalMode when no exact count is available.
 * - hasNext from extra row
 * - without filter: estimatedTotal may be used (estimated)
 * - with filter and no exact: unknown (total = lower bound of loaded rows)
 */
export function finalizeBrowsePage(args: {
  rows: Array<Record<string, unknown>>
  columns: string[]
  page: number
  pageSize: number
  durationMs: number
  /** Exact COUNT when available (cache or sync) */
  exactTotal?: number | null
  /** Engine estimate (information_schema / reltuples) when no filter */
  estimatedTotal?: number | null
  hasFilter: boolean
}): {
  columns: string[]
  rows: Array<Record<string, unknown>>
  page: number
  pageSize: number
  total: number
  totalMode: DbTotalMode
  hasNext: boolean
  durationMs: number
} {
  const hasNext = args.rows.length > args.pageSize
  const rows = hasNext ? args.rows.slice(0, args.pageSize) : args.rows
  const offset = (args.page - 1) * args.pageSize
  const atLeast = offset + rows.length + (hasNext ? 1 : 0)

  // pageSize+1 is authoritative for hasNext; totals are display-only and must not override it.
  if (args.exactTotal != null && Number.isFinite(args.exactTotal) && args.exactTotal >= 0) {
    return {
      columns: args.columns,
      rows,
      page: args.page,
      pageSize: args.pageSize,
      total: Math.floor(args.exactTotal),
      totalMode: 'exact',
      hasNext,
      durationMs: args.durationMs,
    }
  }

  if (
    !args.hasFilter
    && args.estimatedTotal != null
    && Number.isFinite(args.estimatedTotal)
    && args.estimatedTotal >= 0
  ) {
    // Prefer estimate but never under-report rows already seen
    const total = Math.max(Math.floor(args.estimatedTotal), atLeast, offset + rows.length)
    return {
      columns: args.columns,
      rows,
      page: args.page,
      pageSize: args.pageSize,
      total,
      totalMode: 'estimated',
      hasNext,
      durationMs: args.durationMs,
    }
  }

  // Unknown exact total — expose lower bound only
  return {
    columns: args.columns,
    rows,
    page: args.page,
    pageSize: args.pageSize,
    total: offset + rows.length,
    totalMode: 'unknown',
    hasNext,
    durationMs: args.durationMs,
  }
}

export function browseHasFilter(options?: DbBrowseOptions): boolean {
  if (options?.search?.trim()) return true
  if (options?.filters && options.filters.length > 0) return true
  return false
}
