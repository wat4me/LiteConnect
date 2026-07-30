/** Sanitize per-query-tab execution options (DQB-006). */

export type QueryDefaultRunScopePref = 'smart' | 'selection' | 'statement' | 'all'

export type QueryTabExecOptions = {
  maxRows: number
  timeoutMs: number
  defaultRunScope: QueryDefaultRunScopePref
}

export const QUERY_MAX_ROWS_MIN = 1
export const QUERY_MAX_ROWS_MAX = 100_000
export const QUERY_MAX_ROWS_DEFAULT = 1000

export const QUERY_TIMEOUT_MS_MIN = 1_000
export const QUERY_TIMEOUT_MS_MAX = 600_000
export const QUERY_TIMEOUT_MS_DEFAULT = 120_000

export function clampQueryMaxRows(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return QUERY_MAX_ROWS_DEFAULT
  return Math.max(QUERY_MAX_ROWS_MIN, Math.min(QUERY_MAX_ROWS_MAX, Math.round(v)))
}

export function clampQueryTimeoutMs(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return QUERY_TIMEOUT_MS_DEFAULT
  return Math.max(QUERY_TIMEOUT_MS_MIN, Math.min(QUERY_TIMEOUT_MS_MAX, Math.round(v)))
}

export function sanitizeDefaultRunScopePref(v: unknown): QueryDefaultRunScopePref {
  if (v === 'selection' || v === 'statement' || v === 'all' || v === 'smart') return v
  return 'smart'
}

export function sanitizeQueryTabExecOptions(
  partial?: Partial<QueryTabExecOptions> | null,
): QueryTabExecOptions {
  return {
    maxRows: clampQueryMaxRows(partial?.maxRows),
    timeoutMs: clampQueryTimeoutMs(partial?.timeoutMs),
    defaultRunScope: sanitizeDefaultRunScopePref(partial?.defaultRunScope),
  }
}

/** Global product defaults (settings UI); timeout stored as seconds. */
export const QUERY_TIMEOUT_SEC_MIN = 1
export const QUERY_TIMEOUT_SEC_MAX = 600
export const QUERY_TIMEOUT_SEC_DEFAULT = 120

export function clampQueryTimeoutSec(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return QUERY_TIMEOUT_SEC_DEFAULT
  return Math.max(QUERY_TIMEOUT_SEC_MIN, Math.min(QUERY_TIMEOUT_SEC_MAX, Math.round(v)))
}

/**
 * Merge global defaults with optional draft fields.
 * - Missing draft field → use global default (then clamp).
 * - Explicit draft field → preserve (clamp only).
 * Never invents values from unrelated sources.
 */
export function resolveQueryTabExecOptionsFromDefaults(
  globals: Partial<QueryTabExecOptions> | null | undefined,
  draft?: Partial<QueryTabExecOptions> | null,
): QueryTabExecOptions {
  const g = sanitizeQueryTabExecOptions(globals)
  return {
    maxRows:
      draft?.maxRows !== undefined && draft?.maxRows !== null
        ? clampQueryMaxRows(draft.maxRows)
        : g.maxRows,
    timeoutMs:
      draft?.timeoutMs !== undefined && draft?.timeoutMs !== null
        ? clampQueryTimeoutMs(draft.timeoutMs)
        : g.timeoutMs,
    defaultRunScope:
      draft?.defaultRunScope !== undefined && draft?.defaultRunScope !== null
        ? sanitizeDefaultRunScopePref(draft.defaultRunScope)
        : g.defaultRunScope,
  }
}

/**
 * Resolve primary run button scope from user preference + editor state.
 * Pref is soft: falls back to smart when selection/statement unavailable.
 */
export function resolvePreferredRunScope(opts: {
  pref: QueryDefaultRunScopePref
  hasSelection: boolean
  canRunStatement: boolean
  smart: (hasSelection: boolean, canRunStatement: boolean) => 'selection' | 'statement' | 'all'
}): 'selection' | 'statement' | 'all' {
  if (opts.pref === 'all') return 'all'
  if (opts.pref === 'selection' && opts.hasSelection) return 'selection'
  if (opts.pref === 'statement' && opts.canRunStatement) return 'statement'
  return opts.smart(opts.hasSelection, opts.canRunStatement)
}

/** Editor status snapshot from CodeMirror (no document ownership). */
export type EditorStatusSnapshot = {
  line: number
  column: number
  selectionChars: number
}

export function editorStatusFromSelection(opts: {
  doc: string
  head: number
  selectionStart: number
  selectionEnd: number
}): EditorStatusSnapshot {
  const head = Math.max(0, Math.min(opts.head, opts.doc.length))
  const before = opts.doc.slice(0, head)
  const lines = before.split(/\n/)
  const line = lines.length
  const column = (lines[lines.length - 1]?.length ?? 0) + 1
  const a = Math.max(0, Math.min(opts.selectionStart, opts.doc.length))
  const b = Math.max(0, Math.min(opts.selectionEnd, opts.doc.length))
  return {
    line,
    column,
    selectionChars: Math.abs(b - a),
  }
}

/**
 * Bottom pane visibility after query lifecycle.
 * - collapse stays until result/error/explain forces open
 * - openLog forces history panel + expanded bottom
 */
export function resolveBottomPaneVisibility(opts: {
  collapsed: boolean
  event: 'idle' | 'query-success' | 'query-error' | 'explain-success' | 'explain-error' | 'open-log' | 'toggle-collapse'
}): { collapsed: boolean; forceHistory?: boolean } {
  if (opts.event === 'toggle-collapse') {
    return { collapsed: !opts.collapsed }
  }
  if (opts.event === 'open-log') {
    return { collapsed: false, forceHistory: true }
  }
  if (
    opts.event === 'query-success' ||
    opts.event === 'query-error' ||
    opts.event === 'explain-success' ||
    opts.event === 'explain-error'
  ) {
    return { collapsed: false }
  }
  return { collapsed: opts.collapsed }
}
