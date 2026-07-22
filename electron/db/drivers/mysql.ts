import mysql, { type Pool, type RowDataPacket, type ResultSetHeader, type FieldPacket } from 'mysql2/promise'
import { v4 as uuidv4 } from 'uuid'
import {
  assertIdent,
  cancelledError,
  clampQueryLimits,
  DEFAULT_QUERY_TIMEOUT_MS,
  quoteIdentMysql,
  sanitizeCancelError,
  serializeCell,
  validateSqlInput,
} from '../common'
import { planSqlRowLimit } from '../sqlLimit'
import { buildWhereClauseMysql } from '../browseFilter'
import {
  BrowseCountCache,
  browseCountCacheKey,
  browseHasFilter,
  finalizeBrowsePage,
} from '../browsePagination'
import type { DbDriver, DbExportStreamHandlers } from '../driver'
import type {
  DbBrowseOptions,
  DbCancelResult,
  DbColumnInfo,
  DbConnection,
  DbExportFormat,
  DbIndexInfo,
  DbQueryOptions,
  DbQueryResult,
  DbSessionInfo,
  DbTableBrowseResult,
  DbTableInfo,
  DbTestParams,
  DbTestResult,
  DbTransactionState,
} from '../types'
import { resolveSslConfig } from '../types'

/** Short-lived cancel control connection — must not share the business pool. */
const CONTROL_CONNECT_TIMEOUT_MS = 5_000
const CONTROL_QUERY_TIMEOUT_MS = 5_000

interface LiveSession {
  id: string
  connectionId: string
  connectionName: string
  host: string
  port: number
  username: string
  database: string | null
  serverVersion: string
  password: string
  /** Resolved SSL config for control connections (tunnel endpoint host/port already applied) */
  ssl: ReturnType<typeof resolveSslConfig>
  pool: Pool
}

interface ActiveQuery {
  sessionId: string
  threadId: number
  cancelled: boolean
}

/** Sticky physical connection for a query tab (DB-009). */
interface PinnedClient {
  sessionId: string
  clientKey: string
  conn: mysql.PoolConnection
  inTransaction: boolean
  database: string | null
}

/** Minimal surface for cancel control connection (mockable in tests). */
export type MysqlControlConnection = {
  query: (sql: string | { sql: string; timeout?: number }) => Promise<unknown>
  end: () => Promise<void>
}

export class MySqlDriver implements DbDriver {
  readonly engine = 'mysql' as const

  private sessions = new Map<string, LiveSession>()
  private activeQueries = new Map<string, ActiveQuery>()
  private countCache = new BrowseCountCache()
  /** In-flight background COUNT keys — dedupe concurrent warmers */
  private countWarmInflight = new Set<string>()
  /** sessionId\0clientKey -> pinned connection held for explicit transactions */
  private pinnedClients = new Map<string, PinnedClient>()

  async connect(conn: DbConnection): Promise<DbSessionInfo> {
    const ssl = resolveSslConfig(conn.ssl, conn.sslOptions)
    const password = conn.password || ''
    const pool = mysql.createPool({
      host: conn.host,
      port: conn.port || 3306,
      user: conn.username,
      password,
      database: conn.database || undefined,
      ssl: ssl || undefined,
      waitForConnections: true,
      connectionLimit: 5,
      enableKeepAlive: true,
      connectTimeout: 15_000,
      dateStrings: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
    })

    let serverVersion = ''
    let currentDb: string | null = conn.database || null
    try {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT VERSION() AS v, DATABASE() AS db')
      serverVersion = String(rows[0]?.v || '')
      if (rows[0]?.db != null) currentDb = String(rows[0].db)
    } catch (err) {
      try {
        await pool.end()
      } catch {}
      throw err
    }

    const sessionId = uuidv4()
    this.sessions.set(sessionId, {
      id: sessionId,
      connectionId: conn.id,
      connectionName: conn.name,
      host: conn.host,
      port: conn.port || 3306,
      username: conn.username,
      database: currentDb,
      serverVersion,
      password,
      ssl,
      pool,
    })

    return this.toInfo(this.sessions.get(sessionId)!)
  }

  /**
   * Dedicated short-lived connection for KILL QUERY.
   * Never uses the business pool (which may be fully saturated by long queries).
   * Overridable for tests.
   */
  protected async openControlConnection(session: LiveSession): Promise<MysqlControlConnection> {
    return mysql.createConnection({
      host: session.host,
      port: session.port,
      user: session.username,
      password: session.password,
      ssl: session.ssl || undefined,
      connectTimeout: CONTROL_CONNECT_TIMEOUT_MS,
    })
  }

  async test(conn: DbTestParams): Promise<DbTestResult> {
    const start = Date.now()
    let connection: mysql.Connection | null = null
    try {
      const ssl = resolveSslConfig(conn.ssl, conn.sslOptions)
      connection = await mysql.createConnection({
        host: conn.host,
        port: conn.port || 3306,
        user: conn.username,
        password: conn.password || '',
        database: conn.database || undefined,
        ssl: ssl || undefined,
        connectTimeout: 12_000,
      })
      const [rows] = await connection.query<RowDataPacket[]>('SELECT VERSION() AS v')
      return {
        ok: true,
        latencyMs: Date.now() - start,
        serverVersion: String(rows[0]?.v || ''),
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) }
    } finally {
      try {
        await connection?.end()
      } catch {}
    }
  }

  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    // Cancel while session/pool still available for KILL QUERY
    await this.cancelAllQueries(sessionId)
    await this.releaseAllClients(sessionId)
    this.sessions.delete(sessionId)
    this.countCache.invalidateSession(sessionId)
    // Drop inflight warm keys for this session so they cannot re-touch a closed pool
    for (const key of [...this.countWarmInflight]) {
      if (key.startsWith(`${sessionId}\0`)) this.countWarmInflight.delete(key)
    }
    try {
      await session.pool.end()
    } catch {}
  }

  private pinKey(sessionId: string, clientKey: string): string {
    return `${sessionId}\0${clientKey}`
  }

  getTransactionState(sessionId: string, clientKey: string): DbTransactionState {
    const pin = this.pinnedClients.get(this.pinKey(sessionId, clientKey))
    if (!pin || pin.sessionId !== sessionId) {
      return { clientKey, inTransaction: false, autocommit: true }
    }
    return {
      clientKey,
      inTransaction: pin.inTransaction,
      autocommit: !pin.inTransaction,
    }
  }

  async beginTransaction(
    sessionId: string,
    clientKey: string,
    database?: string,
  ): Promise<DbTransactionState> {
    if (typeof clientKey !== 'string' || !clientKey.trim()) {
      throw new Error('Invalid client key')
    }
    const key = clientKey.trim()
    const session = this.requireSession(sessionId)
    const existing = this.pinnedClients.get(this.pinKey(sessionId, key))
    if (existing?.inTransaction) {
      return this.getTransactionState(sessionId, key)
    }
    if (existing) {
      await this.releaseClient(sessionId, key)
    }
    const conn = await session.pool.getConnection()
    try {
      const useDb =
        typeof database === 'string' && database.trim() ? database.trim() : null
      if (useDb) {
        assertIdent(useDb)
        await conn.query(`USE ${quoteIdentMysql(useDb)}`)
      }
      await conn.query('SET autocommit = 0')
      await conn.query('START TRANSACTION')
      this.pinnedClients.set(this.pinKey(sessionId, key), {
        sessionId,
        clientKey: key,
        conn,
        inTransaction: true,
        database: useDb || session.database,
      })
      return { clientKey: key, inTransaction: true, autocommit: false }
    } catch (err) {
      try {
        await conn.query('SET autocommit = 1')
      } catch {}
      try {
        conn.release()
      } catch {}
      throw err
    }
  }

  /** Never release a connection that may still be in TX or protocol-broken. */
  private discardMysqlConn(conn: mysql.PoolConnection): void {
    try {
      ;(conn as any).destroy?.()
    } catch {
      try {
        conn.release()
      } catch {}
    }
  }

  async commitTransaction(sessionId: string, clientKey: string): Promise<DbTransactionState> {
    const key = typeof clientKey === 'string' ? clientKey.trim() : ''
    const pin = this.pinnedClients.get(this.pinKey(sessionId, key))
    if (!pin || pin.sessionId !== sessionId) {
      return { clientKey: key, inTransaction: false, autocommit: true }
    }
    this.pinnedClients.delete(this.pinKey(sessionId, key))
    try {
      await pin.conn.query('COMMIT')
      await pin.conn.query('SET autocommit = 1')
      try {
        pin.conn.release()
      } catch {}
      return { clientKey: key, inTransaction: false, autocommit: true }
    } catch (err) {
      // TX or session may be corrupt — never return to pool
      this.discardMysqlConn(pin.conn)
      throw err
    }
  }

  async rollbackTransaction(sessionId: string, clientKey: string): Promise<DbTransactionState> {
    const key = typeof clientKey === 'string' ? clientKey.trim() : ''
    const pin = this.pinnedClients.get(this.pinKey(sessionId, key))
    if (!pin || pin.sessionId !== sessionId) {
      return { clientKey: key, inTransaction: false, autocommit: true }
    }
    this.pinnedClients.delete(this.pinKey(sessionId, key))
    try {
      await pin.conn.query('ROLLBACK')
      await pin.conn.query('SET autocommit = 1')
      try {
        pin.conn.release()
      } catch {}
      return { clientKey: key, inTransaction: false, autocommit: true }
    } catch (err) {
      this.discardMysqlConn(pin.conn)
      throw err
    }
  }

  async releaseClient(sessionId: string, clientKey: string): Promise<void> {
    const key = typeof clientKey === 'string' ? clientKey.trim() : ''
    const pin = this.pinnedClients.get(this.pinKey(sessionId, key))
    if (!pin || pin.sessionId !== sessionId) return
    this.pinnedClients.delete(this.pinKey(sessionId, key))
    let ok = false
    try {
      if (pin.inTransaction) {
        await pin.conn.query('ROLLBACK')
      }
      await pin.conn.query('SET autocommit = 1')
      ok = true
    } catch {
      ok = false
    }
    if (ok) {
      try {
        pin.conn.release()
      } catch {}
    } else {
      this.discardMysqlConn(pin.conn)
    }
  }

  async releaseAllClients(sessionId: string): Promise<void> {
    const keys = [...this.pinnedClients.entries()]
      .filter(([, p]) => p.sessionId === sessionId)
      .map(([, p]) => p.clientKey)
    for (const k of keys) {
      await this.releaseClient(sessionId, k)
    }
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.disconnect(id)))
  }

  async cancelAllQueries(sessionId: string): Promise<void> {
    const entries = [...this.activeQueries.entries()].filter(([, q]) => q.sessionId === sessionId)
    if (entries.length === 0) return
    const session = this.sessions.get(sessionId)
    if (!session) return
    let control: MysqlControlConnection | null = null
    try {
      control = await this.openControlConnection(session)
      for (const [queryId, active] of entries) {
        try {
          await control.query({
            sql: `KILL QUERY ${Number(active.threadId)}`,
            timeout: CONTROL_QUERY_TIMEOUT_MS,
          })
          const still = this.activeQueries.get(queryId)
          if (still && still.sessionId === sessionId) {
            still.cancelled = true
          }
        } catch {
          // best-effort per query
        }
      }
    } catch {
      // control connect failed — fall back to per-query path (still independent of business pool)
      for (const [queryId] of entries) {
        try {
          await this.cancelQuery(sessionId, queryId)
        } catch {}
      }
    } finally {
      if (control) {
        try {
          await control.end()
        } catch {}
      }
    }
  }

  async disconnectByConnectionId(connectionId: string): Promise<void> {
    const ids = [...this.sessions.values()]
      .filter((s) => s.connectionId === connectionId)
      .map((s) => s.id)
    for (const id of ids) {
      await this.disconnect(id)
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  getSession(sessionId: string): DbSessionInfo | null {
    const s = this.sessions.get(sessionId)
    return s ? this.toInfo(s) : null
  }

  async listDatabases(sessionId: string): Promise<string[]> {
    const session = this.requireSession(sessionId)
    const [rows] = await session.pool.query<RowDataPacket[]>('SHOW DATABASES')
    return rows.map((r) => String(r.Database ?? Object.values(r)[0] ?? '')).filter(Boolean)
  }

  async listTables(sessionId: string, database?: string): Promise<string[]> {
    const infos = await this.listTableInfos(sessionId, database)
    return infos.map((t) => t.name)
  }

  async listTableInfos(sessionId: string, database?: string): Promise<DbTableInfo[]> {
    const session = this.requireSession(sessionId)
    const schema = database || session.database
    if (!schema) {
      const [rows] = await session.pool.query<RowDataPacket[]>('SHOW FULL TABLES')
      return rows
        .map((r) => {
          const vals = Object.values(r)
          const name = String(vals[0] ?? '')
          const typeRaw = String(vals[1] ?? 'BASE TABLE').toUpperCase()
          return {
            name,
            type: typeRaw.includes('VIEW') ? ('view' as const) : ('table' as const),
            engine: null,
            rows: null,
            comment: '',
          }
        })
        .filter((t) => t.name)
    }

    const [rows] = await session.pool.query<RowDataPacket[]>(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS tableType, ENGINE AS engine,
              TABLE_ROWS AS rowEstimate, TABLE_COMMENT AS comment
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_TYPE, TABLE_NAME`,
      [schema],
    )
    return rows
      .map((r) => ({
        name: String(r.name || ''),
        type: String(r.tableType || '').toUpperCase().includes('VIEW')
          ? ('view' as const)
          : ('table' as const),
        engine: r.engine != null ? String(r.engine) : null,
        rows: r.rowEstimate != null && r.rowEstimate !== '' ? Number(r.rowEstimate) : null,
        comment: r.comment != null ? String(r.comment) : '',
      }))
      .filter((t) => t.name)
  }

  async getTableColumns(sessionId: string, database: string, table: string): Promise<DbColumnInfo[]> {
    const session = this.requireSession(sessionId)
    assertIdent(database)
    assertIdent(table)
    const [rows] = await session.pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
              COLUMN_KEY AS colKey, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra,
              COLUMN_COMMENT AS comment
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [database, table],
    )
    return rows.map((r) => ({
      name: String(r.name || ''),
      type: String(r.type || ''),
      nullable: String(r.nullable || '').toUpperCase() === 'YES',
      key: String(r.colKey || ''),
      defaultValue: r.defaultValue === undefined ? null : (r.defaultValue as string | null),
      extra: String(r.extra || ''),
      comment: String(r.comment || ''),
    }))
  }

  async getTableIndexes(
    sessionId: string,
    database: string,
    table: string,
  ): Promise<DbIndexInfo[]> {
    const session = this.requireSession(sessionId)
    assertIdent(database)
    assertIdent(table)
    const [rows] = await session.pool.query<RowDataPacket[]>(
      `SELECT INDEX_NAME AS name, COLUMN_NAME AS colName, NON_UNIQUE AS nonUnique,
              SEQ_IN_INDEX AS seq, INDEX_TYPE AS indexType, INDEX_COMMENT AS comment
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [database, table],
    )
    const map = new Map<string, DbIndexInfo>()
    for (const r of rows) {
      const name = String(r.name || '')
      if (!name) continue
      let idx = map.get(name)
      if (!idx) {
        idx = {
          name,
          columns: [],
          unique: Number(r.nonUnique) === 0,
          primary: name === 'PRIMARY',
          type: String(r.indexType || ''),
          comment: r.comment != null ? String(r.comment) : '',
        }
        map.set(name, idx)
      }
      const col = String(r.colName || '')
      if (col) idx.columns.push(col)
    }
    return [...map.values()]
  }

  async getCreateTable(sessionId: string, database: string, table: string): Promise<string> {
    const session = this.requireSession(sessionId)
    assertIdent(database)
    assertIdent(table)
    const fq = `${quoteIdentMysql(database)}.${quoteIdentMysql(table)}`
    const [rows] = await session.pool.query<RowDataPacket[]>(`SHOW CREATE TABLE ${fq}`)
    const row = rows[0] || {}
    return String(row['Create Table'] ?? row['Create View'] ?? Object.values(row)[1] ?? '')
  }

  async browseTable(
    sessionId: string,
    database: string,
    table: string,
    page = 1,
    pageSize = 100,
    options?: DbBrowseOptions,
  ): Promise<DbTableBrowseResult> {
    const session = this.requireSession(sessionId)
    assertIdent(database)
    assertIdent(table)
    const safePage = Math.max(1, Math.floor(page) || 1)
    const safeSize = Math.min(Math.max(Math.floor(pageSize) || 100, 1), 500)
    const offset = (safePage - 1) * safeSize
    const fq = `${quoteIdentMysql(database)}.${quoteIdentMysql(table)}`

    let searchCols = options?.searchColumns
    if (options?.search && (!searchCols || searchCols.length === 0)) {
      const cols = await this.getTableColumns(sessionId, database, table)
      searchCols = cols
        .filter((c) => !/blob|binary|json/i.test(c.type))
        .map((c) => c.name)
        .slice(0, 32)
    }
    const where = buildWhereClauseMysql(
      searchCols ? { ...options, searchColumns: searchCols } : options,
      searchCols || [],
    )

    let orderClause = ''
    if (options?.orderBy) {
      assertIdent(options.orderBy)
      const dir = options.orderDir === 'desc' ? 'DESC' : 'ASC'
      orderClause = ` ORDER BY ${quoteIdentMysql(options.orderBy)} ${dir}`
    }

    const start = Date.now()
    const hasFilter = browseHasFilter(options)
    const cacheKey = browseCountCacheKey(sessionId, database, table, options)
    let exactTotal = this.countCache.get(cacheKey)

    // pageSize+1 so hasNext is known without a full COUNT
    const [result, fields] = await session.pool.query({
      sql: `SELECT * FROM ${fq}${where.clause}${orderClause} LIMIT ${safeSize + 1} OFFSET ${offset}`,
      timeout: DEFAULT_QUERY_TIMEOUT_MS,
      values: where.params,
    })
    const durationMs = Date.now() - start
    const rows = result as RowDataPacket[]
    const fieldList = (fields || []) as FieldPacket[]
    const columns = fieldList.map((f) => f.name)
    const mapped = rows.map((row) => {
      const out: Record<string, unknown> = {}
      for (const col of columns) out[col] = serializeCell((row as any)[col], { column: col })
      return out
    })

    // Optional exact count from cache only on the hot path; warm cache in background when missing
    if (exactTotal == null && !hasFilter) {
      // Prefer cheap estimate for unfiltered large tables
      let estimatedTotal: number | null = null
      try {
        const [estRows] = await session.pool.query<RowDataPacket[]>(
          `SELECT TABLE_ROWS AS c FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1`,
          [database, table],
        )
        if (estRows[0]?.c != null && estRows[0].c !== '') {
          estimatedTotal = Number(estRows[0].c)
        }
      } catch {
        estimatedTotal = null
      }
      // Fire-and-forget exact COUNT for subsequent pages (does not block first paint)
      void this.warmExactCount(session, cacheKey, fq, where.clause, where.params)
      return finalizeBrowsePage({
        rows: mapped,
        columns,
        page: safePage,
        pageSize: safeSize,
        durationMs,
        exactTotal: null,
        estimatedTotal,
        hasFilter: false,
      })
    }

    if (exactTotal == null && hasFilter) {
      // With filter: do not block on COUNT; schedule async warm for later pages
      void this.warmExactCount(session, cacheKey, fq, where.clause, where.params)
      return finalizeBrowsePage({
        rows: mapped,
        columns,
        page: safePage,
        pageSize: safeSize,
        durationMs,
        exactTotal: null,
        estimatedTotal: null,
        hasFilter: true,
      })
    }

    return finalizeBrowsePage({
      rows: mapped,
      columns,
      page: safePage,
      pageSize: safeSize,
      durationMs,
      exactTotal,
      estimatedTotal: null,
      hasFilter,
    })
  }

  private async warmExactCount(
    session: LiveSession,
    cacheKey: string,
    fq: string,
    whereClause: string,
    whereParams: unknown[],
  ): Promise<void> {
    if (this.countCache.get(cacheKey) != null) return
    if (this.countWarmInflight.has(cacheKey)) return
    this.countWarmInflight.add(cacheKey)
    try {
      // Session may have been disconnected after browse returned
      if (!this.sessions.has(session.id) || this.sessions.get(session.id) !== session) return
      const [countRows] = await session.pool.query<RowDataPacket[]>({
        sql: `SELECT COUNT(*) AS c FROM ${fq}${whereClause}`,
        timeout: DEFAULT_QUERY_TIMEOUT_MS,
        values: whereParams,
      })
      if (!this.sessions.has(session.id) || this.sessions.get(session.id) !== session) return
      const total = Number(countRows[0]?.c ?? 0)
      if (Number.isFinite(total) && total >= 0) {
        this.countCache.set(cacheKey, total)
      }
    } catch {
      // background count is best-effort; never throw to caller
    } finally {
      this.countWarmInflight.delete(cacheKey)
    }
  }

  async useDatabase(sessionId: string, database: string): Promise<void> {
    const session = this.requireSession(sessionId)
    assertIdent(database)
    await session.pool.query(`USE ${quoteIdentMysql(database)}`)
    session.database = database
  }

  async createDatabase(
    sessionId: string,
    name: string,
    options?: { charset?: string; collate?: string },
  ): Promise<void> {
    const session = this.requireSession(sessionId)
    assertIdent(name)
    const parts = [`CREATE DATABASE ${quoteIdentMysql(name)}`]
    if (options?.charset && /^[A-Za-z0-9_]+$/.test(options.charset)) {
      parts.push(`CHARACTER SET ${options.charset}`)
    }
    if (options?.collate && /^[A-Za-z0-9_.]+$/.test(options.collate)) {
      parts.push(`COLLATE ${options.collate}`)
    }
    await session.pool.query(parts.join(' '))
  }

  async cancelQuery(sessionId: string, queryId: string): Promise<DbCancelResult> {
    if (typeof queryId !== 'string' || !queryId.trim()) {
      return { status: 'already_finished' }
    }
    const active = this.activeQueries.get(queryId)
    if (!active || active.sessionId !== sessionId) {
      return { status: 'already_finished' }
    }
    const session = this.sessions.get(sessionId)
    if (!session) {
      // No control plane; do not set cancelled / do not claim requested
      return { status: 'already_finished' }
    }
    let control: MysqlControlConnection | null = null
    try {
      // Independent of business pool saturation
      control = await this.openControlConnection(session)
      await control.query({
        sql: `KILL QUERY ${Number(active.threadId)}`,
        timeout: CONTROL_QUERY_TIMEOUT_MS,
      })
      // Race with natural finish: only mark cancelled if still active after server accepted
      const still = this.activeQueries.get(queryId)
      if (!still || still.sessionId !== sessionId) {
        return { status: 'already_finished' }
      }
      still.cancelled = true
      return { status: 'cancelled' }
    } catch (err: any) {
      const msg = String(err?.message || err || 'KILL QUERY failed')
      // Unknown thread id ≈ query already finished — do not pollute active.cancelled
      if (
        /Unknown thread id/i.test(msg)
        || err?.errno === 1094
        || err?.code === 'ER_NO_SUCH_THREAD'
      ) {
        return { status: 'already_finished' }
      }
      // failed: leave active.cancelled false so natural result is not rewritten as cancelled
      return { status: 'failed', error: sanitizeCancelError(msg) }
    } finally {
      if (control) {
        try {
          await control.end()
        } catch {}
      }
    }
  }

  async query(sessionId: string, sql: string, options?: DbQueryOptions): Promise<DbQueryResult> {
    const session = this.requireSession(sessionId)
    const trimmed = validateSqlInput(sql)
    const { maxRows, timeoutMs } = clampQueryLimits(options)
    const queryId =
      typeof options?.queryId === 'string' && options.queryId.trim()
        ? options.queryId.trim()
        : null
    const useDb =
      typeof options?.database === 'string' && options.database.trim()
        ? options.database.trim()
        : null
    const clientKey =
      typeof options?.clientKey === 'string' && options.clientKey.trim()
        ? options.clientKey.trim()
        : null

    const pin =
      clientKey ? this.pinnedClients.get(this.pinKey(sessionId, clientKey)) : undefined
    const usePinned = !!(pin && pin.inTransaction)
    const conn = usePinned ? pin!.conn : await session.pool.getConnection()
    const start = Date.now()
    /** When false, connection was destroyed (not released) — must not release again. */
    let connectionReusable = true
    try {
      if (queryId) {
        const [idRows] = await conn.query<RowDataPacket[]>('SELECT CONNECTION_ID() AS id')
        const threadId = Number(idRows[0]?.id)
        this.activeQueries.set(queryId, { sessionId, threadId, cancelled: false })
      }

      if (useDb) {
        assertIdent(useDb)
        await conn.query(`USE ${quoteIdentMysql(useDb)}`)
        if (usePinned) pin!.database = useDb
      }

      if (queryId && this.activeQueries.get(queryId)?.cancelled) {
        throw cancelledError()
      }

      const plan = planSqlRowLimit(trimmed, maxRows)
      if (plan.mode === 'unsupported') {
        throw new Error(plan.error)
      }

      // Prefer server-side LIMIT rewrite; stream for complex SELECT; plain for SELECT INTO etc.
      // While pinned in a user TX, avoid stream path that may destroy the connection.
      if (plan.mode === 'stream' && !usePinned) {
        try {
          const streamed = await this.queryStreamCapped(
            conn,
            trimmed,
            maxRows,
            timeoutMs,
            start,
            queryId,
          )
          connectionReusable = streamed.connectionReusable
          return streamed.result
        } catch (streamErr: any) {
          // Truncate/cancel/error may have destroyed the physical connection
          if (streamErr?.connectionReusable === false) {
            connectionReusable = false
          }
          throw streamErr
        }
      }

      const sqlToRun =
        plan.mode === 'rewrite'
          ? plan.sql
          : plan.mode === 'stream' && usePinned
            ? trimmed
            : trimmed /* plain | none | stream-on-pin */
      const [result, fields] = await conn.query({
        sql: sqlToRun,
        timeout: timeoutMs,
      })

      if (queryId && this.activeQueries.get(queryId)?.cancelled) {
        throw cancelledError()
      }

      const durationMs = Date.now() - start

      if (Array.isArray(result) && fields && Array.isArray(fields)) {
        const rows = result as RowDataPacket[]
        const fieldList = fields as FieldPacket[]
        const columns = fieldList.map((f) => f.name)
        // rewrite used maxRows+1; post-slice preserves truncated semantics
        const allowTruncate = plan.mode === 'rewrite' || (plan.mode === 'stream' && usePinned)
        const truncated = allowTruncate && rows.length > maxRows
        const sliced = truncated ? rows.slice(0, maxRows) : rows
        const mapped = sliced.map((row) => {
          const out: Record<string, unknown> = {}
          for (const col of columns) {
            out[col] = serializeCell((row as any)[col])
          }
          return out
        })
        return {
          columns,
          rows: mapped,
          rowCount: mapped.length,
          truncated,
          durationMs,
          hasResultSet: true,
        }
      }

      const header = result as ResultSetHeader
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        affectedRows: header.affectedRows,
        insertId: header.insertId,
        durationMs,
        hasResultSet: false,
      }
    } catch (err: any) {
      if (queryId && this.activeQueries.get(queryId)?.cancelled) {
        throw cancelledError()
      }
      if (err?.errno === 1317 || err?.code === 'ER_QUERY_INTERRUPTED') {
        throw cancelledError()
      }
      throw err
    } finally {
      if (queryId) this.activeQueries.delete(queryId)
      // Never release a pinned TX connection back to the pool mid-transaction
      if (connectionReusable && !usePinned) {
        try {
          conn.release()
        } catch {}
      } else if (!connectionReusable && usePinned && clientKey) {
        // Stream destroyed pin — drop pin entry without double-release
        this.pinnedClients.delete(this.pinKey(sessionId, clientKey))
      }
    }
  }

  /**
   * Full-table export stream (DB-012). Independent of UI maxRows; uses raw stream.
   */
  async exportTableStream(
    sessionId: string,
    database: string,
    table: string,
    options: {
      browse?: DbBrowseOptions
      maxRows: number
      format: DbExportFormat
    } & DbExportStreamHandlers,
  ): Promise<{ columns: string[]; rowsWritten: number; truncated: boolean }> {
    const session = this.requireSession(sessionId)
    assertIdent(database)
    assertIdent(table)
    const maxRows = Math.min(Math.max(options.maxRows || 1_000_000, 1), 5_000_000)
    // Prefer filter/order only; free-text search needs column list — omit when unknown
    const searchCols = options.browse?.searchColumns || []
    const where = buildWhereClauseMysql(
      options.browse?.search && !searchCols.length
        ? { ...options.browse, search: undefined }
        : options.browse,
      searchCols,
    )
    let orderSql = ''
    if (options.browse?.orderBy) {
      assertIdent(options.browse.orderBy)
      orderSql = ` ORDER BY ${quoteIdentMysql(options.browse.orderBy)} ${
        options.browse.orderDir === 'desc' ? 'DESC' : 'ASC'
      }`
    }
    const sql =
      `SELECT * FROM ${quoteIdentMysql(database)}.${quoteIdentMysql(table)}`
      + (where.clause || '')
      + orderSql

    const conn = await session.pool.getConnection()
    /** false → destroy physical conn (stream.destroy does not stop COM_QUERY). */
    let connectionReusable = true
    let columns: string[] = []
    let rowsWritten = 0
    let truncated = false
    let cancelPoll: ReturnType<typeof setInterval> | null = null

    try {
      await new Promise<void>((resolve, reject) => {
        const raw = (conn as any).connection
        if (!raw || typeof raw.query !== 'function') {
          reject(new Error('MySQL streaming requires raw connection'))
          return
        }
        const queryCmd = where.params.length
          ? raw.query(sql, where.params)
          : raw.query(sql)
        if (!queryCmd || typeof queryCmd.stream !== 'function') {
          reject(new Error('MySQL driver does not support query streaming'))
          return
        }
        const stream = queryCmd.stream({ highWaterMark: 64, objectMode: true })
        let settled = false
        const finish = (fn: () => void) => {
          if (settled) return
          settled = true
          if (cancelPoll) {
            clearInterval(cancelPoll)
            cancelPoll = null
          }
          try {
            stream.destroy()
          } catch {}
          fn()
        }

        const abortExport = (err: Error) => {
          connectionReusable = false
          // Kill protocol consumer: destroy pool connection immediately
          try {
            ;(conn as any).destroy?.()
          } catch {}
          finish(() => reject(err))
        }

        // Poll cancel even when stream is paused waiting on onRow
        cancelPoll = setInterval(() => {
          if (settled) return
          if (options.isCancelled()) {
            abortExport(
              Object.assign(new Error('Export cancelled'), { code: 'EXPORT_CANCELLED' }),
            )
          }
        }, 50)
        if (typeof cancelPoll === 'object' && cancelPoll && 'unref' in cancelPoll) {
          ;(cancelPoll as NodeJS.Timeout).unref?.()
        }

        stream.on('fields', (fields: FieldPacket[]) => {
          columns = (fields || []).map((f) => f.name)
          void options.onColumns?.(columns)
        })

        stream.on('data', (row: RowDataPacket) => {
          if (options.isCancelled()) {
            abortExport(
              Object.assign(new Error('Export cancelled'), { code: 'EXPORT_CANCELLED' }),
            )
            return
          }
          if (rowsWritten >= maxRows) {
            truncated = true
            connectionReusable = false
            try {
              ;(conn as any).destroy?.()
            } catch {}
            finish(() => resolve())
            return
          }
          if (!columns.length) columns = Object.keys(row)
          const out: Record<string, unknown> = {}
          for (const col of columns) {
            out[col] = serializeCell((row as any)[col], { column: col })
          }
          rowsWritten++
          const maybe = options.onRow(out, columns)
          if (maybe && typeof (maybe as Promise<void>).then === 'function') {
            stream.pause()
            void Promise.resolve(maybe)
              .then(() => {
                if (!settled) {
                  if (options.isCancelled()) {
                    abortExport(
                      Object.assign(new Error('Export cancelled'), { code: 'EXPORT_CANCELLED' }),
                    )
                    return
                  }
                  stream.resume()
                }
              })
              .catch((err) => {
                abortExport(err instanceof Error ? err : new Error(String(err)))
              })
          }
        })

        stream.on('error', (err: Error) => {
          // destroy() after cancel may surface as error — map if already cancelling
          if (options.isCancelled() || (err as any)?.code === 'EXPORT_CANCELLED') {
            abortExport(
              Object.assign(new Error('Export cancelled'), { code: 'EXPORT_CANCELLED' }),
            )
            return
          }
          connectionReusable = false
          finish(() => reject(err))
        })

        stream.on('end', () => {
          finish(() => resolve())
        })
      })

      return { columns, rowsWritten, truncated }
    } finally {
      if (cancelPoll) {
        clearInterval(cancelPoll)
        cancelPoll = null
      }
      if (connectionReusable) {
        try {
          conn.release()
        } catch {}
      } else {
        try {
          ;(conn as any).destroy?.()
        } catch {
          try {
            conn.release()
          } catch {}
        }
      }
    }
  }

  /**
   * True streaming via mysql2 raw (non-promise) connection.query().stream().
   * SQL runs once; at most maxRows rows are retained; the (maxRows+1)th row only sets truncated.
   *
   * mysql2 Query.stream()._destroy only removes listeners + resume — it does NOT stop the
   * protocol consumer. Early truncate therefore destroys the physical pool connection so it
   * is never released while still busy.
   */
  private queryStreamCapped(
    conn: mysql.PoolConnection,
    sql: string,
    maxRows: number,
    timeoutMs: number,
    start: number,
    queryId: string | null,
  ): Promise<{ result: DbQueryResult; connectionReusable: boolean }> {
    return new Promise((resolve, reject) => {
      const rows: Record<string, unknown>[] = []
      let columns: string[] = []
      let truncated = false
      let settled = false
      let sawResultSet = false
      /** false once we discard the physical connection (truncate / mid-stream cancel). */
      let connectionReusable = true
      let stream: any = null

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        fn()
      }

      /**
       * Discard pool connection: stream.destroy does not end COM_QUERY consumption.
       * PromisePoolConnection.destroy() → core connection.destroy() removes it from the pool.
       */
      const discardConnection = () => {
        connectionReusable = false
        try {
          stream?.destroy()
        } catch {}
        try {
          // Prefer promise wrapper destroy (pool-aware)
          if (typeof (conn as any).destroy === 'function') {
            ;(conn as any).destroy()
          } else {
            const rawConn = (conn as any).connection
            if (rawConn && typeof rawConn.destroy === 'function') rawConn.destroy()
          }
        } catch {}
      }

      // Promise PoolConnection wraps a raw connection; only raw.query returns Query with .stream()
      const raw = (conn as any).connection
      if (!raw || typeof raw.query !== 'function') {
        finish(() => reject(new Error('MySQL streaming requires raw connection')))
        return
      }

      let queryCmd: any
      try {
        queryCmd = raw.query({ sql, timeout: timeoutMs })
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))))
        return
      }

      if (!queryCmd || typeof queryCmd.stream !== 'function') {
        finish(() => reject(new Error('MySQL driver does not support query streaming')))
        return
      }

      stream = queryCmd.stream({ highWaterMark: 32, objectMode: true })

      stream.on('fields', (fields: FieldPacket[]) => {
        sawResultSet = true
        if (Array.isArray(fields)) columns = fields.map((f) => f.name)
      })

      stream.on('data', (row: RowDataPacket) => {
        sawResultSet = true
        if (settled) return
        if (queryId && this.activeQueries.get(queryId)?.cancelled) {
          discardConnection()
          finish(() =>
            reject(Object.assign(cancelledError(), { connectionReusable: false })),
          )
          return
        }
        // maxRows+1st row: mark truncated, keep only maxRows, discard connection (not release)
        if (rows.length >= maxRows) {
          truncated = true
          discardConnection()
          finish(() =>
            resolve({
              connectionReusable: false,
              result: {
                columns,
                rows,
                rowCount: rows.length,
                truncated: true,
                durationMs: Date.now() - start,
                hasResultSet: true,
              },
            }),
          )
          return
        }
        const out: Record<string, unknown> = {}
        if (columns.length === 0) columns = Object.keys(row)
        for (const col of columns) out[col] = serializeCell((row as any)[col])
        rows.push(out)
      })

      const rejectDiscarded = (err: Error) => {
        if (connectionReusable) discardConnection()
        finish(() =>
          reject(Object.assign(err, { connectionReusable: false as const })),
        )
      }

      stream.on('error', (err: Error) => {
        if (settled) return
        if (queryId && this.activeQueries.get(queryId)?.cancelled) {
          rejectDiscarded(cancelledError())
          return
        }
        // Protocol/stream error mid-flight: never release a half-consumed conn
        rejectDiscarded(err)
      })

      stream.on('end', () => {
        if (settled) return
        if (queryId && this.activeQueries.get(queryId)?.cancelled) {
          rejectDiscarded(cancelledError())
          return
        }
        // Full drain — connection is idle and safe to release
        finish(() =>
          resolve({
            connectionReusable: true,
            result: {
              columns,
              rows,
              rowCount: rows.length,
              truncated,
              durationMs: Date.now() - start,
              hasResultSet: sawResultSet || columns.length > 0 || rows.length > 0,
            },
          }),
        )
      })
    })
  }

  private requireSession(sessionId: string): LiveSession {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error('Database session not found')
    return s
  }

  private toInfo(s: LiveSession): DbSessionInfo {
    return {
      sessionId: s.id,
      connectionId: s.connectionId,
      connectionName: s.connectionName,
      engine: 'mysql',
      host: s.host,
      port: s.port,
      username: s.username,
      database: s.database,
      serverVersion: s.serverVersion,
    }
  }
}
