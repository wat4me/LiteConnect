/** Pure UI decision helpers for query tab event wiring (UI-007). */

import type { RunScope } from './sqlStatement'
import type { QueryOutputPanel } from './queryOutputPanel'

export type QueryUiAction =
  | { type: 'run'; sql: string }
  | { type: 'explain'; sql: string }
  | { type: 'cancel' }
  | { type: 'beginTx' }
  | { type: 'commitTx' }
  | { type: 'rollbackTx' }
  | { type: 'retry'; sql: string }
  | { type: 'changeDatabase'; database: string }
  | { type: 'copyResult' }
  | { type: 'exportCsv' }
  | { type: 'exportJson' }
  | { type: 'copyCell'; value: unknown }
  | { type: 'clearHistory' }
  | { type: 'applyHistory'; item: unknown }
  | { type: 'none'; reason: string }

export function mapRunResolved(opts: {
  sql: string
  reason?: string
}): QueryUiAction {
  if (!opts.sql) {
    return { type: 'none', reason: opts.reason || 'empty' }
  }
  return { type: 'run', sql: opts.sql }
}

export function mapExplainResolved(opts: {
  sql: string
  reason?: string
}): QueryUiAction {
  if (!opts.sql) {
    return { type: 'none', reason: opts.reason || 'empty' }
  }
  return { type: 'explain', sql: opts.sql }
}

export function mapCancel(opts: { loading: boolean; queryId: string | null }): QueryUiAction {
  if (!opts.loading || !opts.queryId) return { type: 'none', reason: 'not-running' }
  return { type: 'cancel' }
}

export function mapTxAction(
  kind: 'begin' | 'commit' | 'rollback',
  opts: { sessionAlive: boolean; inTransaction: boolean },
): QueryUiAction {
  if (!opts.sessionAlive) return { type: 'none', reason: 'disconnected' }
  if (kind === 'begin' && opts.inTransaction) return { type: 'none', reason: 'already-in-tx' }
  if ((kind === 'commit' || kind === 'rollback') && !opts.inTransaction) {
    return { type: 'none', reason: 'not-in-tx' }
  }
  if (kind === 'begin') return { type: 'beginTx' }
  if (kind === 'commit') return { type: 'commitTx' }
  return { type: 'rollbackTx' }
}

export function mapRetry(opts: {
  errorRetryable: boolean
  sql: string
}): QueryUiAction {
  if (!opts.errorRetryable) return { type: 'none', reason: 'not-retryable' }
  if (!opts.sql.trim()) return { type: 'none', reason: 'empty' }
  return { type: 'retry', sql: opts.sql }
}

export function mapExport(kind: 'csv' | 'json' | 'copy', opts: { hasResultSet: boolean }): QueryUiAction {
  if (!opts.hasResultSet) return { type: 'none', reason: 'no-result' }
  if (kind === 'csv') return { type: 'exportCsv' }
  if (kind === 'json') return { type: 'exportJson' }
  return { type: 'copyResult' }
}

export function mapChangeDatabase(opts: {
  database: string
  inTransaction: boolean
}): QueryUiAction {
  if (opts.inTransaction) return { type: 'none', reason: 'tx-blocked' }
  return { type: 'changeDatabase', database: opts.database }
}

/** Run menu item enabled? */
export function isRunMenuItemEnabled(
  scope: RunScope,
  opts: { hasSelection: boolean; canRunStatement: boolean; sessionAlive: boolean },
): boolean {
  if (!opts.sessionAlive) return false
  if (scope === 'selection') return opts.hasSelection
  if (scope === 'statement') return opts.canRunStatement
  return true
}

/** Output panel keyboard navigation (left/right). */
export function nextOutputPanel(
  current: QueryOutputPanel,
  dir: -1 | 1,
  order: QueryOutputPanel[] = ['result', 'messages', 'plan', 'history', 'saved'],
): QueryOutputPanel {
  const i = order.indexOf(current)
  const idx = i < 0 ? 0 : (i + dir + order.length) % order.length
  return order[idx]
}

export function outputPanelDomIds(tabId: string): {
  tablist: string
  tabs: Record<QueryOutputPanel, string>
  panels: Record<QueryOutputPanel, string>
} {
  const base = `db-query-out-${tabId}`
  return {
    tablist: `${base}-tablist`,
    tabs: {
      result: `${base}-tab-result`,
      messages: `${base}-tab-messages`,
      plan: `${base}-tab-plan`,
      history: `${base}-tab-history`,
      saved: `${base}-tab-saved`,
    },
    panels: {
      result: `${base}-panel-result`,
      messages: `${base}-panel-messages`,
      plan: `${base}-panel-plan`,
      history: `${base}-panel-history`,
      saved: `${base}-panel-saved`,
    },
  }
}
