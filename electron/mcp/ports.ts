import type { SessionExecResult } from '../ssh/sessionExec'
import type { FileEntry, McpShellChannel, SessionSnapshot } from '../ssh/types'
import type { ApprovalMode, CommandClass, SshMcpPublicConnection } from '../../shared/mcp/types'
import type { TransferConflictStrategy } from '../../shared/types/sftp'

export type McpTransferContext = { ownerId: number; conversationId: string; threadId: string }
export type McpTransferOptions = { signal?: AbortSignal; transferContext?: McpTransferContext }
export type McpDownloadSettings = { directory: string; conflict: TransferConflictStrategy }
export type McpLocalEnvironment = { platform: NodeJS.Platform; defaultDownloadDirectory?: string }
export type McpDownloadResult = { localPath: string; skipped?: boolean }

/** File-transfer backend contract. Only bind.ts adapts the concrete SSH manager. */
export interface McpFileTransferPort {
  getConnectionName(sessionId: string): string | undefined
  sftpDownload(
    sessionId: string, remotePath: string, localPath: string, transferId: string,
    onProgress: (transferred: number, total: number) => void,
    options?: { keepPartial?: boolean; isCancelled?: () => boolean },
  ): Promise<void>
  sftpUpload(
    sessionId: string, localPath: string, remotePath: string, transferId: string,
    onProgress: (transferred: number, total: number) => void,
    options?: { keepPartial?: boolean; isCancelled?: () => boolean },
  ): Promise<void>
  cancelTransfer(transferId: string): boolean
}

export type SshMcpSessionPort = {
  listSessionSnapshots(): SessionSnapshot[]
  getSessionSnapshot(sessionId: string): SessionSnapshot | undefined
  getSessionGeneration(sessionId: string): number
  executeSessionExec(
    sessionId: string,
    command: string,
    generation: number,
    timeoutMs: number,
    opts?: { stdin?: string },
  ): Promise<SessionExecResult>
  beginSessionExec(
    sessionId: string,
    command: string,
    generation: number,
    timeoutMs: number,
    opts?: { stdin?: string },
  ): Promise<{ promise: Promise<SessionExecResult>; cancel: () => void }>
  initSftp(sessionId: string): Promise<void>
  sftpReaddir(sessionId: string, remotePath: string): Promise<FileEntry[]>
  sftpReadFile(sessionId: string, remotePath: string, maxBytes: number): Promise<string>
  sftpReadFileRange(
    sessionId: string,
    remotePath: string,
    offset: number,
    length: number,
  ): Promise<{ buffer: Buffer; size: number; eof: boolean }>
  sftpWriteFile(sessionId: string, remotePath: string, content: string, maxBytes: number): Promise<void>
  sftpWriteBuffer(sessionId: string, remotePath: string, buffer: Buffer): Promise<void>
  sftpDownload(sessionId: string, remotePath: string, localPath: string | undefined, options?: McpTransferOptions): Promise<void | McpDownloadResult>
  sftpUpload(sessionId: string, localPath: string, remotePath: string, options?: McpTransferOptions): Promise<void>
  sftpStat(sessionId: string, remotePath: string): Promise<{
    mode: string
    size: number
    uid: number
    gid: number
    atime: number
    mtime: number
  }>
  connectSaved(connectionId: string): Promise<{ sessionId: string; reused: boolean }>
  disconnectSession(sessionId: string): void
  openShellChannel(
    sessionId: string,
    generation: number,
    opts: { term?: string; cols: number; rows: number },
  ): Promise<McpShellChannel>
  onSessionTeardown?(cb: (sessionId: string) => void): () => void
}

export type SshMcpSavedConnection = {
  id: string
  name: string
  host: string
  port: number
  username: string
  group?: string
  created: boolean
}

export type SshMcpSaveConnectionDraft = {
  name: string
  host: string
  port: number
  username: string
  password: string
  privateKey?: string
  useAgent?: boolean
  group?: string
  note?: string
}

export type SshMcpConnectionPort = {
  listPublicConnections(): Array<Omit<SshMcpPublicConnection, 'hasOpenSession'>>
  listGroups(): Array<{ id: string; name: string }>
  saveConnection(draft: SshMcpSaveConnectionDraft): Promise<SshMcpSavedConnection>
}

export type SshMcpMetricsPort = {
  getCached(sessionId: string): unknown | undefined
}

export type SshMcpApprovalRequest = {
  tool: string
  sessionId?: string
  command?: string
  class: CommandClass
  reason: string
}

export type SshMcpApprovalFn = (req: SshMcpApprovalRequest) => Promise<boolean>

export type SshMcpRuntimeOptions = {
  ssh: SshMcpSessionPort
  connections: SshMcpConnectionPort
  metrics?: SshMcpMetricsPort
  approvalMode?: ApprovalMode
  /** Live setting; preferred over the constructor snapshot. */
  getApprovalMode?: () => ApprovalMode
  requestApproval?: SshMcpApprovalFn
  getDownloadSettings?: () => McpDownloadSettings
}
