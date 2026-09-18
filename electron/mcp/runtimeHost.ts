import type { ApprovalMode, CommandClass, SshMcpErrorPayload, SshMcpToolErrorCode, SshMcpToolResult } from '../../shared/mcp/types'
import type { McpJobStore } from './execJobs'
import type { PtySessionStore } from './ptySessions'
import type { SshMcpApprovalFn, SshMcpConnectionPort, SshMcpMetricsPort, SshMcpSessionPort } from './ports'

export type SessionRef = {
  sessionId: string
  generation: number
  connectionId: string
  connectionName: string
}

export type McpRuntimeHost = {
  ssh: SshMcpSessionPort
  connections: SshMcpConnectionPort
  metrics?: SshMcpMetricsPort
  jobs: McpJobStore
  ptys: PtySessionStore
  lastToolAt: Map<string, number>
  approvalMode: ApprovalMode
  requestApproval?: SshMcpApprovalFn

  ok<T>(structuredContent: T): SshMcpToolResult<T>
  error(code: SshMcpToolErrorCode, message: string, cls?: SshMcpErrorPayload['class']): SshMcpToolResult<SshMcpErrorPayload>
  touch(sessionId: string): void
  requireSession(sessionId: unknown): { sessionId: string; generation: number }
  assertGeneration(sessionId: string, generation: number): void
  withSftp<T>(sessionId: string, generation: number, fn: () => Promise<T>): Promise<T>
  ensureCommandAllowed(
    classification: { class: CommandClass; reason: string },
    sessionId: string,
    command: string,
    approvalMode?: ApprovalMode,
  ): Promise<SshMcpToolResult | null>
  runForegroundExec(
    target: SessionRef,
    command: string,
    classification: { class: CommandClass },
    timeoutMs: number,
    stdin?: string,
  ): Promise<unknown>
}

export function resultOk<T>(structuredContent: T): SshMcpToolResult<T> {
  return {
    isError: false,
    content: JSON.stringify(structuredContent, null, 2),
    structuredContent,
  }
}

export function resultError(
  code: SshMcpToolErrorCode,
  message: string,
  cls?: SshMcpErrorPayload['class'],
): SshMcpToolResult<SshMcpErrorPayload> {
  const structuredContent: SshMcpErrorPayload = cls ? { code, message, class: cls } : { code, message }
  return {
    isError: true,
    content: `${code}: ${message}`,
    structuredContent,
  }
}
