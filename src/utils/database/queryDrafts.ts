/** Query tab drafts, dirty-state, and title helpers (no DOM / no secrets). */

export const QUERY_DRAFT_VERSION = 1 as const
export const QUERY_DRAFT_MAX_COUNT = 30
export const QUERY_DRAFT_MAX_SQL_CHARS = 100_000
export const QUERY_DRAFT_DEBOUNCE_MS = 800
export const QUERY_DRAFT_STORAGE_KEY = 'LiteConnect.dbQueryDrafts.v1'
export const QUERY_TITLE_MAX_LEN = 40

export type QueryDraftRecord = {
  draftId: string
  connectionId: string
  database: string
  title: string
  /** When true, auto-title from SQL must not overwrite */
  titleCustomized: boolean
  sql: string
  updatedAt: number
  /** Safe UI flag only — never secrets/results/session */
  readOnly?: boolean
  /** Bounded per-tab exec options (DQB-006) */
  maxRows?: number
  timeoutMs?: number
  defaultRunScope?: 'smart' | 'selection' | 'statement' | 'all'
  savedQueryId?: string | null
}

export type QueryDraftFile = {
  version: typeof QUERY_DRAFT_VERSION
  drafts: QueryDraftRecord[]
}

/** Allowed keys on a draft record — anything else is stripped. */
const DRAFT_KEYS = new Set([
  'draftId',
  'connectionId',
  'database',
  'title',
  'titleCustomized',
  'sql',
  'updatedAt',
  'readOnly',
  'maxRows',
  'timeoutMs',
  'defaultRunScope',
  'savedQueryId',
])

/**
 * Dirty = document differs from last *full-document* successful run.
 * Partial runs (selection / current statement) must NOT mark the whole doc clean.
 */
export function isQueryTabDirty(opts: {
  sql: string
  /** null = never successfully ran the full document */
  lastFullDocExecutedSql: string | null
}): boolean {
  const cur = opts.sql.trim()
  if (opts.lastFullDocExecutedSql == null) {
    return cur.length > 0
  }
  return cur !== opts.lastFullDocExecutedSql.trim()
}

export type DirtyRunScope = 'selection' | 'statement' | 'all'

/**
 * Update lastFullDocExecutedSql after a successful run.
 *
 * Rules:
 * - selection / statement: NEVER clear whole-document dirty, even if executed
 *   SQL happens to equal the full document (single-statement file case).
 * - all: clear only when current full document still equals the snapshot
 *   captured at dispatch (edit-while-pending stays dirty).
 */
export function nextLastFullDocExecutedSql(opts: {
  scope: DirtyRunScope
  /** Full editor document SQL at the moment run was dispatched */
  dispatchFullDocSql: string
  /** SQL actually sent to the engine */
  executedSql: string
  /** Full editor document when the successful result is applied */
  currentFullDocSql: string
  previous: string | null
}): string | null {
  if (opts.scope === 'selection' || opts.scope === 'statement') {
    return opts.previous
  }
  // scope === 'all'
  const dispatch = opts.dispatchFullDocSql.trim()
  const current = opts.currentFullDocSql.trim()
  const exec = opts.executedSql.trim()
  if (!dispatch || !exec) return opts.previous
  // Must have run the full document snapshot
  if (exec !== dispatch) return opts.previous
  // Document must not have changed while the query was pending
  if (current !== dispatch) return opts.previous
  return dispatch
}

/** Pure rename commit: empty draft keeps previous; non-empty marks customized. */
export function applyQueryTabRename(opts: {
  draft: string
  previousTitle: string
  previousCustomized: boolean
}): { title: string; titleCustomized: boolean } {
  const name = opts.draft.trim()
  if (!name) {
    return { title: opts.previousTitle, titleCustomized: opts.previousCustomized }
  }
  return { title: name.slice(0, 120), titleCustomized: true }
}

export function cancelQueryTabRename(opts: {
  previousTitle: string
  previousCustomized: boolean
}): { title: string; titleCustomized: boolean } {
  return {
    title: opts.previousTitle,
    titleCustomized: opts.previousCustomized,
  }
}

/** First non-comment SQL line / statement snippet for tab title. */
export function sqlTitleSummary(sql: string, maxLen = QUERY_TITLE_MAX_LEN): string {
  const lines = String(sql || '').split(/\r?\n/)
  const parts: string[] = []
  let inBlock = false
  for (const line of lines) {
    let s = line
    if (inBlock) {
      const end = s.indexOf('*/')
      if (end < 0) continue
      s = s.slice(end + 2)
      inBlock = false
    }
    // strip line comments and block starts
    while (s.length) {
      const t = s.trimStart()
      if (t.startsWith('--') || t.startsWith('#')) {
        s = ''
        break
      }
      if (t.startsWith('/*')) {
        const end = t.indexOf('*/')
        if (end < 0) {
          inBlock = true
          s = ''
          break
        }
        s = t.slice(end + 2)
        continue
      }
      s = t
      break
    }
    const cleaned = s.trim()
    if (cleaned) parts.push(cleaned)
    if (parts.join(' ').length >= maxLen) break
  }
  let out = parts.join(' ').replace(/\s+/g, ' ').trim()
  if (!out) return ''
  // strip trailing semicolon for display
  out = out.replace(/;+\s*$/, '')
  if (out.length > maxLen) out = out.slice(0, maxLen - 1) + '…'
  return out
}

/**
 * Resolve display title: custom title wins; else SQL summary; else fallback.
 */
export function resolveQueryTabTitle(opts: {
  title: string
  titleCustomized: boolean
  sql: string
  fallback: string
}): string {
  if (opts.titleCustomized && opts.title.trim()) return opts.title.trim()
  const summary = sqlTitleSummary(opts.sql)
  if (summary) return summary
  if (opts.title.trim()) return opts.title.trim()
  return opts.fallback
}

export function sanitizeDraftRecord(raw: unknown): QueryDraftRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const draftId = typeof o.draftId === 'string' ? o.draftId.trim() : ''
  const connectionId = typeof o.connectionId === 'string' ? o.connectionId.trim() : ''
  if (!draftId || !connectionId) return null
  let sql = typeof o.sql === 'string' ? o.sql : ''
  if (sql.length > QUERY_DRAFT_MAX_SQL_CHARS) {
    sql = sql.slice(0, QUERY_DRAFT_MAX_SQL_CHARS)
  }
  const database = typeof o.database === 'string' ? o.database : ''
  const title = typeof o.title === 'string' ? o.title.slice(0, 120) : ''
  const titleCustomized = o.titleCustomized === true
  const updatedAt =
    typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : Date.now()
  const readOnly = o.readOnly === true
  const maxRows =
    typeof o.maxRows === 'number' && Number.isFinite(o.maxRows)
      ? Math.max(1, Math.min(100_000, Math.round(o.maxRows)))
      : undefined
  const timeoutMs =
    typeof o.timeoutMs === 'number' && Number.isFinite(o.timeoutMs)
      ? Math.max(1_000, Math.min(600_000, Math.round(o.timeoutMs)))
      : undefined
  const defaultRunScope =
    o.defaultRunScope === 'smart' ||
    o.defaultRunScope === 'selection' ||
    o.defaultRunScope === 'statement' ||
    o.defaultRunScope === 'all'
      ? o.defaultRunScope
      : undefined
  const savedQueryId = typeof o.savedQueryId === 'string' ? o.savedQueryId.trim() : null

  // Explicitly drop any secret-like keys by only returning allowed fields
  void DRAFT_KEYS
  return {
    draftId,
    connectionId,
    database,
    title,
    titleCustomized,
    sql,
    updatedAt,
    readOnly,
    maxRows,
    timeoutMs,
    defaultRunScope,
    savedQueryId,
  }
}

/**
 * Parse storage payload; corrupt / wrong version → empty list (never throws).
 */
export function parseQueryDraftFile(raw: string | null | undefined): QueryDraftFile {
  if (!raw || !raw.trim()) return { version: QUERY_DRAFT_VERSION, drafts: [] }
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return { version: QUERY_DRAFT_VERSION, drafts: [] }
    const version = (data as { version?: unknown }).version
    if (version !== QUERY_DRAFT_VERSION) {
      // Unknown future/past version: try to read drafts array if present, else ignore
      if (version != null && version !== QUERY_DRAFT_VERSION) {
        // only accept exact version for safety
        return { version: QUERY_DRAFT_VERSION, drafts: [] }
      }
    }
    const list = Array.isArray((data as { drafts?: unknown }).drafts)
      ? (data as { drafts: unknown[] }).drafts
      : []
    const drafts: QueryDraftRecord[] = []
    for (const item of list) {
      const rec = sanitizeDraftRecord(item)
      if (rec) drafts.push(rec)
      if (drafts.length >= QUERY_DRAFT_MAX_COUNT) break
    }
    return { version: QUERY_DRAFT_VERSION, drafts }
  } catch {
    return { version: QUERY_DRAFT_VERSION, drafts: [] }
  }
}

export function serializeQueryDraftFile(file: QueryDraftFile): string {
  const drafts = file.drafts
    .map((d) => sanitizeDraftRecord(d))
    .filter((d): d is QueryDraftRecord => !!d)
    .slice(0, QUERY_DRAFT_MAX_COUNT)
  return JSON.stringify({ version: QUERY_DRAFT_VERSION, drafts })
}

/** Upsert draft; newest first; enforce caps. */
export function upsertDraft(
  drafts: QueryDraftRecord[],
  next: QueryDraftRecord,
): QueryDraftRecord[] {
  const rec = sanitizeDraftRecord(next)
  if (!rec) return drafts.slice(0, QUERY_DRAFT_MAX_COUNT)
  if (!rec.sql.trim()) {
    // empty SQL → remove draft
    return drafts.filter((d) => d.draftId !== rec.draftId).slice(0, QUERY_DRAFT_MAX_COUNT)
  }
  const rest = drafts.filter((d) => d.draftId !== rec.draftId)
  return [rec, ...rest].slice(0, QUERY_DRAFT_MAX_COUNT)
}

export function removeDraft(drafts: QueryDraftRecord[], draftId: string): QueryDraftRecord[] {
  return drafts.filter((d) => d.draftId !== draftId)
}

/** Drop drafts whose connectionId is not in the known set. */
export function pruneOrphanDrafts(
  drafts: QueryDraftRecord[],
  knownConnectionIds: ReadonlySet<string>,
): QueryDraftRecord[] {
  return drafts.filter((d) => knownConnectionIds.has(d.connectionId))
}

/** Remove every draft bound to a deleted connection id. */
export function removeDraftsForConnection(
  drafts: QueryDraftRecord[],
  connectionId: string,
): QueryDraftRecord[] {
  return drafts.filter((d) => d.connectionId !== connectionId)
}

/** Drafts for a connection, newest first. */
export function draftsForConnection(
  drafts: QueryDraftRecord[],
  connectionId: string,
): QueryDraftRecord[] {
  return drafts.filter((d) => d.connectionId === connectionId)
}

/**
 * Whether a draft may be restored into the UI for a live connection.
 * Requires exact connectionId match — never rebind to another connection.
 */
export function canRestoreDraft(opts: {
  draft: QueryDraftRecord
  connectionId: string
  connectionExists: boolean
}): boolean {
  if (!opts.connectionExists) return false
  if (opts.draft.connectionId !== opts.connectionId) return false
  if (!opts.draft.sql.trim()) return false
  return true
}

/** Map query tab → draft record for persistence. */
export function tabToDraftRecord(opts: {
  tabId: string
  connectionId: string
  database: string
  title: string
  titleCustomized: boolean
  sql: string
  readOnly?: boolean
  maxRows?: number
  timeoutMs?: number
  defaultRunScope?: 'smart' | 'selection' | 'statement' | 'all'
  now?: number
  savedQueryId?: string | null
}): QueryDraftRecord | null {
  return sanitizeDraftRecord({
    draftId: opts.tabId,
    connectionId: opts.connectionId,
    database: opts.database,
    title: opts.title,
    titleCustomized: opts.titleCustomized,
    sql: opts.sql,
    readOnly: opts.readOnly === true,
    maxRows: opts.maxRows,
    timeoutMs: opts.timeoutMs,
    defaultRunScope: opts.defaultRunScope,
    updatedAt: opts.now ?? Date.now(),
    savedQueryId: opts.savedQueryId,
  })
}
