import { COLLECTIONS, getAppDatabase } from './appDatabase'
import type {
  DbQueryHistoryPushInput,
  DbQueryHistoryRunScope,
  DbQueryHistoryStatus,
} from '../db/types'
import { sanitizeDbErrorText } from '../db/dbError'

export type DbQueryHistoryItem = {
  id: string
  sql: string
  database: string
  at: number
  connectionId?: string
  status?: DbQueryHistoryStatus
  durationMs?: number
  rowCount?: number
  affectedRows?: number
  errorSummary?: string
  slow?: boolean
  runScope?: DbQueryHistoryRunScope
  truncated?: boolean
}

function normalizeRunScope(v: unknown): DbQueryHistoryRunScope | undefined {
  if (v === 'selection' || v === 'statement' || v === 'all' || v === 'explain') return v
  return undefined
}

const MAX_HISTORY = 200
const MAX_SQL_CHARS = 50_000
const SLOW_MS_DEFAULT = 2000

function normalizeStatus(v: unknown): DbQueryHistoryStatus | undefined {
  if (v === 'success' || v === 'failed' || v === 'cancelled') return v
  return undefined
}

function mapItem(x: any): DbQueryHistoryItem | null {
  if (!x || typeof x.sql !== 'string' || !x.sql.trim()) return null
  const status = normalizeStatus(x.status)
  return {
    id: String(x.id || `${x.at || Date.now()}`),
    sql: String(x.sql).slice(0, MAX_SQL_CHARS),
    database: typeof x.database === 'string' ? x.database : '',
    at: typeof x.at === 'number' ? x.at : Date.now(),
    connectionId: typeof x.connectionId === 'string' ? x.connectionId : undefined,
    status: status || (x.status == null ? 'success' : undefined),
    durationMs: typeof x.durationMs === 'number' ? x.durationMs : undefined,
    rowCount: typeof x.rowCount === 'number' ? x.rowCount : undefined,
    affectedRows: typeof x.affectedRows === 'number' ? x.affectedRows : undefined,
    errorSummary:
      typeof x.errorSummary === 'string'
        ? sanitizeDbErrorText(x.errorSummary, 200)
        : undefined,
    slow: typeof x.slow === 'boolean' ? x.slow : undefined,
    runScope: normalizeRunScope(x.runScope),
    truncated: x.truncated === true ? true : undefined,
  }
}

export class DbQueryHistoryStore {
  private items: DbQueryHistoryItem[] = []
  private initialized = false
  private initPromise: Promise<void> | null = null

  async init(): Promise<void> {
    if (this.initialized) return
    if (!this.initPromise) {
      this.initPromise = this.load().then(() => {
        this.initialized = true
      })
    }
    await this.initPromise
  }

  private async load(): Promise<void> {
    this.items = getAppDatabase()
      .getCollection<DbQueryHistoryItem>(COLLECTIONS.dbQueryHistory)
      .map((item) => mapItem(item))
      .filter((item: DbQueryHistoryItem | null): item is DbQueryHistoryItem => !!item)
      .slice(0, MAX_HISTORY)
  }

  private async persist(): Promise<void> {
    getAppDatabase().replaceCollection(
      COLLECTIONS.dbQueryHistory,
      this.items,
      (item) => item.id,
    )
  }

  list(connectionId?: string): DbQueryHistoryItem[] {
    if (!connectionId) return [...this.items]
    const mine = this.items.filter((i) => i.connectionId === connectionId)
    const others = this.items.filter((i) => i.connectionId !== connectionId)
    return [...mine, ...others]
  }

  async push(input: DbQueryHistoryPushInput): Promise<DbQueryHistoryItem[]> {
    const sql = typeof input.sql === 'string' ? input.sql.trim() : ''
    if (!sql) return this.list(input.connectionId)
    if (sql.length > MAX_SQL_CHARS) {
      throw new Error(`SQL too long for history (max ${MAX_SQL_CHARS} chars)`)
    }

    const durationMs = typeof input.durationMs === 'number' ? input.durationMs : undefined
    const status = normalizeStatus(input.status) || 'success'
    const slow =
      typeof input.slow === 'boolean'
        ? input.slow
        : durationMs != null
          ? durationMs >= SLOW_MS_DEFAULT
          : undefined

    const item: DbQueryHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sql: sql.slice(0, MAX_SQL_CHARS),
      database: typeof input.database === 'string' ? input.database.trim() : '',
      at: Date.now(),
      connectionId: typeof input.connectionId === 'string' ? input.connectionId : undefined,
      status,
      durationMs,
      rowCount: typeof input.rowCount === 'number' ? input.rowCount : undefined,
      affectedRows: typeof input.affectedRows === 'number' ? input.affectedRows : undefined,
      errorSummary:
        typeof input.errorSummary === 'string'
          ? sanitizeDbErrorText(input.errorSummary, 200)
          : undefined,
      slow,
      runScope: normalizeRunScope(input.runScope),
      truncated: input.truncated === true ? true : undefined,
    }

    // Dedupe same SQL+status keeps newest entry; still allow success/fail variants
    this.items = [
      item,
      ...this.items.filter((h) => !(h.sql === sql && (h.status || 'success') === status)),
    ].slice(0, MAX_HISTORY)
    await this.persist()
    return this.list(input.connectionId)
  }

  async clear(connectionId?: string): Promise<DbQueryHistoryItem[]> {
    if (connectionId) {
      this.items = this.items.filter((i) => i.connectionId !== connectionId)
    } else {
      this.items = []
    }
    await this.persist()
    return this.list(connectionId)
  }

  /** One-shot merge of legacy localStorage data (renderer upload). */
  async mergeLegacy(items: unknown[]): Promise<DbQueryHistoryItem[]> {
    if (!Array.isArray(items) || items.length === 0) return this.list()
    const mapped: DbQueryHistoryItem[] = []
    for (const x of items) {
      const row = mapItem(x)
      if (row) {
        // Legacy entries had no status — treat as success
        if (!row.status) row.status = 'success'
        mapped.push(row)
      }
    }
    if (mapped.length === 0) return this.list()

    const seen = new Set(this.items.map((i) => `${i.sql}\0${i.status || 'success'}`))
    const extras = mapped.filter((i) => !seen.has(`${i.sql}\0${i.status || 'success'}`))
    this.items = [...this.items, ...extras]
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_HISTORY)
    await this.persist()
    return this.list()
  }
}
