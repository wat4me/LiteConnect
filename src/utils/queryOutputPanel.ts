/** Bottom output panel ids for query tab. */
export type QueryOutputPanel = 'result' | 'messages' | 'plan' | 'history' | 'saved'

export type QueryOutputKind = 'result' | 'plan' | null

export type ResolveOutputPanelInput = {
  /** Last successful output kind (query vs explain) */
  outputKind: QueryOutputKind
  hasError: boolean
  hasResultSet: boolean
  /** Non-result-set success (affected rows) still counts as messages content */
  hasExecMessage: boolean
  /** User is currently viewing this panel (optional preference) */
  current?: QueryOutputPanel
  /** Force switch after a completed action */
  event?: 'query-success' | 'query-error' | 'explain-success' | 'explain-error' | 'idle'
}

/**
 * Decide which bottom panel should be active after query lifecycle events.
 * Pure rules — no DOM.
 */
export function resolveOutputPanel(input: ResolveOutputPanelInput): QueryOutputPanel {
  const event = input.event ?? 'idle'

  if (event === 'query-error' || event === 'explain-error') {
    return 'messages'
  }
  if (event === 'explain-success') {
    return 'plan'
  }
  if (event === 'query-success') {
    if (input.hasResultSet) return 'result'
    return 'messages'
  }

  // idle / initial: keep current if still meaningful, else pick best content
  if (input.current === 'history' || input.current === 'saved') return input.current
  if (input.hasError) return 'messages'
  if (input.outputKind === 'plan') return 'plan'
  if (input.hasResultSet) return 'result'
  if (input.hasExecMessage || input.hasError) return 'messages'
  return input.current ?? 'result'
}

export type OutputPanelBadge = {
  panel: QueryOutputPanel
  showErrorDot: boolean
  showTruncated: boolean
}

export function outputPanelBadges(opts: {
  hasError: boolean
  truncated: boolean
  outputKind: QueryOutputKind
}): OutputPanelBadge[] {
  return [
    {
      panel: 'result',
      showErrorDot: false,
      showTruncated: opts.truncated && opts.outputKind !== 'plan',
    },
    {
      panel: 'messages',
      showErrorDot: opts.hasError,
      showTruncated: false,
    },
    {
      panel: 'plan',
      showErrorDot: false,
      showTruncated: opts.truncated && opts.outputKind === 'plan',
    },
    {
      panel: 'history',
      showErrorDot: false,
      showTruncated: false,
    },
    {
      panel: 'saved',
      showErrorDot: false,
      showTruncated: false,
    },
  ]
}

/**
 * Rows for result vs plan grids.
 * Plan must never apply local result filter (stale filter from previous query).
 */
export function displayRowsForOutput(opts: {
  outputKind: QueryOutputKind
  hasResultSet: boolean
  rows: Array<Record<string, unknown>>
  columns: string[]
  filter: string
  sort: { col: string; dir: 'asc' | 'desc' } | null
  sortRows: (
    rows: Array<Record<string, unknown>>,
    col: string,
    dir: 'asc' | 'desc',
  ) => Array<Record<string, unknown>>
  filterRows: (
    rows: Array<Record<string, unknown>>,
    columns: string[],
    filter: string,
  ) => Array<Record<string, unknown>>
}): Array<Record<string, unknown>> {
  if (!opts.hasResultSet) return []
  let rows = opts.rows
  if (opts.sort) {
    rows = opts.sortRows(rows, opts.sort.col, opts.sort.dir)
  }
  // Local filter only for normal query results — never for explain plan
  if (opts.outputKind === 'plan') {
    return rows
  }
  return opts.filterRows(rows, opts.columns, opts.filter)
}
