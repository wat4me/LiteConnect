export type DbEngine = 'mysql' | 'postgres'

export const DB_ENGINES: readonly DbEngine[] = ['mysql', 'postgres'] as const

export const DEFAULT_DB_PORT: Record<DbEngine, number> = {
  mysql: 3306,
  postgres: 5432,
}

export function isDbEngine(value: unknown): value is DbEngine {
  return value === 'mysql' || value === 'postgres'
}

export function normalizeDbEngine(value: unknown): DbEngine {
  return isDbEngine(value) ? value : 'mysql'
}

/** SSL options for MySQL / PostgreSQL drivers */
export type DbSslOptions = {
  /** Enable TLS */
  enabled?: boolean
  /** Verify server certificate (default true when CA provided, else false for compat) */
  rejectUnauthorized?: boolean
  /** PEM CA certificate content */
  ca?: string
  /** PEM client certificate content */
  cert?: string
  /** PEM client private key content */
  key?: string
}

export interface DbConnection {
  id: string
  name: string
  engine: DbEngine
  host: string
  port: number
  username: string
  password: string
  encrypted?: boolean
  database?: string
  /** @deprecated use sslOptions.enabled; kept for backward compatibility */
  ssl?: boolean
  sslOptions?: DbSslOptions
  /** Optional group label for navigation */
  group?: string
  /**
   * When set, open an SSH tunnel via this SSH connection (credential store id)
   * before connecting to the database. host/port are addresses as seen from the SSH host.
   */
  sshConnectionId?: string
  order?: number
  createdAt: number
  updatedAt: number
}

export interface DbQueryResult {
  columns: string[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  truncated: boolean
  affectedRows?: number
  insertId?: number | string
  durationMs: number
  /** true when result is a result-set (SELECT); false for OK packet only */
  hasResultSet: boolean
}

export interface DbSessionInfo {
  sessionId: string
  connectionId: string
  connectionName: string
  engine: DbEngine
  host: string
  port: number
  username: string
  database: string | null
  serverVersion: string
  /** True when connected via SSH tunnel */
  viaTunnel?: boolean
  /**
   * Present when SSH tunnel dropped during connect (race with db:sessionLost).
   * Renderer should treat as session lost and use i18n, not any English detail.
   */
  sessionLost?: {
    sessionId: string
    connectionId: string
    reason: 'ssh_tunnel_closed' | 'ssh_tunnel_error'
    detail?: string
  }
  /** SSH connection display name when via tunnel */
  sshConnectionName?: string
}

export interface DbTableInfo {
  name: string
  type: 'table' | 'view'
  engine: string | null
  rows: number | null
  comment: string
}

export interface DbColumnInfo {
  name: string
  type: string
  nullable: boolean
  key: string
  defaultValue: string | null
  extra: string
  comment: string
}

export interface DbIndexInfo {
  name: string
  columns: string[]
  unique: boolean
  primary: boolean
  type: string
  comment: string
}

/** How `total` should be interpreted for table browse pagination */
export type DbTotalMode = 'exact' | 'estimated' | 'unknown'

export interface DbTableBrowseResult {
  columns: string[]
  rows: Array<Record<string, unknown>>
  page: number
  pageSize: number
  /**
   * Row count when totalMode is exact;
   * estimate when estimated;
   * lower bound (or 0) when unknown — never a fabricated exact total.
   */
  total: number
  totalMode: DbTotalMode
  /** True when more rows exist after this page (from pageSize+1 fetch) */
  hasNext: boolean
  durationMs: number
}

/** Structured cancel outcome (DB-007) */
export type DbCancelStatus = 'cancelled' | 'already_finished' | 'failed' | 'requested'

export type DbCancelResult = {
  status: DbCancelStatus
  /** Safe, non-secret error detail when status is failed */
  error?: string
}

export type DbTestParams = Pick<
  DbConnection,
  'host' | 'port' | 'username' | 'password' | 'database' | 'ssl' | 'sslOptions' | 'sshConnectionId'
> & {
  engine?: DbEngine
  /** Temporary password fill from store when testing edit form */
  connectionId?: string
}

export type DbTestResult = {
  ok: boolean
  latencyMs?: number
  serverVersion?: string
  error?: string
  viaTunnel?: boolean
}

export type DbQueryOptions = {
  maxRows?: number
  timeoutMs?: number
  queryId?: string
  database?: string
  /**
   * Sticky client key (query tab id). When a transaction is open for this key,
   * all queries must use the same physical connection (DB-009).
   */
  clientKey?: string
}

/** Transaction state for a sticky client (query tab) */
export type DbTransactionState = {
  clientKey: string
  inTransaction: boolean
  /** MySQL: autocommit mode when not in explicit TX; PG: always true outside TX */
  autocommit: boolean
}

export type DbErrorCategory =
  | 'auth'
  | 'refused'
  | 'timeout'
  | 'tunnel'
  | 'session'
  | 'permission'
  | 'syntax'
  | 'query_timeout'
  | 'cancel'
  | 'deadlock'
  | 'serialization'
  | 'unknown'

/** Structured error payload for renderer (DB-010) */
export type DbErrorPayload = {
  category: DbErrorCategory
  summary: string
  detail?: string
  code?: string
  retryable: boolean
}

export type DbQueryHistoryStatus = 'success' | 'failed' | 'cancelled'

export type DbQueryHistoryRunScope = 'selection' | 'statement' | 'all' | 'explain'

export type DbQueryHistoryPushInput = {
  sql: string
  database?: string
  connectionId?: string
  status?: DbQueryHistoryStatus
  durationMs?: number
  rowCount?: number
  affectedRows?: number
  errorSummary?: string
  slow?: boolean
  /** Safe optional log metadata (DQB-005) */
  runScope?: DbQueryHistoryRunScope
  truncated?: boolean
}

export type DbExportFormat = 'csv' | 'jsonl'

export type DbExportTableRequest = {
  sessionId: string
  database: string
  table: string
  format?: DbExportFormat
  /** Optional browse filters / order (same as browseTable) */
  options?: DbBrowseOptions
  /** Max rows hard cap (default 1_000_000) */
  maxRows?: number
  /** Suggested filename only; main process shows save dialog */
  defaultFileName?: string
}

export type DbExportProgress = {
  exportId: string
  rowsWritten: number
  bytesWritten: number
  phase: 'running' | 'finalizing' | 'done' | 'cancelled' | 'error'
  error?: string
  filePath?: string
}

export type DbExportResult = {
  exportId: string
  ok: boolean
  cancelled?: boolean
  filePath?: string
  rowsWritten: number
  error?: string
}

export type DbFilterOp =
  | 'eq'
  | 'ne'
  | 'like'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'is_null'
  | 'is_not_null'

export type DbColumnFilter = {
  column: string
  op: DbFilterOp
  value?: string
}

export type DbBrowseOptions = {
  orderBy?: string
  orderDir?: 'asc' | 'desc'
  /** Free-text search: OR LIKE across listed columns (or all result columns if omitted at driver) */
  search?: string
  /** Optional explicit columns for search; empty = use first 32 non-blob columns from table */
  searchColumns?: string[]
  /** Structured column filters (AND) */
  filters?: DbColumnFilter[]
}

/** Build mysql2 / pg ssl config from connection fields */
export function resolveSslConfig(
  ssl?: boolean,
  sslOptions?: DbSslOptions,
): false | Record<string, unknown> {
  const enabled = sslOptions?.enabled ?? !!ssl
  if (!enabled) return false

  const rejectUnauthorized =
    typeof sslOptions?.rejectUnauthorized === 'boolean'
      ? sslOptions.rejectUnauthorized
      : !!(sslOptions?.ca && sslOptions.ca.trim())

  const cfg: Record<string, unknown> = { rejectUnauthorized }
  if (sslOptions?.ca?.trim()) cfg.ca = sslOptions.ca
  if (sslOptions?.cert?.trim()) cfg.cert = sslOptions.cert
  if (sslOptions?.key?.trim()) cfg.key = sslOptions.key
  return cfg
}
