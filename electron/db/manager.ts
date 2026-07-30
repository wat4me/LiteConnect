import type { DbDriver } from './driver'
import { DbTunnelService, type DbTunnelLostReason } from './tunnel/dbTunnelService'
import type { DbTunnelHandle } from './tunnel/sshTunnel'
import type {
  DbBrowseOptions,
  DbColumnInfo,
  DbConnection,
  DbEngine,
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
} from './types'
import { toIpcDbError } from './dbError'
import type { DbExportStreamHandlers } from './driver'
import { normalizeDbEngine } from './types'
import type { CredentialStore } from '../store/credentialStore'
import type { KnownHostsStore } from '../ssh/trust/knownHosts'

/**
 * Facade over engine-specific drivers + optional SSH tunnels for DB sessions.
  * Tunnel open/registry lives in DbTunnelService; drivers (mysql2 / pg / oracledb) load on first use.
 */
export type DbSessionLostReason = DbTunnelLostReason

export type DbSessionLostEvent = {
  sessionId: string
  connectionId: string
  /** Structured reason for i18n — do not use as default UI copy */
  reason: DbSessionLostReason
  /** Optional technical detail for logs; renderer must not treat as primary UI text */
  detail?: string
}

export class DatabaseManager {
  private readonly drivers: Partial<Record<DbEngine, DbDriver>> = {}
  private readonly tunnels = new DbTunnelService()
  /** In-flight connect promises per connectionId (main-process dedupe) */
  private connectInflight = new Map<string, Promise<DbSessionInfo>>()
  /** Sessions already notified as lost (dedupe remote close + error) */
  private sessionLostNotified = new Set<string>()
  /**
   * Pending sessionLost events that fired before connect() returned to renderer.
   * Keyed by connectionId; drained when connect completes or via takePendingSessionLost.
   */
  private pendingSessionLost = new Map<string, DbSessionLostEvent>()

  private onSessionLost: ((ev: DbSessionLostEvent) => void) | null = null

  setTunnelDeps(credentialStore: CredentialStore, knownHosts: KnownHostsStore): void {
    this.tunnels.setDeps(credentialStore, knownHosts)
  }

  setSessionLostHandler(handler: ((ev: DbSessionLostEvent) => void) | null): void {
    this.onSessionLost = handler
  }

  private async ensureDriver(engine: DbEngine | undefined | null): Promise<DbDriver> {
    const key = normalizeDbEngine(engine)
    const existing = this.drivers[key]
    if (existing) return existing
    if (key === 'postgres') {
      const { PostgresDriver } = await import('./drivers/postgres')
      const driver = new PostgresDriver()
      this.drivers.postgres = driver
      return driver
    }
    if (key === 'oracle') {
      const { OracleDriver } = await import('./drivers/oracle')
      const driver = new OracleDriver()
      this.drivers.oracle = driver
      return driver
    }
    const { MySqlDriver } = await import('./drivers/mysql')
    const driver = new MySqlDriver()
    this.drivers.mysql = driver
    return driver
  }

  private driverForSession(sessionId: string): DbDriver {
    for (const driver of Object.values(this.drivers)) {
      if (driver?.hasSession(sessionId)) return driver
    }
    throw new Error('Database session not found')
  }

  async connect(conn: DbConnection): Promise<DbSessionInfo> {
    const existing = this.connectInflight.get(conn.id)
    if (existing) return existing

    const run = this.connectOnce(conn).finally(() => {
      if (this.connectInflight.get(conn.id) === run) {
        this.connectInflight.delete(conn.id)
      }
    })
    this.connectInflight.set(conn.id, run)
    return run
  }

  private async connectOnce(conn: DbConnection): Promise<DbSessionInfo> {
    this.pendingSessionLost.delete(conn.id)

    const driver = await this.ensureDriver(conn.engine)
    const { effective, tunnel, sshName } = await this.tunnels.openIfNeeded(conn)
    try {
      const info = await driver.connect(effective as DbConnection)
      if (tunnel) {
        this.attachTunnel(info.sessionId, conn.id, tunnel)
        info.viaTunnel = true
        info.sshConnectionName = sshName
        info.host = conn.host
        info.port = conn.port
      }
      const pending = this.pendingSessionLost.get(conn.id)
      if (pending && pending.sessionId === info.sessionId) {
        ;(info as DbSessionInfo & { sessionLost?: DbSessionLostEvent }).sessionLost = pending
      }
      return info
    } catch (err) {
      tunnel?.close()
      throw err
    }
  }

  /**
   * Renderer handshake after dbConnect: claim any sessionLost that raced ahead of the
   * connect response so the UI never misses a disconnect during connect.
   */
  takePendingSessionLost(connectionId: string, sessionId?: string): DbSessionLostEvent | null {
    const pending = this.pendingSessionLost.get(connectionId)
    if (!pending) return null
    if (sessionId && pending.sessionId !== sessionId) return null
    this.pendingSessionLost.delete(connectionId)
    return pending
  }

  private attachTunnel(sessionId: string, connectionId: string, tunnel: DbTunnelHandle): void {
    this.sessionLostNotified.delete(sessionId)
    this.tunnels.attach(sessionId, connectionId, tunnel, (reason) => {
      void this.handleTunnelLost(sessionId, connectionId, reason)
    })
  }

  private async handleTunnelLost(
    sessionId: string,
    connectionId: string,
    reason: DbSessionLostReason,
  ): Promise<void> {
    if (!this.tunnels.has(sessionId)) return
    if (this.sessionLostNotified.has(sessionId)) return
    this.sessionLostNotified.add(sessionId)

    const detail =
      reason === 'ssh_tunnel_error' ? 'ssh_tunnel_error' : 'ssh_tunnel_closed'

    this.tunnels.closeSession(sessionId)

    const ev: DbSessionLostEvent = {
      sessionId,
      connectionId,
      reason,
      detail,
    }
    this.pendingSessionLost.set(connectionId, ev)
    this.onSessionLost?.(ev)

    try {
      for (const driver of Object.values(this.drivers)) {
        if (driver?.hasSession(sessionId)) {
          await driver.disconnect(sessionId)
          break
        }
      }
    } catch {}
  }

  async test(conn: DbTestParams): Promise<DbTestResult> {
    const driver = await this.ensureDriver(conn.engine)
    const { effective, tunnel } = await this.tunnels.openIfNeeded(conn)
    try {
      const result = await driver.test(effective)
      if (tunnel && result.ok) result.viaTunnel = true
      return result
    } finally {
      tunnel?.close()
    }
  }

  async disconnect(sessionId: string): Promise<void> {
    this.sessionLostNotified.add(sessionId)
    for (const [connId, pending] of this.pendingSessionLost) {
      if (pending.sessionId === sessionId) this.pendingSessionLost.delete(connId)
    }
    try {
      await this.driverForSession(sessionId).disconnect(sessionId)
    } catch (err: any) {
      if (err?.message === 'Database session not found') {
        this.tunnels.closeSession(sessionId)
        return
      }
      throw err
    } finally {
      this.tunnels.closeSession(sessionId)
    }
  }

  disconnectAll(): void {
    for (const sid of this.tunnels.sessionIds()) {
      this.sessionLostNotified.add(sid)
    }
    for (const driver of Object.values(this.drivers)) {
      void Promise.resolve(driver?.disconnectAll()).catch(() => {})
    }
    this.tunnels.closeAll()
    this.pendingSessionLost.clear()
  }

  async disconnectByConnectionId(connectionId: string): Promise<void> {
    this.pendingSessionLost.delete(connectionId)
    for (const driver of Object.values(this.drivers)) {
      await driver?.disconnectByConnectionId(connectionId)
    }
    for (const sid of this.tunnels.sessionsForConnection(connectionId)) {
      this.sessionLostNotified.add(sid)
    }
    this.tunnels.closeByConnectionId(connectionId)
  }

  getSession(sessionId: string): DbSessionInfo | null {
    for (const driver of Object.values(this.drivers)) {
      const s = driver?.getSession(sessionId)
      if (s) {
        if (this.tunnels.has(sessionId)) {
          s.viaTunnel = true
        }
        return s
      }
    }
    return null
  }

  async listDatabases(sessionId: string): Promise<string[]> {
    return this.driverForSession(sessionId).listDatabases(sessionId)
  }

  async createDatabase(
    sessionId: string,
    name: string,
    options?: { charset?: string; collate?: string; encoding?: string; template?: string },
  ): Promise<void> {
    return this.driverForSession(sessionId).createDatabase(sessionId, name, options)
  }

  async listTables(sessionId: string, database?: string): Promise<string[]> {
    return this.driverForSession(sessionId).listTables(sessionId, database)
  }

  async listTableInfos(sessionId: string, database?: string): Promise<DbTableInfo[]> {
    return this.driverForSession(sessionId).listTableInfos(sessionId, database)
  }

  async getTableColumns(sessionId: string, database: string, table: string): Promise<DbColumnInfo[]> {
    return this.driverForSession(sessionId).getTableColumns(sessionId, database, table)
  }

  async getTableIndexes(sessionId: string, database: string, table: string): Promise<DbIndexInfo[]> {
    return this.driverForSession(sessionId).getTableIndexes(sessionId, database, table)
  }

  async getCreateTable(sessionId: string, database: string, table: string): Promise<string> {
    return this.driverForSession(sessionId).getCreateTable(sessionId, database, table)
  }

  async browseTable(
    sessionId: string,
    database: string,
    table: string,
    page = 1,
    pageSize = 100,
    options?: DbBrowseOptions,
  ): Promise<DbTableBrowseResult> {
    return this.driverForSession(sessionId).browseTable(
      sessionId,
      database,
      table,
      page,
      pageSize,
      options,
    )
  }

  async useDatabase(sessionId: string, database: string): Promise<void> {
    return this.driverForSession(sessionId).useDatabase(sessionId, database)
  }

  async cancelQuery(sessionId: string, queryId: string) {
    return this.driverForSession(sessionId).cancelQuery(sessionId, queryId)
  }

  async query(
    sessionId: string,
    sql: string,
    options?: DbQueryOptions,
  ): Promise<DbQueryResult> {
    const viaTunnel = this.tunnels.has(sessionId)
    const engine = this.getSession(sessionId)?.engine
    try {
      return await this.driverForSession(sessionId).query(sessionId, sql, options)
    } catch (err) {
      throw toIpcDbError(err, engine, { viaTunnel })
    }
  }

  async beginTransaction(
    sessionId: string,
    clientKey: string,
    database?: string,
  ): Promise<DbTransactionState> {
    const driver = this.driverForSession(sessionId)
    if (!driver.beginTransaction) throw new Error('Transactions not supported')
    try {
      return await driver.beginTransaction(sessionId, clientKey, database)
    } catch (err) {
      throw toIpcDbError(err, this.getSession(sessionId)?.engine, {
        viaTunnel: this.tunnels.has(sessionId),
      })
    }
  }

  async commitTransaction(sessionId: string, clientKey: string): Promise<DbTransactionState> {
    const driver = this.driverForSession(sessionId)
    if (!driver.commitTransaction) throw new Error('Transactions not supported')
    try {
      return await driver.commitTransaction(sessionId, clientKey)
    } catch (err) {
      throw toIpcDbError(err, this.getSession(sessionId)?.engine, {
        viaTunnel: this.tunnels.has(sessionId),
      })
    }
  }

  async rollbackTransaction(sessionId: string, clientKey: string): Promise<DbTransactionState> {
    const driver = this.driverForSession(sessionId)
    if (!driver.rollbackTransaction) throw new Error('Transactions not supported')
    try {
      return await driver.rollbackTransaction(sessionId, clientKey)
    } catch (err) {
      throw toIpcDbError(err, this.getSession(sessionId)?.engine, {
        viaTunnel: this.tunnels.has(sessionId),
      })
    }
  }

  getTransactionState(sessionId: string, clientKey: string): DbTransactionState {
    const driver = this.driverForSession(sessionId)
    if (!driver.getTransactionState) {
      return { clientKey, inTransaction: false, autocommit: true }
    }
    return driver.getTransactionState(sessionId, clientKey)
  }

  async releaseClient(sessionId: string, clientKey: string): Promise<void> {
    const driver = this.driverForSession(sessionId)
    if (driver.releaseClient) await driver.releaseClient(sessionId, clientKey)
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
    const driver = this.driverForSession(sessionId)
    if (!driver.exportTableStream) throw new Error('Export streaming not supported')
    try {
      return await driver.exportTableStream(sessionId, database, table, options)
    } catch (err) {
      throw toIpcDbError(err, this.getSession(sessionId)?.engine, {
        viaTunnel: this.tunnels.has(sessionId),
      })
    }
  }
}
