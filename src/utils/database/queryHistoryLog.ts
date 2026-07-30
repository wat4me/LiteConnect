/** Pure helpers for query execution log display (single history source). */

import type { QueryHistoryItem } from '@/domain/database/types'

export type HistoryStatusFilter = 'all' | 'success' | 'failed' | 'cancelled' | 'slow'

export const HISTORY_SQL_PREVIEW_MAX = 200
export const HISTORY_ERROR_PREVIEW_MAX = 120
export const SLOW_QUERY_MS = 2000

export function truncateHistorySql(sql: string, max = HISTORY_SQL_PREVIEW_MAX): string {
  const s = String(sql || '').replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  return s.slice(0, Math.max(0, max - 1)) + '…'
}

export function truncateHistoryError(text: string | undefined, max = HISTORY_ERROR_PREVIEW_MAX): string {
  if (!text) return ''
  const s = String(text).replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if (s.length <= max) return s
  return s.slice(0, Math.max(0, max - 1)) + '…'
}

export function filterHistoryItems(
  items: QueryHistoryItem[],
  opts: {
    onlyConnectionId?: string | null
    includeOrphan?: boolean
    status: HistoryStatusFilter
    slowMs?: number
  },
): QueryHistoryItem[] {
  let list = items
  if (opts.onlyConnectionId) {
    const id = opts.onlyConnectionId
    const mine = list.filter((h) => h.connectionId === id)
    const orphan = opts.includeOrphan !== false ? list.filter((h) => !h.connectionId) : []
    list = [...mine, ...orphan]
  }
  const f = opts.status
  const slowMs = opts.slowMs ?? SLOW_QUERY_MS
  if (f === 'slow') {
    return list.filter((h) => h.slow || (h.durationMs != null && h.durationMs >= slowMs))
  }
  if (f === 'success' || f === 'failed' || f === 'cancelled') {
    return list.filter((h) => (h.status || 'success') === f)
  }
  return list
}

export type HistoryLogMeta = {
  status: 'success' | 'failed' | 'cancelled'
  durationMs: number | null
  rowsLabel: string | null
  scope: 'selection' | 'statement' | 'all' | 'explain' | null
  truncated: boolean
  errorPreview: string
  slow: boolean
}

/** Bounded safe metadata for a log row (no secrets). */
export function historyLogMeta(item: QueryHistoryItem): HistoryLogMeta {
  const status = item.status === 'failed' || item.status === 'cancelled' ? item.status : 'success'
  const durationMs = typeof item.durationMs === 'number' && Number.isFinite(item.durationMs)
    ? Math.max(0, Math.round(item.durationMs))
    : null
  let rowsLabel: string | null = null
  if (typeof item.rowCount === 'number' && Number.isFinite(item.rowCount)) {
    rowsLabel = `${Math.max(0, Math.round(item.rowCount))} rows`
  } else if (typeof item.affectedRows === 'number' && Number.isFinite(item.affectedRows)) {
    rowsLabel = `${Math.max(0, Math.round(item.affectedRows))} affected`
  }
  const scope =
    item.runScope === 'selection' ||
    item.runScope === 'statement' ||
    item.runScope === 'all' ||
    item.runScope === 'explain'
      ? item.runScope
      : null
  const slow =
    item.slow === true || (durationMs != null && durationMs >= SLOW_QUERY_MS)
  return {
    status,
    durationMs,
    rowsLabel,
    scope,
    truncated: item.truncated === true,
    errorPreview: truncateHistoryError(item.errorSummary),
    slow,
  }
}

/**
 * Apply history SQL into editor: never auto-run.
 * Returns the SQL to restore, or empty if invalid.
 */
export function sqlFromHistoryItem(item: Pick<QueryHistoryItem, 'sql'> | null | undefined): string {
  if (!item || typeof item.sql !== 'string') return ''
  return item.sql
}

export type ExplainHistoryPushMeta = {
  status: 'success' | 'failed' | 'cancelled'
  durationMs: number
  rowCount?: number
  truncated?: boolean
  errorSummary?: string
  runScope: 'explain'
  connectionId?: string
}

/**
 * Build history push payload for EXPLAIN outcomes (single history source).
 * Callers must still use existing pushQueryHistory; this only shapes metadata.
 */
export function buildExplainHistoryMeta(opts: {
  startedAtMs: number
  nowMs: number
  connectionId?: string
  outcome:
    | {
        kind: 'success'
        rowCount?: number
        durationMs?: number
        truncated?: boolean
      }
    | {
        kind: 'failed' | 'cancelled'
        errorSummary?: string
      }
}): ExplainHistoryPushMeta {
  const durationMs = Math.max(
    0,
    Math.round(
      opts.outcome.kind === 'success' && typeof opts.outcome.durationMs === 'number'
        ? opts.outcome.durationMs
        : opts.nowMs - opts.startedAtMs,
    ),
  )
  if (opts.outcome.kind === 'success') {
    return {
      status: 'success',
      durationMs,
      rowCount:
        typeof opts.outcome.rowCount === 'number' && Number.isFinite(opts.outcome.rowCount)
          ? Math.max(0, Math.round(opts.outcome.rowCount))
          : undefined,
      truncated: opts.outcome.truncated === true ? true : undefined,
      runScope: 'explain',
      connectionId: opts.connectionId,
    }
  }
  return {
    status: opts.outcome.kind,
    durationMs,
    errorSummary: truncateHistoryError(opts.outcome.errorSummary),
    runScope: 'explain',
    connectionId: opts.connectionId,
  }
}
