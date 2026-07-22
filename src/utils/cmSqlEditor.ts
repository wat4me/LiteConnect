/** Pure helpers for CodeMirror SQL editor ↔ Vue tab sync (no DOM). */

export type SqlEditorSelection = {
  start: number
  end: number
}

export type SqlEditorViewSnapshot = {
  selection: SqlEditorSelection
  scrollTop: number
  scrollLeft: number
}

export type SqlEditorUiState = {
  selectionAnchor: number
  selectionHead: number
  scrollTop: number
  scrollLeft: number
}

/** Normalize selection so start <= end and both within [0, docLen]. */
export function clampSelection(
  sel: SqlEditorSelection,
  docLen: number,
): SqlEditorSelection {
  const len = Math.max(0, docLen)
  let start = Math.max(0, Math.min(sel.start, len))
  let end = Math.max(0, Math.min(sel.end, len))
  if (start > end) {
    const t = start
    start = end
    end = t
  }
  return { start, end }
}

export function hasNonEmptySelectionText(
  doc: string,
  sel: SqlEditorSelection,
): boolean {
  const { start, end } = clampSelection(sel, doc.length)
  if (end <= start) return false
  return doc.slice(start, end).trim().length > 0
}

/**
 * Decide whether external tab.sql should overwrite the editor document.
 * Avoids feedback loops when the editor itself just wrote tab.sql.
 */
export function shouldApplyExternalDoc(opts: {
  externalSql: string
  editorDoc: string
  /** True while applying a programmatic set from Vue */
  applyingExternal: boolean
}): boolean {
  if (opts.applyingExternal) return false
  return opts.externalSql !== opts.editorDoc
}

/** Build EditorState selection fields from UI snapshot. */
export function selectionFromUi(
  ui: SqlEditorUiState | null | undefined,
  docLen: number,
): { anchor: number; head: number } {
  if (!ui) return { anchor: 0, head: 0 }
  const anchor = Math.max(0, Math.min(ui.selectionAnchor, docLen))
  const head = Math.max(0, Math.min(ui.selectionHead, docLen))
  return { anchor, head }
}

export function uiFromEditor(opts: {
  anchor: number
  head: number
  scrollTop: number
  scrollLeft: number
}): SqlEditorUiState {
  return {
    selectionAnchor: opts.anchor,
    selectionHead: opts.head,
    scrollTop: opts.scrollTop,
    scrollLeft: opts.scrollLeft,
  }
}

/**
 * Async completion generation guard.
 * Call next() when context changes; only accept results for the live gen.
 */
export function createCompletionGeneration() {
  let gen = 0
  return {
    next(): number {
      gen += 1
      return gen
    },
    isLive(g: number): boolean {
      return g === gen
    },
    current(): number {
      return gen
    },
    /** Invalidate all in-flight (unmount / tab change) */
    invalidate(): void {
      gen += 1
    },
  }
}

/** Keymap intent: run default vs cancel query (pure). */
export type EditorKeyIntent = 'run-default' | 'cancel' | null

export function editorKeyIntent(opts: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  composing: boolean
  queryLoading: boolean
  hasQueryId: boolean
}): EditorKeyIntent {
  if (opts.composing) return null
  if (opts.key === 'Enter' && (opts.ctrlKey || opts.metaKey)) {
    return 'run-default'
  }
  if (opts.key === 'Escape' && opts.queryLoading && opts.hasQueryId) {
    return 'cancel'
  }
  return null
}

/**
 * Build a stable context key for schema completion so late results are dropped
 * when database / dialect / session / table-ref context changed.
 */
export function completionContextKey(opts: {
  tabId: string
  database: string
  dialect: string
  sessionAlive: boolean
  /** Optional table qualifier from token */
  tableRef?: string | null
}): string {
  return [
    opts.tabId,
    opts.database,
    opts.dialect,
    opts.sessionAlive ? '1' : '0',
    opts.tableRef || '',
  ].join('\0')
}

/** Snapshot of a completion request used for race checks after each await. */
export type CompletionRequestSnapshot = {
  gen: number
  contextKey: string
  pos: number
  doc: string
  token: string
  start: number
}

export function makeCompletionRequestSnapshot(opts: {
  gen: number
  tabId: string
  database: string
  dialect: string
  sessionAlive: boolean
  tableRef?: string | null
  pos: number
  doc: string
  token: string
  start: number
}): CompletionRequestSnapshot {
  return {
    gen: opts.gen,
    contextKey: completionContextKey({
      tabId: opts.tabId,
      database: opts.database,
      dialect: opts.dialect,
      sessionAlive: opts.sessionAlive,
      tableRef: opts.tableRef,
    }),
    pos: opts.pos,
    doc: opts.doc,
    token: opts.token,
    start: opts.start,
  }
}

/**
 * True only if generation is live AND props/editor context still match the
 * request that started the async completion.
 */
export function isCompletionRequestLive(opts: {
  snapshot: CompletionRequestSnapshot
  isLiveGen: (g: number) => boolean
  current: {
    tabId: string
    database: string
    dialect: string
    sessionAlive: boolean
    tableRef?: string | null
    pos: number
    doc: string
    token: string
    start: number
  }
}): boolean {
  if (!opts.isLiveGen(opts.snapshot.gen)) return false
  const curKey = completionContextKey({
    tabId: opts.current.tabId,
    database: opts.current.database,
    dialect: opts.current.dialect,
    sessionAlive: opts.current.sessionAlive,
    tableRef: opts.current.tableRef,
  })
  if (curKey !== opts.snapshot.contextKey) return false
  if (opts.current.pos !== opts.snapshot.pos) return false
  if (opts.current.doc !== opts.snapshot.doc) return false
  if (opts.current.token !== opts.snapshot.token) return false
  if (opts.current.start !== opts.snapshot.start) return false
  return true
}

/**
 * Run async steps with a live-check after each await.
 * Used by schema completion so tests can control promise timing without DOM.
 */
export async function runGuardedAsyncSteps<T>(opts: {
  steps: Array<() => Promise<unknown>>
  isLive: () => boolean
  build: () => T | null
}): Promise<T | null> {
  if (!opts.isLive()) return null
  for (const step of opts.steps) {
    await step()
    if (!opts.isLive()) return null
  }
  if (!opts.isLive()) return null
  return opts.build()
}

/** Flush editor state into a specific tab object (destroy / unmount). Always writes doc from state. */
export function flushEditorToTab(
  tab: {
    sql: string
    editorUi?: SqlEditorUiState | null
  },
  snapshot: {
    doc: string
    anchor: number
    head: number
    scrollTop: number
    scrollLeft: number
  },
): void {
  tab.sql = snapshot.doc
  tab.editorUi = uiFromEditor({
    anchor: snapshot.anchor,
    head: snapshot.head,
    scrollTop: snapshot.scrollTop,
    scrollLeft: snapshot.scrollLeft,
  })
}

/**
 * Whether CodeMirror should use dark facet for a data-theme value.
 * dark / custom / missing → dark; light / eyecare → light.
 */
export function isCmDarkTheme(dataTheme: string | null | undefined): boolean {
  if (!dataTheme || dataTheme === 'dark' || dataTheme === 'custom') return true
  if (dataTheme === 'light' || dataTheme === 'eyecare') return false
  return true
}
