import type { SqlRiskAssessment } from '../sqlRisk'

export type DbEngine = 'mysql' | 'postgres' | 'oracle'

export type DbSslOptions = {
  enabled?: boolean
  rejectUnauthorized?: boolean
  ca?: string
  cert?: string
  key?: string
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
  /** Custom WHERE predicate only (no leading WHERE keyword) */
  where?: string
  filters?: DbColumnFilter[]
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
  extraOptions?: Record<string, string>
  group?: string
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
  viaTunnel?: boolean
  sessionLost?: {
    sessionId: string
    connectionId: string
    reason: 'ssh_tunnel_closed' | 'ssh_tunnel_error'
    detail?: string
  }
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

export type DbTotalMode = 'exact' | 'estimated' | 'unknown'

export interface DbTableBrowseResult {
  columns: string[]
  rows: Array<Record<string, unknown>>
  page: number
  pageSize: number
  total: number
  totalMode: DbTotalMode
  hasNext: boolean
  durationMs: number
}

export type DbCancelStatus = 'cancelled' | 'already_finished' | 'failed' | 'requested'

export type DbCancelResult = {
  status: DbCancelStatus
  error?: string
}

export type DbScriptProgress = {
  jobId: string
  state: 'running' | 'completed' | 'failed' | 'cancelled'
  name: string
  size: number
  bytesRead: number
  statements: number
  affectedRows: number
  line: number
  error?: string
}

export type DbQueryHistoryStatus = 'success' | 'failed' | 'cancelled'

export type DbQueryHistoryRunScope = 'selection' | 'statement' | 'all' | 'explain'

export interface DbQueryHistoryItem {
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
  runScope?: DbQueryHistoryRunScope
  truncated?: boolean
}

export type DbTransactionState = {
  clientKey: string
  inTransaction: boolean
  autocommit: boolean
}

export type DbSqlRiskAssessment = SqlRiskAssessment

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

export type DbErrorPayload = {
  category: DbErrorCategory
  summary: string
  detail?: string
  code?: string
  retryable: boolean
}

export type DbTestParams = Pick<
  DbConnection,
  | 'host'
  | 'port'
  | 'username'
  | 'password'
  | 'database'
  | 'ssl'
  | 'sslOptions'
  | 'extraOptions'
  | 'sshConnectionId'
> & {
  engine?: DbEngine
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
  clientKey?: string
}

export type DbExportFormat = 'csv' | 'jsonl'

export type DbExportTableRequest = {
  sessionId: string
  database: string
  table: string
  format?: DbExportFormat
  options?: DbBrowseOptions
  maxRows?: number
  defaultFileName?: string
}

export type DbExportProgress = {
  exportId: string
  rowsWritten: number
  bytesWritten: number
  phase: 'running' | 'finalizing' | 'done' | 'cancelled' | 'error' | string
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
