export const SSH_MCP_TOOL_NAMES = [
  'list_connections',
  'list_sessions',
  'list_groups',
  'connect',
  'save_connection',
  'disconnect',
  'exec',
  'list_jobs',
  'get_job',
  'cancel_job',
  'read_file',
  'grep',
  'glob',
  'write_file',
  'edit_file',
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

/**
 * Why a class is a fail-closed *guess* rather than an observed risk.
 *
 * The distinction matters because it decides what we are allowed to tell the
 * user. `rm -rf /tmp/a` declared as `read` is a caught under-declaration and the
 * card may say so. `nginx -v` declared as `read` is just a program we have no
 * entry for, and telling the user the model lied about it would be false —
 * after which no warning from this card is worth reading.
 */
export type CommandUncertainty =
  /** No entry for this program, so its behaviour is unknown. */
  | 'unknown-program'
  /** An interpreter was handed code inline (`python3 -c '…'`). */
  | 'inline-script'
  /** The code being run lives in a script file or on stdin, unreadable here. */
  | 'uninspectable'
  /** The command name is computed at runtime (`$X -rf /`). */
  | 'runtime-name'
  /** The command did not parse cleanly, so we cannot vouch for what we saw. */
  | 'unparsed'

export type CommandClassification = {
  class: CommandClass
  binary: string
  reason: string
  /** Set when `class` is fail-closed, not observed. Absent means "we know". */
  uncertainty?: CommandUncertainty
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
  | 'CONNECTION_NAME_TAKEN'
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

/** Renderer IPC alias for a tool call result. */
export type SshMcpToolCallResult = SshMcpToolResult

export type McpHttpStatus = {
  enabled: boolean
  listening: boolean
  host: '127.0.0.1'
  port: number
  url: string
  token: string
  lastError: string | null
  snippets: { generic: string }
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
