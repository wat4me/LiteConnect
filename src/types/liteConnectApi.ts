import type {
  AiChatMessage,
  AiChatResult,
  AiChatStreamPayload,
  AiHistoryRecord,
  AiSessionStore,
  AiSettings,
} from '@shared/types/ai'
import type { UpdateStatus } from '@shared/types/app'
import type {
  Connection,
  Group,
  KeyboardInteractivePrompt,
  KnownHostEntry,
  SavedCredential,
} from '@shared/types/connection'
import type {
  DbBrowseOptions,
  DbCancelResult,
  DbColumnInfo,
  DbConnection,
  DbEngine,
  DbExportProgress,
  DbExportResult,
  DbIndexInfo,
  DbQueryHistoryItem,
  DbQueryHistoryStatus,
  DbQueryResult,
  DbScriptProgress,
  DbSessionInfo,
  DbSqlRiskAssessment,
  DbSslOptions,
  DbTableBrowseResult,
  DbTableInfo,
  DbTransactionState,
} from '@shared/types/database'
import type {
  DockerAvailability,
  DockerContainerAction,
  DockerContainerActionIpcResponse,
  DockerContainerInspectResult,
  DockerContainerLogDataEvent,
  DockerContainerLogStateEvent,
  DockerContainerSummary,
  DockerExecDataEvent,
  DockerExecShell,
  DockerExecStateEvent,
  DockerLogTail,
  DockerStartContainerExecResult,
  DockerStartContainerLogsResult,
} from '@shared/types/docker'
import type { MonitorData } from '@shared/types/monitor'
import type { McpHttpStatus, SshMcpToolCallResult, SshMcpToolDefinition } from '@shared/mcp/types'
import type { AppBootstrapData, AppSettingsAll, AppSettingsAllPatch, WorkspaceTabsState } from '@shared/types/settings'
import type { FileEntry, TransferConflictStrategy } from '@shared/types/sftp'
import type { CommandSnippet, ShellCommandHistoryItem } from '@shared/types/snippets'

export interface LiteConnectApi {
  getAppBootstrap: () => Promise<AppBootstrapData>
  getConnections: () => Promise<Connection[]>
  saveConnection: (conn: Partial<Connection> & { name: string; host: string; username: string; password: string }) => Promise<Connection>
  deleteConnection: (id: string) => Promise<boolean>
  updateConnectionGroup: (id: string, groupId: string | undefined) => Promise<Connection>
  setConnectionPinned: (id: string, pinned: boolean) => Promise<Connection>
  openConnectionWindow: (connectionId: string) => Promise<{ reused: boolean; connectionId: string }>
  reorderConnections: (orderedIds: string[]) => Promise<void>
  isEncryptionAvailable: () => Promise<boolean>
  getConnectionPassword: (id: string) => Promise<string>
  getConnectionSecrets: (id: string) => Promise<{
    password: string
    privateKey: string
    jumpPassword: string
    jumpPrivateKey: string
  }>
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
  getDefaultDownloadPath: () => Promise<string>
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
  testX11Server: (opts?: {
    executablePath?: string
    host?: string
    display?: number
  }) => Promise<{
    ready: boolean
    started: boolean
    host: string
    port: number
    display: number
    message?: string
    executablePath?: string
    portOccupiedNotX11?: boolean
    portOwner?: {
      pid: number
      name: string
      kind: 'xserver_residual' | 'other' | 'unknown'
    }
  }>
  killResidualX11Process: (opts?: {
    pid?: number
    port?: number
  }) => Promise<{ ok: boolean; process: string; pid: number }>
  getBundledX11InstallerStatus: () => Promise<{ available: boolean }>
  installBundledX11Server: () => Promise<{ started: boolean; cancelled?: boolean }>
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
  aiChatStream: (
    requestId: string,
    messages: AiChatMessage[],
    opts?: { sessionId?: string },
  ) => Promise<AiChatResult>
  aiAbortChatStream: (requestId: string) => Promise<boolean>
  aiResolveToolApproval: (requestId: string, callId: string, approved: boolean) => Promise<boolean>
  aiGenerateConversationTitle: (payload: {
    userText: string
    assistantText?: string
    sessionId?: string
    threadId?: string
  }) => Promise<{ title: string }>
  getAiSessionHistory: (sessionId: string) => Promise<AiHistoryRecord[]>
  getAiSessionStore: (sessionId: string) => Promise<AiSessionStore>
  setAiSessionStore: (sessionId: string, store: AiSessionStore) => Promise<void>
  aiSetThreadTitle: (
    sessionId: string,
    threadId: string,
    title: string,
  ) => Promise<{ ok: boolean }>
  aiCreateConversation: (
    sessionId: string,
    payload: {
      threadId?: string
      messages?: AiHistoryRecord[]
      title?: string
      titleGenerated?: boolean
    },
  ) => Promise<AiSessionStore>
  appendAiSessionHistory: (sessionId: string, record: AiHistoryRecord) => Promise<void>
  clearAiSessionHistory: (sessionId: string) => Promise<void>
  onAiChatStream: (requestId: string, callback: (payload: AiChatStreamPayload) => void) => () => void

  getLatencyEnabled: () => Promise<boolean>
  setLatencyEnabled: (enabled: boolean) => Promise<void>
  getConnectionUsageStatsEnabled: () => Promise<boolean>
  setConnectionUsageStatsEnabled: (enabled: boolean) => Promise<void>
  getFancyCursorEnabled: () => Promise<boolean>
  setFancyCursorEnabled: (enabled: boolean) => Promise<void>
  getFancyCursorStyle: () => Promise<string>
  setFancyCursorStyle: (style: string) => Promise<void>
  getAllSettings: () => Promise<AppSettingsAll>
  setManySettings: (patch: AppSettingsAllPatch) => Promise<AppSettingsAll>
  getAppBackground: () => Promise<{
    fileName: string
    fit: 'cover' | 'contain' | 'fill'
    overlay: number
    imageUrl: string
  }>
  selectAppBackgroundImage: () => Promise<{
    token: string
    fileName: string
    imageUrl: string
  } | null>
  setAppBackgroundImage: (payload: {
    token?: string
    fit?: 'cover' | 'contain' | 'fill'
    overlay?: number
    clear?: boolean
  }) => Promise<{ fileName: string; fit: 'cover' | 'contain' | 'fill'; overlay: number; imageUrl: string }>
  getLatencyIntervalMs: () => Promise<number>
  setLatencyIntervalMs: (intervalMs: number) => Promise<void>

  exportConnections: (includeSecrets?: boolean) => Promise<boolean>
  importConnections: () => Promise<{ imported: number; skipped: number; total: number } | null>
  importSshConfig: () => Promise<{
    imported: number
    skipped: number
    total: number
    knownHostsImported: number
    knownHostsHashedSkipped: number
  } | null>

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
    hostKeyHost?: string
    hostKeyPort?: number
    hostKeyRole?: 'target' | 'jump'
    existingFingerprint?: string
    newFingerprint?: string
    hostKeyUnknown?: boolean
    hostKeyBase64?: string
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
    hostKeyHost?: string
    hostKeyPort?: number
    hostKeyRole?: 'target' | 'jump'
    existingFingerprint?: string
    newFingerprint?: string
    hostKeyUnknown?: boolean
    hostKeyBase64?: string
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
    hostKeyHost?: string
    hostKeyPort?: number
    hostKeyRole?: 'target' | 'jump'
    existingFingerprint?: string
    newFingerprint?: string
    hostKeyUnknown?: boolean
    hostKeyBase64?: string
  }>

  sshRemoveHostKey: (host: string, port: number) => Promise<void>
  sshListHostKeys: () => Promise<KnownHostEntry[]>
  sshUpdateHostKey: (host: string, port: number, keyBuffer: Buffer) => Promise<string>
  sshTrustHostKey: (host: string, port: number, keyBase64: string) => Promise<string>
  sshGetHostKeyFingerprint: (host: string, port: number) => Promise<string | null>
  sshConfirmHostKey: (connectionId: string) => Promise<string>
  sshReplyKeyboardInteractive: (requestId: string, answers: string[] | null) => Promise<boolean>
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
  onSshKeyboardInteractive: (callback: (data: KeyboardInteractivePrompt) => void) => () => void
  getWorkspaceRestoreEnabled: () => Promise<boolean>
  setWorkspaceRestoreEnabled: (enabled: boolean) => Promise<void>
  getWorkspaceTabs: () => Promise<WorkspaceTabsState | null>
  setWorkspaceTabs: (state: WorkspaceTabsState | null) => Promise<void>

  sshStartLatencyMonitor: (sessionId: string) => Promise<void>
  sshStopLatencyMonitor: (sessionId: string) => Promise<void>
  sshMeasureLatency: (sessionId: string) => Promise<number>
  sshExec: (sessionId: string, command: string, timeoutMs?: number) => Promise<string>
  mcpListTools: () => Promise<SshMcpToolDefinition[]>
  mcpCallTool: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<SshMcpToolCallResult>
  mcpGetHttpStatus: () => Promise<McpHttpStatus>
  mcpSetHttpEnabled: (enabled: boolean) => Promise<McpHttpStatus>
  mcpSetHttpPort: (port: number) => Promise<McpHttpStatus>
  mcpRotateHttpToken: () => Promise<McpHttpStatus>
  mcpReportConnectResult: (
    requestId: string,
    result: { sessionId?: string; error?: string },
  ) => Promise<boolean>
  onMcpConnectRequest: (
    callback: (payload: { requestId: string; connectionId: string }) => void,
  ) => () => void
  onMcpCloseSession: (callback: (sessionId: string) => void) => () => void
  onMcpConnectionsChanged: (callback: () => void) => () => void
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

  dockerProbe: (sessionId: string) => Promise<DockerAvailability>
  dockerListContainers: (sessionId: string) => Promise<DockerContainerSummary[]>
  dockerInspectContainer: (
    sessionId: string,
    containerId: string,
  ) => Promise<DockerContainerInspectResult>
  dockerContainerAction: (
    sessionId: string,
    containerId: string,
    action: DockerContainerAction,
  ) => Promise<DockerContainerActionIpcResponse>
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

  checkForUpdates: () => Promise<{ ok: boolean; info?: any; error?: string }>
  downloadUpdate: () => Promise<{ ok: boolean; error?: string }>
  quitAndInstall: () => Promise<void>
  skipUpdateVersion: (version: string) => Promise<void>
  getAutoUpdateEnabled: () => Promise<boolean>
  setAutoUpdateEnabled: (enabled: boolean) => Promise<void>
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void

  getAppInfo: () => Promise<{ version: string; electron: string; platform: string }>
  openSessionLogDir: () => Promise<{ ok: boolean }>
}
