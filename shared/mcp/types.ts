export const SSH_MCP_TOOL_NAMES = [
  'list_connections',
  'list_sessions',
  'list_groups',
  'connect',
  'disconnect',
  'exec',
  'list_jobs',
  'get_job',
  'cancel_job',
  'read_file',
  'write_file',
  'download_file',
  'upload_file',
  'list_dir',
  'stat_path',
  'tail_file',
  'service_control',
  'pty_open',
  'pty_write',
  'pty_read',
  'pty_resize',
  'pty_close',
  'pty_list',
  'get_metrics',
] as const

export type SshMcpToolName = (typeof SSH_MCP_TOOL_NAMES)[number]

export function isSshMcpToolName(name: unknown): name is SshMcpToolName {
  return typeof name === 'string' && (SSH_MCP_TOOL_NAMES as readonly string[]).includes(name)
}

export type CommandClass = 'read-only' | 'safe' | 'destructive' | 'privileged' | 'forbidden'

export type ApprovalMode = 'auto' | 'ask-destructive' | 'deny-destructive'

export type CommandClassification = {
  class: CommandClass
  binary: string
  reason: string
}

export type SshMcpToolAnnotations = {
  readOnlyHint: boolean
  destructiveHint: boolean
  openWorldHint: boolean
  idempotentHint?: boolean
}

export type SshMcpToolDefinition = {
  name: SshMcpToolName
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: SshMcpToolAnnotations
}

export type SshMcpToolErrorCode =
  | 'UNKNOWN_TOOL'
  | 'INVALID_ARGUMENTS'
  | 'INVALID_SESSION_ID'
  | 'INVALID_COMMAND'
  | 'INVALID_PATH'
  | 'INVALID_UNIT'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_STALE'
  | 'FORBIDDEN'
  | 'PRIVILEGED_DENIED'
  | 'DESTRUCTIVE_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'MONITOR_NOT_STARTED'
  | 'EXEC_TIMEOUT'
  | 'EXEC_CANCELLED'
  | 'JOB_NOT_FOUND'
  | 'FILE_TOO_LARGE'
  | 'CONNECTION_NOT_FOUND'
  | 'CONNECTION_AMBIGUOUS'
  | 'CONNECT_FAILED'
  | 'CONNECT_TIMEOUT'
  | 'CONNECT_UNAVAILABLE'
  | 'GROUP_NOT_FOUND'
  | 'PTY_NOT_FOUND'
  | 'PTY_CLOSED'
  | 'PTY_LIMIT'
  | 'TOOL_FAILED'

export type SshMcpToolResult<T = unknown> = {
  isError: boolean
  content: string
  structuredContent: T
}

export type SshMcpErrorPayload = {
  code: SshMcpToolErrorCode
  message: string
  class?: CommandClass
}

export type SshMcpPublicConnection = {
  id: string
  name: string
  host: string
  port: number
  username: string
  group?: string
  hasOpenSession: boolean
}

export type SshMcpSessionSnapshot = {
  sessionId: string
  connectionId: string
  connectionName: string
  host?: string
  port?: number
  username?: string
  group?: string
  generation: number
  hasSftp: boolean
  healthy: boolean
  lastToolAt: number | null
  idleMs: number
}

export type SshMcpGroup = {
  id: string
  name: string
  connectionCount: number
  openSessionCount: number
  connectionIds: string[]
}

export type SshMcpJobStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'

export type SshMcpJobSummary = {
  jobId: string
  sessionId: string
  connectionId?: string
  connectionName?: string
  command: string
  status: SshMcpJobStatus
  startedAt: number
  finishedAt?: number
  exitCode?: number | null
}

export type SshMcpJobResult = SshMcpJobSummary & {
  stdout?: string
  stderr?: string
  truncated?: boolean
  signal?: string
  error?: string
  class?: CommandClass
}

export type SshMcpExecResult = {
  exitCode: number | null
  signal?: string
  stdout: string
  stderr: string
  truncated: boolean
  class: CommandClass
}

export type SshMcpDirEntry = {
  name: string
  path: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
  modifyTime: number
  permissions: string
}

export type SshMcpDirResult = {
  path: string
  entries: SshMcpDirEntry[]
  truncated: boolean
  total: number
}

export type SshMcpFileResult = {
  path: string
  content: string
  encoding: 'utf8' | 'base64'
  bytes: number
  size: number
  offset: number
  eof: boolean
  nextOffset: number
}

export type SshMcpStatResult = {
  path: string
  mode: string
  size: number
  uid: number
  gid: number
  atime: number
  mtime: number
}
