import type {
  DbColumnInfo,
  DbConnection,
  DbIndexInfo,
  DbQueryResult,
  DbSslOptions,
  DbTableBrowseResult,
  DbTableInfo,
} from '../../env.d'

export type GridSort = { col: string; dir: 'asc' | 'desc' } | null

export type QueryTab = {
  id: string
  kind: 'query'
  /** 绑定的数据库连接（可同时连多台） */
  connectionId: string
  title: string
  /** 当前查询使用的库；空字符串表示不强制 USE */
  database: string
  sql: string
  loading: boolean
  error: string
  /** Expandable technical detail (sanitized) */
  errorDetail?: string
  /** Structured error category for retry UI */
  errorCategory?: string
  errorRetryable?: boolean
  result: DbQueryResult | null
  /** 进行中查询 id，用于取消 */
  queryId: string | null
  /** UI: cancel in flight (DB-007) */
  cancelling?: boolean
  /** Explicit transaction on sticky client (DB-009); clientKey === tab.id */
  inTransaction?: boolean
  autocommit?: boolean
  /** Epoch ms when current transaction began (UI duration); cleared on commit/rollback */
  transactionStartedAt?: number | null
  /**
   * Last successful output kind for bottom panels.
   * - result: normal query
   * - plan: EXPLAIN
   */
  outputKind?: 'result' | 'plan' | null
  /** 客户端结果排序 */
  sort: GridSort
  /** 结果内筛选 */
  filter: string
  /**
   * Ephemeral SQL editor UI (selection/scroll) for tab switch restore.
   * Not persisted to disk/localStorage; cleared when tab closes.
   */
  editorUi?: {
    selectionAnchor: number
    selectionHead: number
    scrollTop: number
    scrollLeft: number
  } | null
  /**
   * Last successfully executed SQL that matched the full document (trim).
   * Partial runs (selection/statement) do not update this.
   * null = never full-doc success → dirty if sql non-empty.
   */
  lastFullDocExecutedSql?: string | null
  /** User renamed the tab; auto title from SQL must not overwrite */
  titleCustomized?: boolean
  /** Request editor focus after open/restore (consumed by DbQueryTab) */
  focusEditor?: boolean
  /**
   * Per-query-tab read-only mode (DQB-003).
   * Default false to preserve existing write/tx workflows; when true, only
   * demonstrably read-only SQL may run (enforced in UI + main IPC).
   */
  readOnly?: boolean
  /** Per-tab max result rows (DQB-006); sanitized before IPC */
  maxRows?: number
  /** Per-tab query timeout ms (DQB-006) */
  timeoutMs?: number
  /**
   * Preferred default run scope for the primary run button.
   * smart = existing selection → statement → all behavior.
   */
  defaultRunScope?: 'smart' | 'selection' | 'statement' | 'all'
  savedQueryId?: string | null
}

export type DataTab = {
  id: string
  kind: 'data'
  connectionId: string
  title: string
  database: string
  table: string
  /** 表工作区内子页：数据 / 结构 */
  panel: 'data' | 'structure'
  page: number
  pageSize: number
  loading: boolean
  error: string
  result: DbTableBrowseResult | null
  /** 服务端 ORDER BY */
  sort: GridSort
  /** 服务端全文搜索（跨列 LIKE） */
  serverSearch: string
  /** 本页结果筛选 */
  filter: string
  columnsMeta: DbColumnInfo[]
  pkColumns: string[]
  /** 行索引 -> 修改后的整行 */
  dirty: Record<number, Record<string, unknown>>
  selected: number[]
  /** 正在编辑的单元格 */
  editCell: { rowIndex: number; col: string } | null
  editDraft: string
  editAsNull: boolean
  /** 新增行草稿 */
  inserting: Record<string, unknown> | null
  saving: boolean
  /** 结构子页 */
  structureLoading: boolean
  structureError: string
  structureLoaded: boolean
  indexes: DbIndexInfo[]
  createSql: string
}

/** @deprecated structure is a panel of DataTab */
export type StructureTab = {
  id: string
  kind: 'structure'
  connectionId: string
  title: string
  database: string
  table: string
  loading: boolean
  error: string
  columns: DbColumnInfo[]
  indexes: DbIndexInfo[]
  createSql: string
}

export type ConnectionFormModel = {
  name: string
  engine: import('../../env.d').DbEngine
  host: string
  port: number
  username: string
  password: string
  database: string
  ssl: boolean
  sslOptions: DbSslOptions
  group: string
  sshConnectionId: string
}

export type WsTab = QueryTab | DataTab

export type QueryHistoryItem = {
  id: string
  sql: string
  database: string
  at: number
  connectionId?: string
  status?: 'success' | 'failed' | 'cancelled'
  durationMs?: number
  rowCount?: number
  affectedRows?: number
  errorSummary?: string
  slow?: boolean
  runScope?: 'selection' | 'statement' | 'all' | 'explain'
  truncated?: boolean
}

export type NavMenu =
  | { kind: 'conn'; x: number; y: number; conn: DbConnection }
  | { kind: 'db'; x: number; y: number; connectionId: string; database: string }
  | { kind: 'table'; x: number; y: number; connectionId: string; database: string; table: DbTableInfo }

export type SqlAcItem = { name: string; kind: 'table' | 'view' | 'column'; detail?: string }

export type SavedQuery = {
  id: string
  title: string
  sql: string
  connectionId: string
  database: string
  createdAt: number
}

export type { DbColumnInfo, DbConnection, DbIndexInfo, DbTableInfo }
