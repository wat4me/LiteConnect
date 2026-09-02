import oracledb, { type Connection, type Result } from 'oracledb'
import { v4 as uuidv4 } from 'uuid'
import {
  assertIdent,
  cancelledError,
  clampQueryLimits,
  DEFAULT_QUERY_TIMEOUT_MS,
  quoteIdentOracle,
  sanitizeCancelError,
  validateSqlInput,
} from '../common'
import { buildWhereClauseOracle } from '../browse/browseFilter'
import { BrowseCountCache } from '../browse/browsePagination'
import { planSqlRowLimit } from '../sql/sqlLimit'
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
import { mapOracleExtraOptions } from '../../../shared/dbConnectionUrl'
import {
  type ActiveQuery,
  type LiveSession,
  type OracleBrowseHost,
  type PinnedClient,
} from './oracleTypes'
import { mapRows, parseOracleTableName, schemaOf } from './oracleHelpers'
import * as oracleBrowse from './oracleBrowse'

/**
 * Oracle driver (node-oracledb Thin mode preferred).
 * UI "database" maps to a schema (owner). Connection database field is Service Name.
 */

/** Prefer Thin (no Instant Client). Ignore failure if already configured. */
function preferThinMode(): void {
  try {
    // node-oracledb 6+: thin is default when thick not init'd
    if (typeof (oracledb as any).initOracleClient === 'function') {
      // do not call initOracleClient → stay Thin
    }
  } catch {
    // ignore
  }
}

/**
 * Build Easy Connect string.
 * - If `database` looks like a full connect descriptor / Easy Connect Plus, use as-is.
 * - Else treat as Service Name: host:port/serviceName
 */
export function buildOracleConnectString(
  host: string,
  port: number,
  database?: string | null,
): string {
  const raw = typeof database === 'string' ? database.trim() : ''
  if (raw && (raw.includes('=') || raw.startsWith('(') || raw.includes('://'))) {
    return raw
  }
  const h = (host || 'localhost').trim() || 'localhost'
  const p = port > 0 ? port : 1521
  if (raw) return `${h}:${p}/${raw}`
  return `${h}:${p}`
}

export class OracleDriver implements DbDriver {
  readonly engine = 'oracle' as const

  private sessions = new Map<string, LiveSession>()
  private activeQueries = new Map<string, ActiveQuery>()
  private countCache = new BrowseCountCache()
  private countWarmInflight = new Set<string>()
  private pinnedClients = new Map<string, PinnedClient>()

  constructor() {
    preferThinMode()
    try {
      oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT
      oracledb.fetchAsString = [oracledb.CLOB]
      oracledb.autoCommit = true
    } catch {
      // ignore if already set in other context
    }
  }

  private browseHost(): OracleBrowseHost {
    return {
      sessions: this.sessions,
      countCache: this.countCache,
      countWarmInflight: this.countWarmInflight,
      requireSession: (sessionId) => this.requireSession(sessionId),
      withConn: (session, fn) => this.withConn(session, fn),
    }
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
    const connection = await session.pool.getConnection()
    try {
      const useDb =
        typeof database === 'string' && database.trim() ? database.trim() : null
      if (useDb) {
        assertIdent(useDb)
        await connection.execute(
          `ALTER SESSION SET CURRENT_SCHEMA = ${quoteIdentOracle(useDb)}`,
        )
      }
      // Oracle: implicit transaction starts on first DML when autoCommit is off
      connection.autoCommit = false
      this.pinnedClients.set(this.pinKey(sessionId, key), {
        sessionId,
        clientKey: key,
        connection,
        inTransaction: true,
        database: useDb || session.database,
      })
      return { clientKey: key, inTransaction: true, autocommit: false }
    } catch (err) {
      try {
        connection.autoCommit = true
      } catch {}
      try {
        await connection.close()
      } catch {}
      throw err
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
      await pin.connection.commit()
      pin.connection.autoCommit = true
      try {
        await pin.connection.close()
      } catch {}
      return { clientKey: key, inTransaction: false, autocommit: true }
    } catch (err) {
      try {
        await pin.connection.close({ drop: true } as any)
      } catch {
        try {
          await pin.connection.close()
        } catch {}
      }
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
      await pin.connection.rollback()
      pin.connection.autoCommit = true
      try {
        await pin.connection.close()
      } catch {}
      return { clientKey: key, inTransaction: false, autocommit: true }
    } catch (err) {
      try {
        await pin.connection.close({ drop: true } as any)
      } catch {
        try {
          await pin.connection.close()
        } catch {}
      }
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
        await pin.connection.rollback()
      }
      pin.connection.autoCommit = true
      ok = true
    } catch {
      ok = false
    }
    try {
      if (ok) await pin.connection.close()
      else await pin.connection.close({ drop: true } as any)
    } catch {
      try {
        await pin.connection.close()
      } catch {}
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

  private async withConn<T>(session: LiveSession, fn: (c: Connection) => Promise<T>): Promise<T> {
    const c = await session.pool.getConnection()
    try {
      return await fn(c)
    } finally {
      try {
        await c.close()
      } catch {}
    }
  }

  private async createPool(conn: {
    host: string
    port: number
    username: string
    password: string
    database?: string | null
    extraOptions?: Record<string, string> | null
  }): Promise<{ pool: Pool; connectString: string }> {
    const extras = mapOracleExtraOptions(conn.extraOptions)
    const connectString =
      extras.connectionString?.trim() ||
      buildOracleConnectString(conn.host, conn.port || 1521, conn.database)
    const pool = await oracledb.createPool({
      user: conn.username,
      password: conn.password || '',
      connectString,
      poolMin: 0,
      poolMax: 5,
      poolIncrement: 1,
      poolTimeout: 60,
      connectTimeout: extras.connectTimeout ?? 15,
      queueTimeout: 30_000,
    })
    return { pool, connectString }
  }

  async connect(conn: DbConnection): Promise<DbSessionInfo> {
    const { pool, connectString } = await this.createPool({
      host: conn.host,
      port: conn.port || 1521,
      username: conn.username,
      password: conn.password || '',
      database: conn.database,
      extraOptions: conn.extraOptions,
    })

    let serverVersion = ''
    let currentSchema: string | null = conn.database?.trim() || null
    try {
      const c = await pool.getConnection()
      try {
        // Connectivity probe — dual is always available
        await c.execute(`SELECT 1 FROM dual`)
        serverVersion = await readOracleVersion(c)
        const sch = await c.execute(
          `SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS s FROM dual`,
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        )
        const schRow = sch.rows?.[0] as { S?: string; s?: string } | undefined
        if (schRow?.S || schRow?.s) currentSchema = String(schRow.S || schRow.s)
      } finally {
        try {
          await c.close()
        } catch {}
      }
    } catch (err) {
      try {
        await pool.close(0)
      } catch {}
      throw err
    }

    const sessionId = uuidv4()
    this.sessions.set(sessionId, {
      id: sessionId,
      connectionId: conn.id,
      connectionName: conn.name,
      host: conn.host,
      port: conn.port || 1521,
      username: conn.username,
      database: currentSchema,
      serverVersion,
      password: conn.password || '',
      connectString,
      pool,
    })
    return this.toInfo(this.sessions.get(sessionId)!)
  }

  async test(conn: DbTestParams): Promise<DbTestResult> {
    const start = Date.now()
    let connection: Connection | null = null
    try {
      const extras = mapOracleExtraOptions(conn.extraOptions)
      const connectString =
        extras.connectionString?.trim() ||
        buildOracleConnectString(conn.host, conn.port || 1521, conn.database)
      connection = await oracledb.getConnection({
        user: conn.username,
        password: conn.password || '',
        connectString,
        connectTimeout: extras.connectTimeout ?? 12,
      })
      await connection.execute(`SELECT 1 FROM dual`)
      const serverVersion = await readOracleVersion(connection)
      return {
        ok: true,
        latencyMs: Date.now() - start,
        serverVersion: serverVersion || 'Oracle',
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) }
    } finally {
      try {
        await connection?.close()
      } catch {}
    }
  }

  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    await this.cancelAllQueries(sessionId)
    await this.releaseAllClients(sessionId)
    this.sessions.delete(sessionId)
    this.countCache.invalidateSession(sessionId)
    for (const key of [...this.countWarmInflight]) {
      if (key.startsWith(`${sessionId}\0`)) this.countWarmInflight.delete(key)
    }
    try {
      await session.pool.close(0)
    } catch {}
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.disconnect(id)))
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

  /**
   * Schema list (maps to UI "databases").
   * Prefers distinct owners from ALL_TABLES/ALL_VIEWS the user can see;
   * falls back to current schema.
   */
  async listDatabases(sessionId: string): Promise<string[]> {
    return oracleBrowse.listDatabases(this.browseHost(), sessionId)
  }

  async listTables(sessionId: string, database?: string): Promise<string[]> {
    const infos = await this.listTableInfos(sessionId, database)
    return infos.map((t) => t.name)
  }

  async listTableInfos(sessionId: string, database?: string): Promise<DbTableInfo[]> {
    return oracleBrowse.listTableInfos(this.browseHost(), sessionId, database)
  }

  async getTableColumns(
    sessionId: string,
    database: string,
    table: string,
  ): Promise<DbColumnInfo[]> {
    return oracleBrowse.getTableColumns(this.browseHost(), sessionId, database, table)
  }

  async getTableIndexes(
    sessionId: string,
    database: string,
    table: string,
  ): Promise<DbIndexInfo[]> {
    return oracleBrowse.getTableIndexes(this.browseHost(), sessionId, database, table)
  }

  async getCreateTable(sessionId: string, database: string, table: string): Promise<string> {
    return oracleBrowse.getCreateTable(this.browseHost(), sessionId, database, table)
  }

  async browseTable(
    sessionId: string,
    database: string,
    table: string,
    page = 1,
    pageSize = 100,
    options?: DbBrowseOptions,
  ): Promise<DbTableBrowseResult> {
    return oracleBrowse.browseTable(
      this.browseHost(),
      sessionId,
      database,
      table,
      page,
      pageSize,
      options,
    )
  }

  private async warmExactCount(
    session: LiveSession,
    cacheKey: string,
    fq: string,
    whereClause: string,
    whereParams: unknown[],
  ): Promise<void> {
    return oracleBrowse.warmExactCount(
      this.browseHost(),
      session,
      cacheKey,
      fq,
      whereClause,
      whereParams,
    )
  }

  async useDatabase(sessionId: string, database: string): Promise<void> {
    const session = this.requireSession(sessionId)
    const schema = database.trim()
    if (!schema) return
    assertIdent(schema)
    await this.withConn(session, async (conn) => {
      await conn.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${quoteIdentOracle(schema)}`)
    })
    session.database = schema
  }

  async createDatabase(sessionId: string, name: string): Promise<void> {
    // UI guides users; real CREATE USER needs DBA privileges and password policy.
    void sessionId
    void name
    throw new Error(
      'Oracle does not support CREATE DATABASE. Create a user/schema with DBA tools (CREATE USER … IDENTIFIED BY …).',
    )
  }

  async cancelQuery(sessionId: string, queryId: string): Promise<DbCancelResult> {
    if (typeof queryId !== 'string' || !queryId.trim()) {
      return { status: 'already_finished' }
    }
    const active = this.activeQueries.get(queryId)
    if (!active || active.sessionId !== sessionId) {
      return { status: 'already_finished' }
    }
    if (!this.sessions.has(sessionId)) {
      return { status: 'already_finished' }
    }
    try {
      await active.connection.break()
      const still = this.activeQueries.get(queryId)
      if (!still || still.sessionId !== sessionId) {
        return { status: 'already_finished' }
      }
      still.cancelled = true
      return { status: 'cancelled' }
    } catch (err: any) {
      const msg = String(err?.message || err || 'break failed')
      if (/not connected|invalid|closed|NJS-003|DPI-1010/i.test(msg)) {
        return { status: 'already_finished' }
      }
      return { status: 'failed', error: sanitizeCancelError(msg) }
    }
  }

  async cancelAllQueries(sessionId: string): Promise<void> {
    const entries = [...this.activeQueries.entries()].filter(([, q]) => q.sessionId === sessionId)
    for (const [queryId] of entries) {
      try {
        await this.cancelQuery(sessionId, queryId)
      } catch {}
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
    const conn = usePinned ? pin!.connection : await session.pool.getConnection()
    const start = Date.now()
    try {
      if (queryId) {
        this.activeQueries.set(queryId, { sessionId, connection: conn, cancelled: false })
      }

      if (useDb && !usePinned) {
        assertIdent(useDb)
        await conn.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${quoteIdentOracle(useDb)}`)
        session.database = useDb
      } else if (useDb && usePinned) {
        assertIdent(useDb)
        await conn.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${quoteIdentOracle(useDb)}`)
        pin!.database = useDb
        session.database = useDb
      }

      if (queryId && this.activeQueries.get(queryId)?.cancelled) {
        throw cancelledError()
      }

      conn.callTimeout = Math.floor(timeoutMs)

      const plan = planSqlRowLimit(trimmed, maxRows, 'oracle')
      if (plan.mode === 'unsupported') {
        throw new Error(plan.error)
      }

      const sqlToRun =
        plan.mode === 'rewrite'
          ? plan.sql
          : plan.mode === 'stream' || plan.mode === 'plain' || plan.mode === 'none'
            ? trimmed
            : trimmed
      // rewrite uses maxRows+1 semantics; stream/plain also fetch maxRows+1 and slice
      const fetchCap =
        plan.mode === 'rewrite' || plan.mode === 'stream' ? maxRows + 1 : maxRows + 1

      const result = await conn.execute(sqlToRun, [], {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        maxRows: fetchCap,
        autoCommit: usePinned ? false : true,
      })

      if (queryId && this.activeQueries.get(queryId)?.cancelled) {
        throw cancelledError()
      }

      const durationMs = Date.now() - start
      const hasMeta = !!(result.metaData && result.metaData.length)
      const hasRows = Array.isArray(result.rows)
      if (hasMeta || hasRows) {
        const { columns, rows: mapped } = mapRows(result as Result<Record<string, unknown>>)
        const allowTruncate = plan.mode === 'rewrite' || plan.mode === 'stream'
        const truncated = allowTruncate && mapped.length > maxRows
        const rows = truncated ? mapped.slice(0, maxRows) : mapped
        return {
          columns,
          rows,
          rowCount: rows.length,
          truncated,
          durationMs,
          hasResultSet: true,
        }
      }

      const rowsAffected =
        typeof result.rowsAffected === 'number' ? result.rowsAffected : undefined
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        affectedRows: rowsAffected,
        durationMs,
        hasResultSet: false,
      }
    } catch (err: any) {
      if (queryId && this.activeQueries.get(queryId)?.cancelled) {
        throw cancelledError()
      }
      const msg = String(err?.message || err || '')
      if (/NJS-040|DPI-1010|broken|canceled|cancelled|user requested cancel/i.test(msg)) {
        throw cancelledError()
      }
      throw err
    } finally {
      if (queryId) this.activeQueries.delete(queryId)
      try {
        conn.callTimeout = 0
      } catch {}
      if (!usePinned) {
        try {
          await conn.close()
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
    const session = this.requireSession(sessionId)
    const owner = schemaOf(session, database)
    const tableName = parseOracleTableName(table)
    assertIdent(tableName)

    const maxRows = Math.min(Math.max(options.maxRows || 1_000_000, 1), 5_000_000)
    const where = buildWhereClauseOracle(options.browse)
    let orderSql = ''
    if (options.browse?.orderBy) {
      assertIdent(options.browse.orderBy)
      orderSql = ` ORDER BY ${quoteIdentOracle(options.browse.orderBy)} ${
        options.browse.orderDir === 'desc' ? 'DESC' : 'ASC'
      }`
    }
    const fq = `${quoteIdentOracle(owner)}.${quoteIdentOracle(tableName)}`
    const sql = `SELECT * FROM ${fq}${where.clause || ''}${orderSql}`

    const conn = await session.pool.getConnection()
    let columns: string[] = []
    let rowsWritten = 0
    let truncated = false
    const batch = 500
    let offset = 0

    try {
      conn.callTimeout = 0
      while (rowsWritten < maxRows) {
        if (options.isCancelled()) {
          throw Object.assign(new Error('Export cancelled'), { code: 'EXPORT_CANCELLED' })
        }
        const need = maxRows - rowsWritten
        const fetchN = Math.min(batch, need + 1)
        const binds = [...(where.params || []), offset, fetchN]
        const offsetPh = `:${(where.params?.length || 0) + 1}`
        const fetchPh = `:${(where.params?.length || 0) + 2}`
        const pageSql =
          `${sql} OFFSET ${offsetPh} ROWS FETCH NEXT ${fetchPh} ROWS ONLY`
        const chunk = await conn.execute(pageSql, binds, {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          maxRows: fetchN,
        })
        const mapped = mapRows(chunk as Result<Record<string, unknown>>)
        if (!columns.length && mapped.columns.length) {
          columns = mapped.columns
          await options.onColumns?.(columns)
        }
        if (!mapped.rows.length) break
        for (const row of mapped.rows) {
          if (options.isCancelled()) {
            throw Object.assign(new Error('Export cancelled'), { code: 'EXPORT_CANCELLED' })
          }
          if (rowsWritten >= maxRows) {
            truncated = true
            break
          }
          if (!columns.length) columns = Object.keys(row)
          rowsWritten++
          await options.onRow(row, columns)
        }
        if (truncated || mapped.rows.length < fetchN) {
          if (mapped.rows.length > need) truncated = true
          break
        }
        offset += mapped.rows.length
      }
      return { columns, rowsWritten, truncated }
    } finally {
      try {
        await conn.close()
      } catch {}
    }
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
      engine: 'oracle',
      host: s.host,
      port: s.port,
      username: s.username,
      database: s.database,
      serverVersion: s.serverVersion,
    }
  }
}

/** Best-effort version string; v$ / product views may be restricted. */
async function readOracleVersion(connection: Connection): Promise<string> {
  const tries = [
    `SELECT banner AS v FROM v$version WHERE ROWNUM = 1`,
    `SELECT version AS v FROM product_component_version WHERE ROWNUM = 1`,
    `SELECT banner_full AS v FROM v$version WHERE ROWNUM = 1`,
  ]
  for (const sql of tries) {
    try {
      const res = await connection.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })
      const row = res.rows?.[0] as { V?: string; v?: string } | undefined
      const v = String(row?.V || row?.v || '').trim()
      if (v) return v
    } catch {
      // try next
    }
  }
  return 'Oracle'
}
