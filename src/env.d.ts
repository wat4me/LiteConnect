/// <reference types="vite/client" />

export {}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare global {
  interface Window {
    LiteConnect: {
      getAppBootstrap: () => Promise<AppBootstrapData>
      getConnections: () => Promise<Connection[]>
      saveConnection: (conn: Partial<Connection> & { name: string; host: string; username: string; password: string }) => Promise<Connection>
      deleteConnection: (id: string) => Promise<boolean>
      updateConnectionGroup: (id: string, groupId: string | undefined) => Promise<boolean>
      reorderConnections: (orderedIds: string[]) => Promise<void>
      isEncryptionAvailable: () => Promise<boolean>
      getConnectionPassword: (id: string) => Promise<string>
      getSavedCredentials: () => Promise<SavedCredential[]>
      getSavedCredentialPassword: (id: string) => Promise<string>
      saveSavedCredential: (credential: Partial<SavedCredential> & { name: string; username: string; password: string }) => Promise<SavedCredential>
      deleteSavedCredential: (id: string) => Promise<boolean>

      getGroups: () => Promise<Group[]>
      saveGroup: (group: Partial<Group> & { name: string }) => Promise<Group>
      deleteGroup: (id: string) => Promise<boolean>
      reorderGroups: (ids: string[]) => Promise<void>
      setDefaultGroup: (id: string | null) => Promise<void>

      getDownloadPath: () => Promise<string>
      /** OS Downloads folder (Electron app.getPath('downloads')) */
      getDefaultDownloadPath: () => Promise<string>
      /** User-configured path; empty string means use system default */
      getConfiguredDownloadPath: () => Promise<string>
      setDownloadPath: (dirPath: string) => Promise<void>
      getAutoReconnectEnabled: () => Promise<boolean>
      setAutoReconnectEnabled: (enabled: boolean) => Promise<void>
      getAutoReconnectMaxRetries: () => Promise<number>
      setAutoReconnectMaxRetries: (n: number) => Promise<void>
      getX11AutoStartEnabled: () => Promise<boolean>
      setX11AutoStartEnabled: (enabled: boolean) => Promise<void>
      getX11ServerPath: () => Promise<string>
      setX11ServerPath: (path: string) => Promise<void>
      getX11ServerStatus: (draftExecutablePath?: string) => Promise<{
        autoStart: boolean
        executablePath: string
        resolvedExecutablePath: string | null
        platform: string
        supported: boolean
      }>
      getBundledX11InstallerStatus: () => Promise<{ available: boolean }>
      installBundledX11Server: () => Promise<{ started: boolean }>
      selectX11ServerExecutable: () => Promise<string | null>

      getRecentConnections: () => Promise<Connection[]>
      recordRecentConnection: (connectionId: string) => Promise<void>
      selectDirectory: () => Promise<string | null>
      isLocalDirectory: (dirPath: string) => Promise<boolean>

      getTerminalFontSize: () => Promise<number>
      setTerminalFontSize: (size: number) => Promise<void>
      getTerminalFontFamily: () => Promise<string>
      setTerminalFontFamily: (family: string) => Promise<void>
      getDbFontFamily: () => Promise<string>
      setDbFontFamily: (family: string) => Promise<void>
      getDbFontSize: () => Promise<number>
      setDbFontSize: (size: number) => Promise<void>
      getDbPageSize: () => Promise<number>
      setDbPageSize: (size: number) => Promise<void>
      getDbConfirmDangerousSql: () => Promise<boolean>
      setDbConfirmDangerousSql: (enabled: boolean) => Promise<void>
      getDbDefaultMaxRows: () => Promise<number>
      setDbDefaultMaxRows: (n: number) => Promise<void>
      getDbDefaultQueryTimeoutSec: () => Promise<number>
      setDbDefaultQueryTimeoutSec: (sec: number) => Promise<void>
      getDbDefaultRunScope: () => Promise<'smart' | 'selection' | 'statement' | 'all'>
      setDbDefaultRunScope: (scope: 'smart' | 'selection' | 'statement' | 'all') => Promise<void>
      getTerminalPalette: () => Promise<string>
      setTerminalPalette: (palette: string) => Promise<void>
      getTerminalScrollback: () => Promise<number>
      setTerminalScrollback: (n: number) => Promise<void>
      getTerminalPasteConfirmEnabled: () => Promise<boolean>
      setTerminalPasteConfirmEnabled: (enabled: boolean) => Promise<void>
      getTerminalPasteConfirmMaxChars: () => Promise<number>
      setTerminalPasteConfirmMaxChars: (n: number) => Promise<void>
      getTerminalCommandSuggestEnabled: () => Promise<boolean>
      setTerminalCommandSuggestEnabled: (enabled: boolean) => Promise<void>
      getDownloadConflictStrategy: () => Promise<'overwrite' | 'skip' | 'rename'>
      setDownloadConflictStrategy: (strategy: 'overwrite' | 'skip' | 'rename') => Promise<void>
      getDirTransferConcurrency: () => Promise<number>
      setDirTransferConcurrency: (n: number) => Promise<void>
      getDirTransferFailPolicy: () => Promise<'continue' | 'stop'>
      setDirTransferFailPolicy: (policy: 'continue' | 'stop') => Promise<void>
      getCommandSnippets: () => Promise<CommandSnippet[]>
      setCommandSnippets: (snippets: Array<Partial<CommandSnippet> & { name: string; command: string; group?: string }>) => Promise<CommandSnippet[]>
      exportCommandSnippets: () => Promise<boolean>
      importCommandSnippets: (mode?: 'append' | 'replace') => Promise<{ imported: number; total: number } | null>
      listShellCommandHistory: (connectionId: string) => Promise<ShellCommandHistoryItem[]>
      pushShellCommandHistory: (connectionId: string, command: string) => Promise<ShellCommandHistoryItem[]>
      clearShellCommandHistory: (connectionId?: string) => Promise<boolean>
      getRecentDownloadPaths: () => Promise<string[]>
      addRecentDownloadPath: (dirPath: string) => Promise<void>
      getCredentialAutoFillEnabled: () => Promise<boolean>
      setCredentialAutoFillEnabled: (enabled: boolean) => Promise<void>
      getAiSettings: () => Promise<AiSettings>
      setAiSettings: (settings: AiSettings) => Promise<void>
      switchAiModel: (providerId: string, model: string) => Promise<AiSettings>
      testAiProvider: (provider: { baseUrl: string; apiKey: string; model: string }) => Promise<{ ok: boolean }>
      aiChat: (messages: AiChatMessage[]) => Promise<AiChatResult>
      aiChatStream: (requestId: string, messages: AiChatMessage[]) => Promise<AiChatResult>
      aiAbortChatStream: (requestId: string) => Promise<boolean>
      getAiSessionHistory: (sessionId: string) => Promise<AiHistoryRecord[]>
      getAiSessionStore: (sessionId: string) => Promise<AiSessionStore>
      setAiSessionStore: (sessionId: string, store: AiSessionStore) => Promise<void>
      appendAiSessionHistory: (sessionId: string, record: AiHistoryRecord) => Promise<void>
      clearAiSessionHistory: (sessionId: string) => Promise<void>
      onAiChatStream: (requestId: string, callback: (payload: AiChatStreamPayload) => void) => () => void

      getLatencyEnabled: () => Promise<boolean>
      setLatencyEnabled: (enabled: boolean) => Promise<void>
      getLatencyIntervalMs: () => Promise<number>
      setLatencyIntervalMs: (intervalMs: number) => Promise<void>

      exportConnections: () => Promise<boolean>
      importConnections: () => Promise<{ imported: number; total: number } | null>

      sshConnect: (connectionId: string) => Promise<string>
      sshReconnect: (sessionId: string, connectionId: string) => Promise<string>
      sshTakeStartupNotices: (sessionId: string) => Promise<string[]>
      sshDisconnect: (sessionId: string) => Promise<void>
      sshWrite: (sessionId: string, data: string) => void
      sshResize: (sessionId: string, cols: number, rows: number) => void
      sshTestConnection: (connectionId: string) => Promise<{
        ok: boolean
        latency?: number
        stage?: string
        error?: string
      }>
      sshTestConnectionParams: (params: {
        host: string
        port: number
        username: string
        password?: string
        privateKey?: string
        connectionId?: string
        savedCredentialId?: string
        jumpHost?: string
        jumpPort?: number
        jumpUsername?: string
        jumpPassword?: string
        jumpPrivateKey?: string
        useAgent?: boolean
      }) => Promise<{
        ok: boolean
        latency?: number
        stage?: string
        error?: string
      }>
      sshDiagnoseConnectionParams: (params: {
        host: string
        port: number
        username: string
        password?: string
        privateKey?: string
        connectionId?: string
        savedCredentialId?: string
        jumpHost?: string
        jumpPort?: number
        jumpUsername?: string
        jumpPassword?: string
        jumpPrivateKey?: string
        useAgent?: boolean
      }) => Promise<{
        ok: boolean
        tcpLatency?: number
        sshReadyLatency?: number
        shellOpenLatency?: number
        shellFirstByteLatency?: number
        totalLatency?: number
        stage?: string
        error?: string
      }>

      sshRemoveHostKey: (host: string, port: number) => Promise<void>
      sshUpdateHostKey: (host: string, port: number, keyBuffer: Buffer) => Promise<string>
      sshGetHostKeyFingerprint: (host: string, port: number) => Promise<string | null>
      sshConfirmHostKey: (connectionId: string) => Promise<string>
      sshRejectHostKey: (connectionId: string) => Promise<void>
      onSshHostKeyMismatch: (callback: (data: {
        connectionId: string
        host: string
        port: number
        existingFingerprint: string
        newFingerprint: string
        role?: 'target' | 'jump'
      }) => void) => () => void
      onSshDecryptionFailed: (callback: (data: { connectionId: string; field: 'password' | 'privateKey' | 'apiKey'; message: string }) => void) => () => void

      sshStartLatencyMonitor: (sessionId: string) => Promise<void>
      sshStopLatencyMonitor: (sessionId: string) => Promise<void>
      sshMeasureLatency: (sessionId: string) => Promise<number>
      sshExec: (sessionId: string, command: string, timeoutMs?: number) => Promise<string>
      getMonitorEnabled: () => Promise<boolean>
      setMonitorEnabled: (enabled: boolean) => Promise<void>
      getMonitorIntervalMs: () => Promise<number>
      setMonitorIntervalMs: (intervalMs: number) => Promise<void>
      monitorStart: (sessionId: string) => Promise<void>
      monitorStop: (sessionId: string) => Promise<void>

      sftpInit: (sessionId: string) => Promise<void>
      sftpReaddir: (sessionId: string, remotePath: string) => Promise<FileEntry[]>
      sftpRealpath: (sessionId: string, remotePath: string) => Promise<string>
      sftpExecHome: (sessionId: string) => Promise<string>
      sftpDownload: (
        sessionId: string,
        remotePath: string,
        fileName: string,
        transferId: string,
        options?: {
          conflict?: TransferConflictStrategy
          resume?: boolean
          localDir?: string
          localPath?: string
        },
      ) => void
      sftpUpload: (
        sessionId: string,
        localPath: string,
        remotePath: string,
        fileName: string,
        transferId: string,
        options?: {
          conflict?: TransferConflictStrategy
          resume?: boolean
          remoteFullPath?: string
        },
      ) => void
      sftpCancelTransfer: (transferId: string) => void
      sftpExtractArchive: (sessionId: string, remotePath: string) => Promise<{ ok: boolean; output?: string }>
      sftpExists: (sessionId: string, remotePath: string) => Promise<boolean>
      sftpStartDrag: (localPath: string) => void
      sftpReadFile: (sessionId: string, remotePath: string) => Promise<string>
      sftpWriteFile: (sessionId: string, remotePath: string, content: string) => Promise<void>
      sftpChmod: (sessionId: string, remotePath: string, mode: string, recursive?: boolean) => Promise<void>
      sftpChown: (sessionId: string, remotePath: string, owner: string, group?: string, recursive?: boolean) => Promise<void>
      sftpRename: (sessionId: string, oldPath: string, newPath: string) => Promise<void>
      sftpMkdir: (sessionId: string, remotePath: string) => Promise<void>
      sftpDelete: (sessionId: string, remotePath: string, isDirectory?: boolean) => Promise<void>
      sftpDownloadDirectory: (
        sessionId: string,
        remotePath: string,
        dirName: string,
        transferId: string,
        options?: { concurrency?: number; failPolicy?: 'continue' | 'stop' },
      ) => void
      sftpUploadDirectory: (
        sessionId: string,
        localPath: string,
        remoteParent: string,
        dirName: string,
        transferId: string,
        options?: {
          conflict?: TransferConflictStrategy
          concurrency?: number
          failPolicy?: 'continue' | 'stop'
        },
      ) => void
      sftpStat: (sessionId: string, remotePath: string) => Promise<{
        mode: string
        size: number
        uid: number
        gid: number
        atime: number
        mtime: number
        owner: string
        group: string
      }>

      getPathForFile: (file: File) => string

      readPrivateKeyFile: () => Promise<string | null>

      shellOpenPath: (filePath: string) => Promise<string>
      shellShowItemInFolder: (filePath: string) => void
      openExternal: (url: string) => Promise<boolean>

      clipboardReadText: () => Promise<string>
      clipboardWriteText: (text: string) => Promise<void>

      onSshData: (sessionId: string, callback: (data: string) => void) => () => void
      onSshClosed: (sessionId: string, callback: () => void) => () => void
      onSshReconnected: (sessionId: string, callback: () => void) => () => void
      onSshError: (sessionId: string, callback: (error: string) => void) => () => void
      onSshLatency: (sessionId: string, callback: (latencyMs: number) => void) => () => void

      onMonitorData: (sessionId: string, callback: (data: MonitorData) => void) => () => void

      /**
       * Probe remote Docker Engine via existing SSH session.
       * Only sessionId is accepted; status is the stable contract for UI branching.
       */
      dockerProbe: (sessionId: string) => Promise<DockerAvailability>
      /** List containers for session (full normalized list; filter client-side). */
      dockerListContainers: (sessionId: string) => Promise<DockerContainerSummary[]>
      /** Inspect one container (sessionId + containerId only; no API path). */
      dockerInspectContainer: (
        sessionId: string,
        containerId: string,
      ) => Promise<DockerContainerInspectResult>
      /**
       * Container lifecycle action (start | stop | restart only).
       * Returns structured ok/code — branch on code, never English message text.
       */
      dockerContainerAction: (
        sessionId: string,
        containerId: string,
        action: DockerContainerAction,
      ) => Promise<DockerContainerActionIpcResponse>
      /** Start container logs (tail + follow + requestId; no path/method/query). */
      dockerStartContainerLogs: (
        sessionId: string,
        containerId: string,
        options: { tail: DockerLogTail; follow: boolean; requestId: string },
      ) => Promise<DockerStartContainerLogsResult>
      dockerStopContainerLogs: (streamId: string) => Promise<{ ok: true }>
      onDockerContainerLogData: (
        callback: (payload: DockerContainerLogDataEvent) => void,
      ) => () => void
      onDockerContainerLogState: (
        callback: (payload: DockerContainerLogStateEvent) => void,
      ) => () => void
      /** Start interactive container exec (shell enum + size + requestId only). */
      dockerStartContainerExec: (
        sessionId: string,
        containerId: string,
        options: {
          shell: DockerExecShell
          requestId: string
          cols: number
          rows: number
        },
      ) => Promise<DockerStartContainerExecResult>
      dockerWriteContainerExec: (
        terminalId: string,
        data: string,
      ) => Promise<{ ok: boolean }>
      dockerResizeContainerExec: (
        terminalId: string,
        cols: number,
        rows: number,
      ) => Promise<{ ok: boolean }>
      dockerStopContainerExec: (terminalId: string) => Promise<{ ok: true }>
      onDockerContainerExecData: (
        callback: (payload: DockerExecDataEvent) => void,
      ) => () => void
      onDockerContainerExecState: (
        callback: (payload: DockerExecStateEvent) => void,
      ) => () => void

      onTransferStart: (
        callback: (
          sessionId: string,
          transferId: string,
          fileName: string,
          localPath: string,
          direction: 'download' | 'upload',
          remotePath?: string,
        ) => void,
      ) => () => void
      onTransferProgress: (
        callback: (
          sessionId: string,
          transferId: string,
          transferred: number,
          total: number,
          stats?: { completedFiles: number; failedFiles: number; totalFiles: number },
        ) => void,
      ) => () => void
      onTransferComplete: (
        callback: (
          sessionId: string,
          transferId: string,
          localPath: string,
          status?: 'skipped' | 'partial',
          stats?: { completedFiles: number; failedFiles: number; totalFiles: number },
        ) => void,
      ) => () => void
      onTransferError: (callback: (sessionId: string, transferId: string, error: string) => void) => () => void

      updateTitleBar: (theme: string, colors?: { color: string; symbolColor: string }) => void

      // Database (MySQL / PostgreSQL; optional SSH tunnel)
      dbListConnections: () => Promise<DbConnection[]>
      dbListGroups: () => Promise<string[]>
      dbGetConnectionPassword: (id: string) => Promise<string>
      dbSaveConnection: (conn: Partial<DbConnection> & {
        name: string
        host: string
        username: string
        password: string
        engine?: DbEngine
      }) => Promise<DbConnection>
      dbDeleteConnection: (id: string) => Promise<boolean>
      dbReorderConnections: (orderedIds: string[]) => Promise<DbConnection[]>
      dbExportConnections: (includePassword?: boolean) => Promise<boolean>
      dbImportConnections: () => Promise<{ imported: number; skipped: number; total: number } | null>
      dbListSshConnections: () => Promise<Array<{
        id: string
        name: string
        host: string
        port: number
        username: string
      }>>
      dbTestConnection: (params: {
        engine?: DbEngine
        host: string
        port?: number
        username: string
        password: string
        database?: string
        ssl?: boolean
        sslOptions?: DbSslOptions
        extraOptions?: Record<string, string>
        sshConnectionId?: string
        connectionId?: string
      }) => Promise<{ ok: boolean; latencyMs?: number; serverVersion?: string; error?: string; viaTunnel?: boolean }>
      dbConnect: (connectionId: string) => Promise<DbSessionInfo>
      dbDisconnect: (sessionId: string) => Promise<void>
      dbDisconnectByConnectionId: (connectionId: string) => Promise<void>
      dbTakePendingSessionLost: (
        connectionId: string,
        sessionId?: string,
      ) => Promise<{
        sessionId: string
        connectionId: string
        reason: string
        detail?: string
      } | null>
      onDbSessionLost: (
        callback: (data: {
          sessionId: string
          connectionId: string
          reason: string
          detail?: string
          message?: string
        }) => void,
      ) => () => void
      dbGetSession: (sessionId: string) => Promise<DbSessionInfo | null>
      dbListDatabases: (sessionId: string) => Promise<string[]>
      dbListTables: (sessionId: string, database?: string) => Promise<string[]>
      dbListTableInfos: (sessionId: string, database?: string) => Promise<DbTableInfo[]>
      dbGetTableColumns: (sessionId: string, database: string, table: string) => Promise<DbColumnInfo[]>
      dbGetTableIndexes: (sessionId: string, database: string, table: string) => Promise<DbIndexInfo[]>
      dbGetCreateTable: (sessionId: string, database: string, table: string) => Promise<string>
      dbBrowseTable: (
        sessionId: string,
        database: string,
        table: string,
        page?: number,
        pageSize?: number,
        options?: DbBrowseOptions,
      ) => Promise<DbTableBrowseResult>
      dbUseDatabase: (sessionId: string, database: string) => Promise<void>
      dbCreateDatabase: (
        sessionId: string,
        name: string,
        options?: { charset?: string; collate?: string; encoding?: string; template?: string },
      ) => Promise<void>
      dbQuery: (
        sessionId: string,
        sql: string,
        options?: {
          maxRows?: number
          timeoutMs?: number
          queryId?: string
          database?: string
          clientKey?: string
          readOnly?: boolean
        },
      ) => Promise<DbQueryResult>
      dbCancelQuery: (sessionId: string, queryId: string) => Promise<DbCancelResult>
      dbSelectSqlScript: () => Promise<{ token: string; name: string; size: number } | null>
      dbRunSqlScript: (
        sessionId: string,
        token: string,
        database?: string,
      ) => Promise<{ jobId: string }>
      dbCancelSqlScript: (jobId: string) => Promise<boolean>
      onDbScriptProgress: (callback: (data: DbScriptProgress) => void) => () => void
      dbExplain: (sessionId: string, sql: string, database?: string) => Promise<DbQueryResult>
      dbBeginTransaction: (
        sessionId: string,
        clientKey: string,
        database?: string,
      ) => Promise<DbTransactionState>
      dbCommitTransaction: (sessionId: string, clientKey: string) => Promise<DbTransactionState>
      dbRollbackTransaction: (sessionId: string, clientKey: string) => Promise<DbTransactionState>
      dbGetTransactionState: (sessionId: string, clientKey: string) => Promise<DbTransactionState>
      dbReleaseClient: (sessionId: string, clientKey: string) => Promise<void>
      dbAssessSqlRisk: (sql: string) => Promise<DbSqlRiskAssessment>
      dbExportTable: (input: {
        sessionId: string
        database: string
        table: string
        format?: 'csv' | 'jsonl'
        options?: DbBrowseOptions
        maxRows?: number
        defaultFileName?: string
      }) => Promise<DbExportResult>
      dbCancelExport: (exportId: string) => Promise<boolean>
      onDbExportProgress: (callback: (data: DbExportProgress) => void) => () => void
      dbListQueryHistory: (connectionId?: string) => Promise<DbQueryHistoryItem[]>
      dbPushQueryHistory: (input: {
        sql: string
        database?: string
        connectionId?: string
        status?: DbQueryHistoryStatus
        durationMs?: number
        rowCount?: number
        affectedRows?: number
        errorSummary?: string
        slow?: boolean
        runScope?: 'selection' | 'statement' | 'all' | 'explain'
        truncated?: boolean
      }) => Promise<DbQueryHistoryItem[]>
      dbClearQueryHistory: (connectionId?: string) => Promise<DbQueryHistoryItem[]>
      dbMergeQueryHistoryLegacy: (items: unknown[]) => Promise<DbQueryHistoryItem[]>

      // Auto-updater
      checkForUpdates: () => Promise<{ ok: boolean; info?: any; error?: string }>
      downloadUpdate: () => Promise<{ ok: boolean; error?: string }>
      quitAndInstall: () => Promise<void>
      skipUpdateVersion: (version: string) => Promise<void>
      getAutoUpdateEnabled: () => Promise<boolean>
      setAutoUpdateEnabled: (enabled: boolean) => Promise<void>
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
    }
  }
}

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
  search?: string
  searchColumns?: string[]
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
  database?: string
  ssl?: boolean
  sslOptions?: DbSslOptions
  /** Advanced driver options (whitelist-mapped at connect) */
  extraOptions?: Record<string, string>
  group?: string
  sshConnectionId?: string
  order?: number
  createdAt: number
  updatedAt: number
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
  sshConnectionName?: string
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
  runScope?: 'selection' | 'statement' | 'all' | 'explain'
  truncated?: boolean
}

export type DbTransactionState = {
  clientKey: string
  inTransaction: boolean
  autocommit: boolean
}

export type DbSqlRiskAssessment = {
  level: 'none' | 'high' | 'uncertain'
  kinds: string[]
  reasons: string[]
  uncertain: boolean
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

export interface LocalForward {
  localPort: number
  remoteHost: string
  remotePort: number
}

export interface Connection {
  id: string
  name: string
  host: string
  port: number
  username: string
  password: string
  privateKey?: string
  group?: string
  order?: number
  note?: string
  colorTag?: string
  keepaliveInterval?: number
  x11Forwarding?: boolean
  x11Host?: string
  x11Display?: number
  jumpHost?: string
  jumpPort?: number
  jumpUsername?: string
  jumpPassword?: string
  jumpPrivateKey?: string
  useAgent?: boolean
  localForwards?: LocalForward[]
  createdAt: number
  updatedAt: number
}

export type SnippetSendMode = 'run' | 'fill'

export interface ShellCommandHistoryItem {
  command: string
  at: number
}

export interface CommandSnippet {
  id: string
  name: string
  command: string
  group?: string
  /** Pin to top of list / quick bar */
  pinned?: boolean
  /** Manual order within pinned/unpinned groups (lower first) */
  sortOrder?: number
  /** run = write + Enter; fill = write without Enter */
  sendMode?: SnippetSendMode
  /** Optional global hotkey, e.g. "Ctrl+Alt+1" */
  hotkey?: string
  useCount?: number
  lastUsedAt?: number
  createdAt: number
  updatedAt: number
}

export interface AppBootstrapData {
  encryptionAvailable: boolean
  connections: Connection[]
  groups: Group[]
  recentConnections: Connection[]
  latencyEnabled: boolean
  latencyIntervalMs: number
  monitorEnabled: boolean
  monitorIntervalMs: number
}

export interface Group {
  id: string
  name: string
  order: number
  isDefault: boolean
}

export interface SavedCredential {
  id: string
  name: string
  username: string
  password: string
  createdAt: number
  updatedAt: number
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
  modifyTime: number
  permissions: string
}

export type TransferConflictStrategy = 'overwrite' | 'skip' | 'rename'

export interface TransferItem {
  id: string
  sessionId: string
  fileName: string
  localPath: string
  remotePath?: string
  transferred: number
  total: number
  status: 'downloading' | 'uploading' | 'completed' | 'error' | 'skipped' | 'partial'
  direction: 'download' | 'upload'
  error?: string
  /** Directory transfer file counters (when available) */
  completedFiles?: number
  failedFiles?: number
  totalFiles?: number
}

export interface AiProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
}

export interface AiSettings {
  providers: AiProvider[]
  activeProviderId: string | null
  activeModel: string
  systemPrompt: string
  /** 0–2, default 0.7 (matches README) */
  temperature?: number
}

export interface AiResolvedConfig {
  baseUrl: string
  model: string
  apiKey: string
  systemPrompt: string
  temperature: number
}

export interface AiChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AiUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  reasoningTokens?: number
}

export interface AiChatResult {
  content: string
  reasoningContent?: string
  usage?: AiUsage
}

export interface AiHistoryRecord {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoningContent?: string
  usage?: AiUsage
  error?: boolean
  createdAt: number
}

export interface AiConversationThread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: AiHistoryRecord[]
}

export interface AiSessionStore {
  version: 1
  activeThreadId: string
  threads: AiConversationThread[]
}

export interface AiThreadSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  active: boolean
}

export type AiChatStreamPayload =
  | { type: 'content'; value: string }
  | { type: 'reasoning'; value: string }
  | { type: 'usage'; value: AiUsage }
  | { type: 'done' }

export interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  progress?: number
  message?: string
}

export interface MonitorData {
  hostname: string
  kernel: string
  arch: string
  uptime: string
  cpu: {
    usage: number
    cores: number[]
    loadAvg: [number, number, number]
  }
  memory: {
    total: number
    used: number
    free: number
    buffCache: number
    available: number
    swapTotal: number
    swapUsed: number
  }
  disk: {
    filesystem: string
    total: number
    used: number
    available: number
    mountPoint: string
  }[]
  processes: {
    pid: number
    user: string
    cpu: number
    mem: number
    command: string
  }[]
  timestamp: number
}

/** Stable Docker availability contract (renderer branches on status only). */
export type DockerAvailability =
  | { status: 'available'; engineVersion: string; apiVersion: string }
  | {
      status: 'api-version-incompatible'
      engineVersion: string
      apiVersion: string
      requiredApiVersion: string
    }
  | { status: 'not-installed' }
  | { status: 'daemon-unavailable'; message: string }
  | { status: 'permission-denied'; message: string }
  | { status: 'transport-unsupported'; message: string }
  | { status: 'socket-forward-failed'; message: string }
  | { status: 'ssh-disconnected' }

/** Whitelist container actions only (not free-form strings). */
export type DockerContainerAction = 'start' | 'stop' | 'restart'

export type DockerContainerActionResult = {
  action: DockerContainerAction
  containerId: string
  outcome: 'completed' | 'already-in-state'
}

/** Stable transport/action error codes from main (subset used by action IPC). */
export type DockerTransportErrorCode =
  | 'ssh-disconnected'
  | 'transport-unsupported'
  | 'socket-forward-failed'
  | 'socket-not-found'
  | 'permission-denied'
  | 'daemon-unavailable'
  | 'proxy-closed'
  | 'request-failed'
  | 'request-timeout'
  | 'generation-stale'
  | 'container-not-found'
  | 'action-conflict'
  | 'container-not-running'
  | 'attach-protocol-error'
  | 'output-overflow'

export type DockerContainerActionIpcResponse =
  | { ok: true; result: DockerContainerActionResult }
  | { ok: false; code: DockerTransportErrorCode }

export type DockerContainerListFilters = {
  state?: 'all' | 'running' | 'stopped'
  search?: string
}

export type DockerContainerPort = {
  ip: string
  privatePort: number
  publicPort: number | null
  type: string
}

export type DockerContainerMount = {
  type: string
  name: string
  source: string
  destination: string
  mode: string
  rw: boolean
}

export type DockerContainerSummary = {
  id: string
  names: string[]
  displayName: string
  image: string
  imageId: string
  command: string
  created: number
  state: string
  status: string
  ports: DockerContainerPort[]
  mounts: DockerContainerMount[]
}

export type DockerContainerOverview = {
  id: string
  name: string
  displayName: string
  image: string
  imageId: string
  created: string
  path: string
  args: string[]
  state: {
    status: string
    running: boolean
    paused: boolean
    restarting: boolean
    startedAt: string
    finishedAt: string
    exitCode: number | null
    error: string
  }
  ports: DockerContainerPort[]
  mounts: DockerContainerMount[]
  networks: string[]
  restartPolicy: string
}

export type DockerContainerInspectResult = {
  overview: DockerContainerOverview
  inspectJson: string
}

export type DockerLogTail = 100 | 200 | 500 | 1000

export type DockerLogStreamKind = 'stdout' | 'stderr'

export type DockerLogEntry = {
  sequence: number
  stream: DockerLogStreamKind
  timestamp: string | null
  text: string
}

export type DockerLogStreamState =
  | 'connecting'
  | 'streaming'
  | 'ended'
  | 'disconnected'
  | 'error'

export type DockerStartContainerLogsResult =
  | { ok: true; streamId: string; requestId: string }
  | { ok: false; code: DockerTransportErrorCode; requestId?: string }

export type DockerContainerLogDataEvent = {
  streamId: string
  requestId: string
  entries: DockerLogEntry[]
  droppedFromMain: number
}

export type DockerContainerLogStateEvent = {
  streamId: string
  requestId: string
  state: DockerLogStreamState
  code?: DockerTransportErrorCode
}

export type DockerExecShell = 'bash' | 'sh'

export type DockerExecState =
  | 'connecting'
  | 'attached'
  | 'ended'
  | 'disconnected'
  | 'error'

export type DockerStartContainerExecResult =
  | { ok: true; terminalId: string; requestId: string }
  | { ok: false; code: DockerTransportErrorCode; requestId?: string }

export type DockerExecDataEvent = {
  requestId: string
  terminalId: string
  sequence: number
  data: ArrayBuffer
}

export type DockerExecStateEvent = {
  requestId: string
  terminalId: string | null
  state: DockerExecState
  code?: DockerTransportErrorCode
  exitCode?: number | null
}
