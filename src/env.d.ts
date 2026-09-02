/// <reference types="vite/client" />

import type { LiteConnectApi } from './types/liteConnectApi'

export {}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare global {
  interface Window {
    LiteConnect: LiteConnectApi
  }
}

export type { LiteConnectApi } from './types/liteConnectApi'

export type {
  Connection,
  DynamicForward,
  Group,
  KeyboardInteractivePrompt,
  KnownHostEntry,
  LocalForward,
  RemoteForward,
  SavedCredential,
  SshConnectProfile,
} from '../shared/types/connection'

export type {
  DbBrowseOptions,
  DbCancelResult,
  DbCancelStatus,
  DbColumnFilter,
  DbColumnInfo,
  DbConnection,
  DbEngine,
  DbErrorCategory,
  DbExportProgress,
  DbExportResult,
  DbFilterOp,
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
  DbTotalMode,
  DbTransactionState,
} from '../shared/types/database'

export type {
  AppBackgroundState,
  AppBootstrapData,
  AppSettingsAll,
  AppSettingsAllPatch,
  WorkspaceTabsState,
} from '../shared/types/settings'

export type {
  CommandSnippet,
  ShellCommandHistoryItem,
  SnippetSendMode,
} from '../shared/types/snippets'

export type { FileEntry, TransferConflictStrategy, TransferItem } from '../shared/types/sftp'

export type {
  AiChatMessage,
  AiChatResult,
  AiChatSegment,
  AiChatStreamPayload,
  AiConversationThread,
  AiHistoryRecord,
  AiModel,
  AiProvider,
  AiResolvedConfig,
  AiSessionStore,
  AiSettings,
  AiThreadSummary,
  AiToolPermissionMode,
  AiToolRisk,
  AiToolRun,
  AiToolRunStatus,
  AiUsage,
} from '../shared/types/ai'

export type { MonitorData } from '../shared/types/monitor'
export type { UpdateStatus } from '../shared/types/app'

export type { McpHttpStatus, SshMcpToolCallResult, SshMcpToolDefinition } from '../shared/mcp/types'

export type {
  DockerAvailability,
  DockerContainerAction,
  DockerContainerActionIpcResponse,
  DockerContainerActionResult,
  DockerContainerInspectResult,
  DockerContainerListFilters,
  DockerContainerLogDataEvent,
  DockerContainerLogStateEvent,
  DockerContainerMount,
  DockerContainerOverview,
  DockerContainerPort,
  DockerContainerSummary,
  DockerExecDataEvent,
  DockerExecShell,
  DockerExecState,
  DockerExecStateEvent,
  DockerLogEntry,
  DockerLogStreamKind,
  DockerLogStreamState,
  DockerLogTail,
  DockerStartContainerExecResult,
  DockerStartContainerLogsResult,
  DockerTransportErrorCode,
} from '../shared/types/docker'
