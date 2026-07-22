import { Client, Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import {
  assertIdent,
  cancelledError,
  clampQueryLimits,
  DEFAULT_QUERY_TIMEOUT_MS,
  quoteIdentPostgres,
  sanitizeCancelError,
  serializeCell,
  validateSqlInput,
} from '../common'
import { isPostgresCursorSafe, planSqlRowLimit } from '../sqlLimit'
import { buildWhereClausePg } from '../browseFilter'
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

interface LiveSession {
  id: string
  connectionId: string
  connectionName: string
  host: string
  port: number
  username: string
  /** Default / last-selected database for session info / footer */
  database: string | null
  serverVersion: string
  password: string
  ssl: boolean
  sslOptions?: DbConnection['sslOptions']
  /**
   * Pools isolated by database name (sessionId + database).
   * Concurrent tabs must not replace a shared pool.
   */
  pools: Map<string, Pool>
  /** Last activity per database pool for idle eviction */
  poolLastUsed: Map<string, number>
}

interface ActiveQuery {
  sessionId: string
  /** Database this query runs against (for cancel pool selection) */
  database: string
  /** PostgreSQL backend pid for pg_cancel_backend */
  pid: number
  cancelled: boolean
  client: PoolClient | null
}

/** Sticky PoolClient for a query tab transaction (DB-009). */
interface PinnedClient {
  sessionId: string
  clientKey: string
  client: PoolClient
  inTransaction: boolean
  database: string
}

const POOL_IDLE_EVICT_MS = 5 * 60_000
/** Short-lived cancel control client — must not share saturated business pools. */
const CONTROL_CONNECT_TIMEOUT_MS = 5_000
const CONTROL_STATEMENT_TIMEOUT_MS = 5_000

/** Minimal surface for cancel control client (mockable in tests). */
export type PostgresControlClient = {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ) => Promise<QueryResult<T>>
  end: () => Promise<void>
}

/**
 * Postgres driver.
 * UI "database" maps to a real PostgreSQL database.
 * Pools are keyed by sessionId + database so concurrent tabs never swap a shared pool.
 * Tables listed from non-system schemas; non-public tables shown as schema.table.
 */
export class PostgresDriver implements DbDriver {
  readonly engine = 'postgres' as const

  private sessions = new Map<string, LiveSession>()
  private activeQueries = new Map<string, ActiveQuery>()
  private countCache = new BrowseCountCache()
  /** In-flight background COUNT keys — dedupe concurrent warmers */
  private countWarmInflight = new Set<string>()
  /**
   * Single-flight pool creation: sessionId\0database -> promise.
   * Prevents concurrent getPool miss from creating duplicate pools.
   */
  private poolCreateInflight = new Map<string, Promise<Pool>>()
  private idleTimer: ReturnType<typeof setInterval> | null = null
  /** sessionId\0clientKey -> pinned client held for explicit transactions */
  private pinnedClients = new Map<string, PinnedClient>()

  constructor() {
    this.idleTimer = setInterval(() => {
      void this.evictIdlePools()
    }, 60_000)
    if (typeof this.idleTimer === 'object' && this.idleTimer && 'unref' in this.idleTimer) {
      ;(this.idleTimer as NodeJS.Timeout).unref?.()
    }
  }

  private poolCreateKey(sessionId: string, database: string): string {
    return `${sessionId}\0${database}`
  }

  /** Resolve or create a pool for sessionId + database (never swaps a shared pool). */
  private async getPool(sessionId: string, database?: string | null): Promise<{ session: LiveSession; pool: Pool; database: string }> {
    const session = this.requireSession(sessionId)
    const db =
      (typeof database === 'string' && database.trim()
        ? database.trim()
        : session.database || 'postgres') || 'postgres'
    assertIdent(db)
    let pool = session.pools.get(db)
    if (!pool) {
      const inflightKey = this.poolCreateKey(sessionId, db)
      let creating = this.poolCreateInflight.get(inflightKey)
      if (!creating) {
        creating = this.createAndRegisterPool(session, sessionId, db)
        this.poolCreateInflight.set(inflightKey, creating)
        // Clear inflight on settle; attach catch so detached cleanup never unhandles
        void creating
          .finally(() => {
            if (this.poolCreateInflight.get(inflightKey) === creating) {
              this.poolCreateInflight.delete(inflightKey)
            }
          })
          .catch(() => {})
      }
      try {
        pool = await creating
      } catch (err) {
        throw err
      }
      // Session may have been disconnected while waiting on another creator
      if (!this.sessions.has(sessionId)) {
        throw new Error('Database session not found')
      }
    }
    const live = this.requireSession(sessionId)
    live.poolLastUsed.set(db, Date.now())
    return { session: live, pool, database: db }
  }

  /** Create pool, verify only if session still live; single-flight owner. */
  private async createAndRegisterPool(
    session: LiveSession,
    sessionId: string,
    db: string,
  ): Promise<Pool> {
    const pool = this.createPool(
      {
        host: session.host,
        port: session.port,
        username: session.username,
        password: session.password,
        ssl: session.ssl,
        sslOptions: session.sslOptions,
      },
      db,
    )
    try {
      await pool.query('SELECT 1')
    } catch (err) {
      try {
        await pool.end()
      } catch {}
      throw err
    }
    const live = this.sessions.get(sessionId)
    if (!live || live !== session) {
      try {
        await pool.end()
      } catch {}
      throw new Error('Database session not found')
    }
    const existing = live.pools.get(db)
    if (existing) {
      try {
        await pool.end()
      } catch {}
      return existing
    }
    live.pools.set(db, pool)
    return pool
  }

  private async evictIdlePools(): Promise<void> {
    const now = Date.now()
    for (const session of this.sessions.values()) {
      const defaultDb = session.database || 'postgres'
      for (const [db, pool] of [...session.pools.entries()]) {
        if (db === defaultDb) continue
        const last = session.poolLastUsed.get(db) || 0
        if (now - last < POOL_IDLE_EVICT_MS) continue
        // Skip if any active query uses this database
        const busy = [...this.activeQueries.values()].some(
          (q) => q.sessionId === session.id && q.database === db,
        )
        if (busy) continue
        // Skip if pinned TX client holds this database
        const pinBusy = [...this.pinnedClients.values()].some(
          (p) => p.sessionId === session.id && p.database === db,
        )
        if (pinBusy) continue
        // Skip while pool create is still in-flight for this key
        if (this.poolCreateInflight.has(this.poolCreateKey(session.id, db))) continue
        session.pools.delete(db)
        session.poolLastUsed.delete(db)
        try {
          await pool.end()
        } catch {}
      }
    }
  }

  async connect(conn: DbConnection): Promise<DbSessionInfo> {
    const database = (conn.database || 'postgres').trim() || 'postgres'
    const pool = this.createPool(conn, database)

    let serverVersion = ''
    let currentDb: string | null = database
    try {
      const res = await pool.query<{ v: string; db: string }>(
        'SELECT version() AS v, current_database() AS db',
      )
      serverVersion = String(res.rows[0]?.v || '')
      if (res.rows[0]?.db) currentDb = String(res.rows[0].db)
    } catch (err) {
      try {
        await pool.end()
      } catch {}
      throw err
    }

    const sessionId = uuidv4()
    const pools = new Map<string, Pool>()
    const poolLastUsed = new Map<string, number>()
    const dbKey = currentDb || database
    pools.set(dbKey, pool)
    poolLastUsed.set(dbKey, Date.now())
    this.sessions.set(sessionId, {
      id: sessionId,
      connectionId: conn.id,
      connectionName: conn.name,
      host: conn.host,
      port: conn.port || 5432,
      username: conn.username,
      database: currentDb,
      serverVersion,
      password: conn.password || '',
      ssl: !!(conn.sslOptions?.enabled ?? conn.ssl),
      sslOptions: conn.sslOptions,
      pools,
      poolLastUsed,
    })

    return this.toInfo(this.sessions.get(sessionId)!)
  }

  async test(conn: DbTestParams): Promise<DbTestResult> {
    const start = Date.now()
    const database = (conn.database || 'postgres').trim() || 'postgres'
    const ssl = resolveSslConfig(conn.ssl, conn.sslOptions)
    const pool = new Pool({
      host: conn.host,
      port: conn.port || 5432,
      user: conn.username,
      password: conn.password || '',
      database,
      ssl: ssl || undefined,
      max: 1,
      connectionTimeoutMillis: 12_000,
      idleTimeoutMillis: 1_000,
    })
    try {
      const res = await pool.query<{ v: string }>('SELECT version() AS v')
      return {
        ok: true,
        latencyMs: Date.now() - start,
        serverVersion: String(res.rows[0]?.v || ''),
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) }
    } finally {
      try {
        await pool.end()
      } catch {}
    }
  }

  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    // Cancel while pools still available for pg_cancel_backend
    await this.cancelAllQueries(sessionId)
    await this.releaseAllClients(sessionId)
    this.sessions.delete(sessionId)
    this.countCache.invalidateSession(sessionId)
    for (const key of [...this.countWarmInflight]) {
      if (key.startsWith(`${sessionId}\0`)) this.countWarmInflight.delete(key)
    }
    // Drop in-flight creates so they cannot re-write pools after disconnect
    for (const key of [...this.poolCreateInflight.keys()]) {
      if (key.startsWith(`${sessionId}\0`)) this.poolCreateInflight.delete(key)
    }
    for (const pool of session.pools.values()) {
      try {
        await pool.end()
      } catch {}
    }
    session.pools.clear()
    session.poolLastUsed.clear()
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
    const existing = this.pinnedClients.get(this.pinKey(sessionId, key))
    if (existing?.inTransaction) {
      return this.getTransactionState(sessionId, key)
    }
    if (existing) {
      await this.releaseClient(sessionId, key)
    }
    const { pool, database: dbKey } = await this.getPool(sessionId, database)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      this.pinnedClients.set(this.pinKey(sessionId, key), {
        sessionId,
        clientKey: key,
        client,
        inTransaction: true,
        database: dbKey,
      })
      return { clientKey: key, inTransaction: true, autocommit: false }
    } catch (err) {
      try {
        client.release()
      } catch {}
      throw err
    }
  }

  /** Discard broken / mid-TX client from pool (pg: release(err)). */
  private discardPgClient(client: PoolClient, reason?: Error | string): void {
    try {
      const err =
        reason instanceof Error
          ? reason
          : new Error(typeof reason === 'string' ? reason : 'discard client')
      // node-pg: release(error) removes client from pool
      ;(client as any).release(err)
    } catch {
      try {
        client.release()
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
      await pin.client.query('COMMIT')
      try {
        pin.client.release()
      } catch {}
      return { clientKey: key, inTransaction: false, autocommit: true }
    } catch (err) {
      this.discardPgClient(pin.client, err instanceof Error ? err : 'COMMIT failed')
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
      await pin.client.query('ROLLBACK')
      try {
        pin.client.release()
      } catch {}
      return { clientKey: key, inTransaction: false, autocommit: true }
    } catch (err) {
      this.discardPgClient(pin.client, err instanceof Error ? err : 'ROLLBACK failed')
      throw err
    }
  }

  async releaseClient(sessionId: string, clientKey: string): Promise<void> {
    const key = typeof clientKey === 'string' ? clientKey.trim() : ''
    const pin = this.pinnedClients.get(this.pinKey(sessionId, key))
    if (!pin || pin.sessionId !== sessionId) return
    this.pinnedClients.delete(this.pinKey(sessionId, key))
    try {
      if (pin.inTransaction) {
        await pin.client.query('ROLLBACK')
      }
      try {
        pin.client.release()
      } catch {}
    } catch (err) {
      this.discardPgClient(pin.client, err instanceof Error ? err : 'releaseClient failed')
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
    // One control client for the batch; pg_cancel_backend works cross-database via pid
    const db =
      entries[0][1].database
      || session.database
      || 'postgres'
    let control: PostgresControlClient | null = null
    try {
      control = await this.openControlClient(session, db)
      for (const [queryId, active] of entries) {
        try {
          const res = await control.query<{ ok: boolean }>(
            'SELECT pg_cancel_backend($1) AS ok',
            [active.pid],
          )
          if (res.rows[0]?.ok !== false) {
            const still = this.activeQueries.get(queryId)
            if (still && still.sessionId === sessionId) {
              still.cancelled = true
            }
          }
        } catch {
          // best-effort per query
        }
      }
    } catch {
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

  /**
   * Dedicated short-lived client for pg_cancel_backend.
   * Never uses business pools (which may be fully saturated by long queries).
   * Cross-database cancel is supported via backend pid (same cluster).
   * Overridable for tests.
   */
  protected async openControlClient(
    session: LiveSession,
    database: string,
  ): Promise<PostgresControlClient> {
    const ssl = resolveSslConfig(session.ssl, session.sslOptions)
    const client = new Client({
      host: session.host,
      port: session.port,
      user: session.username,
      password: session.password,
      database: (database || session.database || 'postgres').trim() || 'postgres',
      ssl: ssl || undefined,
      connectionTimeoutMillis: CONTROL_CONNECT_TIMEOUT_MS,
    })
    await client.connect()
    try {
      await client.query(`SET statement_timeout = ${CONTROL_STATEMENT_TIMEOUT_MS}`)
    } catch {
      // best-effort timeout; cancel still proceeds
    }
    return client
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
    const { pool } = await this.getPool(sessionId)
    const res = await pool.query<{ name: string }>(
      `SELECT datname AS name
       FROM pg_database
       WHERE datistemplate = false
       ORDER BY datname`,
    )
    return res.rows.map((r) => String(r.name || '')).filter(Boolean)
  }

  async listTables(sessionId: string, database?: string): Promise<string[]> {
    const infos = await this.listTableInfos(sessionId, database)
    return infos.map((t) => t.name)
  }

  async listTableInfos(sessionId: string, database?: string): Promise<DbTableInfo[]> {
    const { pool } = await this.getPool(sessionId, database)

    const res = await pool.query<{
      schema: string
      name: string
      tableType: string
      comment: string | null
    }>(
      `SELECT n.nspname AS schema,
              c.relname AS name,
              CASE c.relkind
                WHEN 'v' THEN 'VIEW'
                WHEN 'm' THEN 'VIEW'
                ELSE 'BASE TABLE'
              END AS "tableType",
              COALESCE(obj_description(c.oid, 'pg_class'), '') AS comment
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p', 'v', 'm')
         AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND n.nspname NOT LIKE 'pg_temp_%'
         AND n.nspname NOT LIKE 'pg_toast_temp_%'
       ORDER BY CASE c.relkind WHEN 'v' THEN 1 WHEN 'm' THEN 1 ELSE 0 END, n.nspname, c.relname`,
    )

    return res.rows
      .map((r) => {
        const schema = String(r.schema || 'public')
        const name = String(r.name || '')
        if (!name) return null
        const display = schema === 'public' ? name : `${schema}.${name}`
        const typeRaw = String(r.tableType || '').toUpperCase()
        return {
          name: display,
          type: typeRaw.includes('VIEW') ? ('view' as const) : ('table' as const),
          engine: null,
          rows: null,
          comment: r.comment != null ? String(r.comment) : '',
        }
      })
      .filter((t): t is DbTableInfo => !!t)
  }

  async getTableColumns(sessionId: string, database: string, table: string): Promise<DbColumnInfo[]> {
    const { pool } = await this.getPool(sessionId, database)
    const { schema, table: tableName } = parseTableRef(table)

    const res = await pool.query<{
      name: string
      type: string
      nullable: string
      colKey: string
      defaultValue: string | null
      extra: string
      comment: string
    }>(
      `SELECT
         a.attname AS name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
         CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS nullable,
         CASE
           WHEN EXISTS (
             SELECT 1
             FROM pg_index i
             WHERE i.indrelid = a.attrelid
               AND i.indisprimary
               AND a.attnum = ANY (i.indkey)
           ) THEN 'PRI'
           WHEN EXISTS (
             SELECT 1
             FROM pg_constraint c
             WHERE c.conrelid = a.attrelid
               AND c.contype = 'u'
               AND a.attnum = ANY (c.conkey)
           ) THEN 'UNI'
           ELSE ''
         END AS "colKey",
         pg_get_expr(ad.adbin, ad.adrelid) AS "defaultValue",
         CASE WHEN a.attidentity <> '' THEN 'identity' ELSE '' END AS extra,
         COALESCE(col_description(a.attrelid, a.attnum), '') AS comment
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
       WHERE n.nspname = $1
         AND c.relname = $2
         AND a.attnum > 0
         AND NOT a.attisdropped
       ORDER BY a.attnum`,
      [schema, tableName],
    )

    return res.rows.map((r) => ({
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
    const { pool } = await this.getPool(sessionId, database)
    const { schema, table: tableName } = parseTableRef(table)
    const res = await pool.query<{
      name: string
      columns: string[] | null
      isUnique: boolean
      isPrimary: boolean
      amName: string
      comment: string | null
    }>(
      `SELECT
         i.relname AS name,
         ARRAY(
           SELECT a.attname
           FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
           ORDER BY k.ord
         ) AS columns,
         ix.indisunique AS "isUnique",
         ix.indisprimary AS "isPrimary",
         am.amname AS "amName",
         COALESCE(obj_description(i.oid, 'pg_class'), '') AS comment
       FROM pg_index ix
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_am am ON am.oid = i.relam
       WHERE n.nspname = $1 AND t.relname = $2
       ORDER BY ix.indisprimary DESC, i.relname`,
      [schema, tableName],
    )
    return res.rows.map((r) => ({
      name: String(r.name || ''),
      columns: Array.isArray(r.columns) ? r.columns.map(String) : [],
      unique: !!r.isUnique,
      primary: !!r.isPrimary,
      type: String(r.amName || ''),
      comment: r.comment != null ? String(r.comment) : '',
    }))
  }

  async getCreateTable(sessionId: string, database: string, table: string): Promise<string> {
    const cols = await this.getTableColumns(sessionId, database, table)
    const indexes = await this.getTableIndexes(sessionId, database, table)
    const { schema, table: tableName } = parseTableRef(table)
    const fq = `${quoteIdentPostgres(schema)}.${quoteIdentPostgres(tableName)}`
    if (cols.length === 0) return `-- No columns found for ${fq}`

    const lines = cols.map((c) => {
      const nullSql = c.nullable ? '' : ' NOT NULL'
      const defSql = c.defaultValue != null ? ` DEFAULT ${c.defaultValue}` : ''
      return `  ${quoteIdentPostgres(c.name)} ${c.type}${nullSql}${defSql}`
    })

    const pk = indexes.find((i) => i.primary)
    if (pk && pk.columns.length) {
      lines.push(
        `  PRIMARY KEY (${pk.columns.map((c) => quoteIdentPostgres(c)).join(', ')})`,
      )
    }
    for (const idx of indexes) {
      if (idx.primary) continue
      if (idx.unique) {
        lines.push(
          `  CONSTRAINT ${quoteIdentPostgres(idx.name)} UNIQUE (${idx.columns.map((c) => quoteIdentPostgres(c)).join(', ')})`,
        )
      }
    }

    const ddl = [`CREATE TABLE ${fq} (`, lines.join(',\n'), ');']
    for (const idx of indexes) {
      if (idx.primary || idx.unique) continue
      ddl.push(
        `CREATE INDEX ${quoteIdentPostgres(idx.name)} ON ${fq} USING ${idx.type || 'btree'} (${idx.columns.map((c) => quoteIdentPostgres(c)).join(', ')});`,
      )
    }
    return ddl.join('\n')
  }

  async browseTable(
    sessionId: string,
    database: string,
    table: string,
    page = 1,
    pageSize = 100,
    options?: DbBrowseOptions,
  ): Promise<DbTableBrowseResult> {
    const { session, pool } = await this.getPool(sessionId, database)
    const { schema, table: tableName } = parseTableRef(table)
    assertIdent(schema)
    assertIdent(tableName)

    const safePage = Math.max(1, Math.floor(page) || 1)
    const safeSize = Math.min(Math.max(Math.floor(pageSize) || 100, 1), 500)
    const offset = (safePage - 1) * safeSize
    const fq = `${quoteIdentPostgres(schema)}.${quoteIdentPostgres(tableName)}`

    let searchCols = options?.searchColumns
    if (options?.search && (!searchCols || searchCols.length === 0)) {
      const cols = await this.getTableColumns(sessionId, database, table)
      searchCols = cols
        .filter((c) => !/bytea|json|xml|bit/i.test(c.type))
        .map((c) => c.name)
        .slice(0, 32)
    }
    const where = buildWhereClausePg(
      searchCols ? { ...options, searchColumns: searchCols } : options,
      searchCols || [],
    )

    let orderClause = ''
    if (options?.orderBy) {
      assertIdent(options.orderBy)
      const dir = options.orderDir === 'desc' ? 'DESC' : 'ASC'
      orderClause = ` ORDER BY ${quoteIdentPostgres(options.orderBy)} ${dir}`
    }

    const start = Date.now()
    const hasFilter = browseHasFilter(options)
    const cacheKey = browseCountCacheKey(sessionId, database, table, options)
    let exactTotal = this.countCache.get(cacheKey)

    // pageSize+1 so hasNext is known without a full COUNT
    const limitIdx = where.params.length + 1
    const offsetIdx = where.params.length + 2
    const dataRes = await withStatementTimeout(pool, DEFAULT_QUERY_TIMEOUT_MS, async (client) => {
      return client.query(
        `SELECT * FROM ${fq}${where.clause}${orderClause} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...where.params, safeSize + 1, offset],
      )
    })
    const durationMs = Date.now() - start
    const columns = dataRes.fields.map((f) => f.name)
    const mapped = dataRes.rows.map((row) => {
      const out: Record<string, unknown> = {}
      for (const col of columns) out[col] = serializeCell((row as any)[col], { column: col })
      return out
    })

    if (exactTotal == null && !hasFilter) {
      let estimatedTotal: number | null = null
      try {
        const estRes = await pool.query<{ c: string | number }>(
          `SELECT GREATEST(c.reltuples, 0)::bigint AS c
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = $1 AND c.relname = $2
           LIMIT 1`,
          [schema, tableName],
        )
        if (estRes.rows[0]?.c != null && estRes.rows[0].c !== '') {
          estimatedTotal = Number(estRes.rows[0].c)
        }
      } catch {
        estimatedTotal = null
      }
      void this.warmExactCount(session, pool, cacheKey, fq, where.clause, where.params)
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
      void this.warmExactCount(session, pool, cacheKey, fq, where.clause, where.params)
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
    pool: Pool,
    cacheKey: string,
    fq: string,
    whereClause: string,
    whereParams: unknown[],
  ): Promise<void> {
    if (this.countCache.get(cacheKey) != null) return
    if (this.countWarmInflight.has(cacheKey)) return
    this.countWarmInflight.add(cacheKey)
    try {
      if (!this.sessions.has(session.id) || this.sessions.get(session.id) !== session) return
      const countRes = await withStatementTimeout(pool, DEFAULT_QUERY_TIMEOUT_MS, async (client) => {
        return client.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM ${fq}${whereClause}`,
          whereParams,
        )
      })
      if (!this.sessions.has(session.id) || this.sessions.get(session.id) !== session) return
      const total = Number(countRes.rows[0]?.c ?? 0)
      if (Number.isFinite(total) && total >= 0) {
        this.countCache.set(cacheKey, total)
      }
    } catch {
      // background count is best-effort
    } finally {
      this.countWarmInflight.delete(cacheKey)
    }
  }

  /**
   * Explicit user default database selection (footer / session info only).
   * Does not route other tabs; multi-db pools remain isolated.
   */
  async useDatabase(sessionId: string, database: string): Promise<void> {
    assertIdent(database)
    const { session } = await this.getPool(sessionId, database)
    session.database = database
  }

  async createDatabase(
    sessionId: string,
    name: string,
    options?: { encoding?: string; template?: string },
  ): Promise<void> {
    assertIdent(name)
    const { pool } = await this.getPool(sessionId)
    const parts = [`CREATE DATABASE ${quoteIdentPostgres(name)}`]
    if (options?.encoding && /^[A-Za-z0-9_]+$/.test(options.encoding)) {
      parts.push(`ENCODING '${options.encoding.replace(/'/g, "''")}'`)
    }
    if (options?.template && /^[A-Za-z0-9_]+$/.test(options.template)) {
      parts.push(`TEMPLATE ${quoteIdentPostgres(options.template)}`)
    }
    await pool.query(parts.join(' '))
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
      // No control plane / pool; do not set cancelled or claim requested
      return { status: 'already_finished' }
    }
    let control: PostgresControlClient | null = null
    try {
      // Independent of business pool saturation; pid cancel is cluster-wide
      const db = active.database || session.database || 'postgres'
      control = await this.openControlClient(session, db)
      const res = await control.query<{ ok: boolean }>('SELECT pg_cancel_backend($1) AS ok', [
        active.pid,
      ])
      const still = this.activeQueries.get(queryId)
      if (!still || still.sessionId !== sessionId) {
        return { status: 'already_finished' }
      }
      const ok = res.rows[0]?.ok
      if (ok === false) {
        return { status: 'already_finished' }
      }
      still.cancelled = true
      return { status: 'cancelled' }
    } catch (err: any) {
      const msg = String(err?.message || err || 'pg_cancel_backend failed')
      if (/does not exist|not exist|is not a backend/i.test(msg)) {
        return { status: 'already_finished' }
      }
      // failed: do not set cancelled so natural completion is not rewritten
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
    // Pinned client is bound to its database; ignore conflicting useDb for connection
    const dbForPool = usePinned ? pin!.database : useDb
    const { pool, database: dbKey } = usePinned
      ? { pool: null as unknown as Pool, database: pin!.database }
      : await this.getPool(sessionId, dbForPool)

    const client = usePinned ? pin!.client : await pool.connect()
    const start = Date.now()
    try {
      if (queryId) {
        const pidRes = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
        const pid = Number(pidRes.rows[0]?.pid)
        this.activeQueries.set(queryId, {
          sessionId,
          database: dbKey,
          pid,
          cancelled: false,
          client,
        })
      }

      if (queryId && this.activeQueries.get(queryId)?.cancelled) {
        throw cancelledError()
      }

      await client.query(`SET statement_timeout = ${Math.floor(timeoutMs)}`)
      const plan = planSqlRowLimit(trimmed, maxRows)

      try {
        if (plan.mode === 'unsupported') {
          throw new Error(plan.error)
        }

        // Nested DECLARE CURSOR needs a TX; user TX already has BEGIN — still OK on same client.
        // Avoid nested BEGIN from queryCursorCapped when already in user transaction: use plain+slice.
        if (plan.mode === 'stream') {
          if (isPostgresCursorSafe(trimmed) && !usePinned) {
            return await this.queryCursorCapped(client, trimmed, maxRows, start, queryId)
          }
          // Never DECLARE CURSOR for unsafe shapes or inside user TX; run once and slice
          const plain = await client.query(trimmed)
          return this.mapQueryResult(plain, maxRows, start, /*allowTruncate*/ true)
        }

        if (plan.mode === 'plain') {
          // SELECT INTO etc.: execute as-is, no cursor, no LIMIT rewrite
          const plain = await client.query(trimmed)
          return this.mapQueryResult(plain, maxRows, start, /*allowTruncate*/ false)
        }

        const sqlToRun = plan.mode === 'rewrite' ? plan.sql : trimmed
        const result = await client.query(sqlToRun)

        if (queryId && this.activeQueries.get(queryId)?.cancelled) {
          throw cancelledError()
        }

        return this.mapQueryResult(result, maxRows, start, plan.mode === 'rewrite')
      } finally {
        try {
          await client.query('SET statement_timeout = 0')
        } catch {}
      }
    } catch (err: any) {
      if (queryId && this.activeQueries.get(queryId)?.cancelled) {
        throw cancelledError()
      }
      // 57014 = query_canceled
      if (err?.code === '57014') {
        throw cancelledError()
      }
      throw err
    } finally {
      if (queryId) this.activeQueries.delete(queryId)
      if (!usePinned) {
        try {
          client.release()
        } catch {}
      }
    }
  }

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
    assertIdent(database)
    // table may be schema.table
    const parts = table.includes('.') ? table.split('.') : ['public', table]
    const schema = parts.length > 1 ? parts[0] : 'public'
    const tableName = parts.length > 1 ? parts.slice(1).join('.') : table
    assertIdent(schema)
    assertIdent(tableName)

    const maxRows = Math.min(Math.max(options.maxRows || 1_000_000, 1), 5_000_000)
    const searchCols = options.browse?.searchColumns || []
    const browseOpts =
      options.browse?.search && !searchCols.length
        ? { ...options.browse, search: undefined }
        : options.browse
    const where = buildWhereClausePg(browseOpts, searchCols)
    let orderSql = ''
    if (options.browse?.orderBy) {
      assertIdent(options.browse.orderBy)
      orderSql = ` ORDER BY ${quoteIdentPostgres(options.browse.orderBy)} ${
        options.browse.orderDir === 'desc' ? 'DESC' : 'ASC'
      }`
    }
    const fq = `${quoteIdentPostgres(schema)}.${quoteIdentPostgres(tableName)}`
    const sql = `SELECT * FROM ${fq}${where.clause || ''}${orderSql}`

    const { pool } = await this.getPool(sessionId, database)
    const client = await pool.connect()
    let columns: string[] = []
    let rowsWritten = 0
    let truncated = false
    let clientReusable = true
    const cursorName = `litesh_exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    try {
      await client.query('BEGIN')
      await client.query(`DECLARE ${cursorName} NO SCROLL CURSOR FOR ${sql}`, where.params || [])
      const batch = 500
      while (rowsWritten < maxRows) {
        if (options.isCancelled()) {
          throw Object.assign(new Error('Export cancelled'), { code: 'EXPORT_CANCELLED' })
        }
        const need = maxRows - rowsWritten
        const fetchN = Math.min(batch, need + 1)
        const chunk = await client.query(`FETCH ${fetchN} FROM ${cursorName}`)
        if (!columns.length && chunk.fields?.length) {
          columns = chunk.fields.map((f) => f.name)
          await options.onColumns?.(columns)
        }
        if (!chunk.rows.length) break
        for (const row of chunk.rows) {
          if (options.isCancelled()) {
            throw Object.assign(new Error('Export cancelled'), { code: 'EXPORT_CANCELLED' })
          }
          if (rowsWritten >= maxRows) {
            truncated = true
            break
          }
          if (!columns.length) columns = Object.keys(row)
          const out: Record<string, unknown> = {}
          for (const col of columns) out[col] = serializeCell((row as any)[col], { column: col })
          rowsWritten++
          await options.onRow(out, columns)
        }
        if (truncated || chunk.rows.length < fetchN) {
          if (chunk.rows.length > need && rowsWritten >= maxRows) truncated = true
          break
        }
      }
      await client.query(`CLOSE ${cursorName}`)
      await client.query('COMMIT')
      return { columns, rowsWritten, truncated }
    } catch (err) {
      clientReusable = false
      try {
        await client.query('ROLLBACK')
        // Clean cancel after ROLLBACK can still release
        if ((err as any)?.code === 'EXPORT_CANCELLED') {
          clientReusable = true
        }
      } catch {
        clientReusable = false
      }
      throw err
    } finally {
      if (clientReusable) {
        try {
          client.release()
        } catch {}
      } else {
        this.discardPgClient(
          client,
          new Error('export stream aborted — discard backend'),
        )
      }
    }
  }

  private mapQueryResult(
    result: QueryResult<QueryResultRow>,
    maxRows: number,
    start: number,
    allowTruncate: boolean,
  ): DbQueryResult {
    const durationMs = Date.now() - start
    if (result.fields && result.fields.length > 0) {
      const columns = result.fields.map((f) => f.name)
      const truncated = allowTruncate && result.rows.length > maxRows
      const sliced = truncated ? result.rows.slice(0, maxRows) : result.rows
      const mapped = sliced.map((row) => {
        const out: Record<string, unknown> = {}
        for (const col of columns) out[col] = serializeCell((row as any)[col])
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
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      affectedRows: result.rowCount ?? 0,
      durationMs,
      hasResultSet: false,
    }
  }

  /**
   * Cursor-based fetch: stop after maxRows rows without loading the full result set.
   * Caller must ensure isPostgresCursorSafe(sql).
   */
  private async queryCursorCapped(
    client: PoolClient,
    sql: string,
    maxRows: number,
    start: number,
    queryId: string | null,
  ): Promise<DbQueryResult> {
    const cursorName = `litesh_c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    // DECLARE CURSOR requires a transaction
    await client.query('BEGIN')
    try {
      const body = sql.replace(/;+\s*$/g, '').trim()
      await client.query(`DECLARE ${cursorName} NO SCROLL CURSOR FOR ${body}`)
      const batch = Math.min(Math.max(maxRows + 1, 1), 500)
      const rows: Record<string, unknown>[] = []
      let columns: string[] = []
      let truncated = false

      while (rows.length <= maxRows) {
        if (queryId && this.activeQueries.get(queryId)?.cancelled) {
          throw cancelledError()
        }
        const need = maxRows + 1 - rows.length
        const fetchN = Math.min(batch, need)
        const chunk = await client.query(`FETCH ${fetchN} FROM ${cursorName}`)
        if (columns.length === 0 && chunk.fields?.length) {
          columns = chunk.fields.map((f) => f.name)
        }
        if (!chunk.rows.length) break
        for (const row of chunk.rows) {
          if (rows.length >= maxRows) {
            truncated = true
            break
          }
          const out: Record<string, unknown> = {}
          if (columns.length === 0) columns = Object.keys(row)
          for (const col of columns) out[col] = serializeCell((row as any)[col])
          rows.push(out)
        }
        if (truncated || chunk.rows.length < fetchN) break
      }

      await client.query(`CLOSE ${cursorName}`)
      await client.query('COMMIT')

      return {
        columns,
        rows,
        rowCount: rows.length,
        truncated,
        durationMs: Date.now() - start,
        hasResultSet: true,
      }
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch {}
      throw err
    }
  }

  private createPool(
    conn: Pick<DbConnection, 'host' | 'port' | 'username' | 'password' | 'ssl' | 'sslOptions'> | {
      host: string
      port: number
      username: string
      password: string
      ssl: boolean
      sslOptions?: DbConnection['sslOptions']
    },
    database: string,
  ): Pool {
    const ssl = resolveSslConfig(conn.ssl, conn.sslOptions)
    return new Pool({
      host: conn.host,
      port: conn.port || 5432,
      user: conn.username,
      password: conn.password || '',
      database,
      ssl: ssl || undefined,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
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
      engine: 'postgres',
      host: s.host,
      port: s.port,
      username: s.username,
      database: s.database,
      serverVersion: s.serverVersion,
    }
  }
}

function parseTableRef(table: string): { schema: string; table: string } {
  assertIdent(table)
  const idx = table.indexOf('.')
  if (idx <= 0) return { schema: 'public', table }
  const schema = table.slice(0, idx)
  const name = table.slice(idx + 1)
  assertIdent(schema)
  assertIdent(name)
  return { schema, table: name }
}

async function withStatementTimeout<T>(
  pool: Pool,
  timeoutMs: number,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query(`SET statement_timeout = ${Math.floor(timeoutMs)}`)
    try {
      return await fn(client)
    } finally {
      try {
        await client.query('SET statement_timeout = 0')
      } catch {}
    }
  } finally {
    client.release()
  }
}
