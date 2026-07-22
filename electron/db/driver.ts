import type {
  DbBrowseOptions,
  DbCancelResult,
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

export type DbExportStreamHandlers = {
  onRow: (row: Record<string, unknown>, columns: string[]) => void | Promise<void>
  onColumns?: (columns: string[]) => void | Promise<void>
  isCancelled: () => boolean
}

/**
 * Engine-specific database driver.
 * Each driver owns its live sessions and active query bookkeeping.
 */
export interface DbDriver {
  readonly engine: DbEngine

  connect(conn: DbConnection): Promise<DbSessionInfo>
  test(conn: DbTestParams): Promise<DbTestResult>
  disconnect(sessionId: string): Promise<void>
  disconnectAll(): void | Promise<void>
  disconnectByConnectionId(connectionId: string): Promise<void>
  hasSession(sessionId: string): boolean
  getSession(sessionId: string): DbSessionInfo | null

  listDatabases(sessionId: string): Promise<string[]>
  listTables(sessionId: string, database?: string): Promise<string[]>
  listTableInfos(sessionId: string, database?: string): Promise<DbTableInfo[]>
  getTableColumns(sessionId: string, database: string, table: string): Promise<DbColumnInfo[]>
  getTableIndexes(sessionId: string, database: string, table: string): Promise<DbIndexInfo[]>
  getCreateTable(sessionId: string, database: string, table: string): Promise<string>
  browseTable(
    sessionId: string,
    database: string,
    table: string,
    page?: number,
    pageSize?: number,
    options?: DbBrowseOptions,
  ): Promise<DbTableBrowseResult>
  useDatabase(sessionId: string, database: string): Promise<void>
  createDatabase(sessionId: string, name: string, options?: { charset?: string; collate?: string; encoding?: string; template?: string }): Promise<void>
  cancelQuery(sessionId: string, queryId: string): Promise<DbCancelResult>
  /** Best-effort cancel of all in-flight queries for a session (before disconnect) */
  cancelAllQueries?(sessionId: string): Promise<void>
  query(sessionId: string, sql: string, options?: DbQueryOptions): Promise<DbQueryResult>

  /** Pin a physical connection and BEGIN (DB-009) */
  beginTransaction?(
    sessionId: string,
    clientKey: string,
    database?: string,
  ): Promise<DbTransactionState>
  commitTransaction?(sessionId: string, clientKey: string): Promise<DbTransactionState>
  rollbackTransaction?(sessionId: string, clientKey: string): Promise<DbTransactionState>
  getTransactionState?(sessionId: string, clientKey: string): DbTransactionState
  /** Rollback+release all pins for session (disconnect / close) */
  releaseAllClients?(sessionId: string): Promise<void>
  releaseClient?(sessionId: string, clientKey: string): Promise<void>

  /**
   * Stream full table for export (DB-012). Does not materialize full result in memory.
   * Uses independent cancel via isCancelled; must not share normal query cancel map incorrectly.
   */
  exportTableStream?(
    sessionId: string,
    database: string,
    table: string,
    options: {
      browse?: DbBrowseOptions
      maxRows: number
      format: DbExportFormat
    } & DbExportStreamHandlers,
  ): Promise<{ columns: string[]; rowsWritten: number; truncated: boolean }>
}
