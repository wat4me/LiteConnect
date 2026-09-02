import type { SessionExecResult } from '../ssh/sessionExec'
import type { FileEntry, McpShellChannel, SessionSnapshot } from '../ssh/types'
import type { ApprovalMode, CommandClass, SshMcpPublicConnection } from '../../shared/mcp/types'

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
  sftpDownload(sessionId: string, remotePath: string, localPath: string): Promise<void>
  sftpUpload(sessionId: string, localPath: string, remotePath: string): Promise<void>
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

export type SshMcpConnectionPort = {
  listPublicConnections(): Array<Omit<SshMcpPublicConnection, 'hasOpenSession'>>
  listGroups(): Array<{ id: string; name: string }>
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
  requestApproval?: SshMcpApprovalFn
}
