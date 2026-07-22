/**
 * Per-tab / per-node request generation helpers (DB-005 / DB-008).
 * Pure functions so tests call the real logic without string-asserting sources.
 */

export type RequestGenMap = Map<string, number>

/** Bump generation for a key; returns the new generation token. */
export function nextRequestGen(map: RequestGenMap, key: string): number {
  const n = (map.get(key) || 0) + 1
  map.set(key, n)
  return n
}

/** True if this response is still the live request for the key. */
export function isLiveRequest(map: RequestGenMap, key: string, gen: number): boolean {
  return map.get(key) === gen
}

/**
 * Whether loading should be cleared in finally for this request.
 * Only the current generation may clear loading (old finally must not clear new request).
 */
export function shouldClearLoading(map: RequestGenMap, key: string, gen: number): boolean {
  return map.get(key) === gen
}

/** Invalidate key so in-flight responses are discarded (disconnect / close tab). */
export function invalidateRequestGen(map: RequestGenMap, key: string): void {
  map.set(key, (map.get(key) || 0) + 1)
}

export type DbCancelStatus = 'cancelled' | 'already_finished' | 'failed' | 'requested'

export type DbCancelResultLike = {
  status: DbCancelStatus
  error?: string
}

/**
 * Map structured cancel result to a UI toast intent.
 * - already_finished: no "cancel success" toast
 * - cancelled / requested: cancelling / cancel sent
 * - failed: error with sanitized message
 */
export function cancelResultUi(result: DbCancelResultLike): {
  kind: 'none' | 'info' | 'error'
  status: DbCancelStatus
  error?: string
} {
  switch (result.status) {
    case 'already_finished':
      return { kind: 'none', status: result.status }
    case 'failed':
      return { kind: 'error', status: result.status, error: result.error }
    case 'cancelled':
    case 'requested':
      return { kind: 'info', status: result.status }
    default:
      return { kind: 'none', status: 'already_finished' }
  }
}

/**
 * Pagination: pageSize+1 (hasNext) is authoritative.
 * Stale/overestimated totals must not enable next when hasNext is false.
 */
export function canGoNextPage(args: {
  page: number
  pageSize: number
  total: number
  hasNext?: boolean
  totalMode?: 'exact' | 'estimated' | 'unknown'
}): boolean {
  if (args.hasNext === true) return true
  if (args.hasNext === false) return false
  // hasNext omitted: fall back to total only for exact mode
  if (args.totalMode === 'exact') return args.page * args.pageSize < args.total
  return false
}

/**
 * Best-effort cancel for closing a query tab.
 * Never throws / never toasts — UI must not be blocked or misled.
 */
export async function bestEffortCancelQuery(
  sessionId: string,
  queryId: string,
  cancelFn: (sessionId: string, queryId: string) => Promise<DbCancelResultLike>,
): Promise<void> {
  if (!sessionId || !queryId) return
  try {
    await cancelFn(sessionId, queryId)
  } catch {
    // swallow
  }
}

export function maxPageFromBrowse(args: {
  page: number
  pageSize: number
  total: number
  hasNext?: boolean
  totalMode?: 'exact' | 'estimated' | 'unknown'
}): number {
  if (args.totalMode === 'exact' || args.totalMode === 'estimated') {
    return Math.max(1, Math.ceil(Math.max(args.total, 1) / args.pageSize))
  }
  // unknown: at least current page, +1 if hasNext
  const atLeast = Math.max(1, args.page + (args.hasNext ? 1 : 0))
  const fromTotal = Math.max(1, Math.ceil(Math.max(args.total, 1) / args.pageSize))
  return Math.max(atLeast, fromTotal)
}

/** Export-all loop stop condition without requiring fabricated exact totals. */
export function shouldContinueExportPage(args: {
  hasNext?: boolean
  rowsLength: number
  allRowsLength: number
  total: number
  totalMode?: 'exact' | 'estimated' | 'unknown'
  maxRows: number
}): boolean {
  if (args.allRowsLength >= args.maxRows) return false
  if (args.rowsLength === 0) return false
  if (args.hasNext === true) return true
  if (args.hasNext === false) return false
  if (args.totalMode === 'exact') return args.allRowsLength < args.total
  return args.allRowsLength < args.total
}
