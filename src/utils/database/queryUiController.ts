/** Pure UI decision helpers for query tab event wiring (UI-007). */

import type { RunScope } from '@/utils/database/sqlStatement'
import type { QueryOutputPanel } from '@/utils/database/queryOutputPanel'

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
