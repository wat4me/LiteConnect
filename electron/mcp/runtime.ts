import { decideCommandPolicy, policyErrorMessage } from '../../shared/mcp/policy'
import { SSH_MCP_TOOLS } from '../../shared/mcp/tools'
import type {
  ApprovalMode,
  CommandClass,
  SshMcpErrorPayload,
  SshMcpToolDefinition,
  SshMcpToolErrorCode,
  SshMcpToolResult,
} from '../../shared/mcp/types'
import { isSshMcpToolName } from '../../shared/mcp/types'
import { isValidUUID } from '../utils/validation'
import { McpJobStore } from './execJobs'
import { PtySessionStore } from './ptySessions'
import type { SshMcpRuntimeOptions, SshMcpSessionPort } from './ports'
import { mapThrown, toolError } from './errors'
import { resultError, resultOk, type McpRuntimeHost } from './runtimeHost'
import {
  connectSaved,
  disconnectSessions,
  getMetrics,
  listConnections,
  listGroups,
  listSessions,
  saveConnection,
} from './tools/sessions'
import { cancelJob, execCommand, getJob, runForegroundExec } from './tools/exec'
import {
  downloadFile,
  listDir,
  readFileTool,
  statPath,
  tailFile,
  uploadFile,
  writeFileTool,
} from './tools/sftp'
import { ptyClose, ptyOpen, ptyRead, ptyResize, ptyWrite } from './tools/pty'
import { serviceControl } from './tools/service'

export class SshMcpRuntime {
  private readonly ssh: SshMcpSessionPort
  private readonly connections: SshMcpRuntimeOptions['connections']
  private readonly metrics?: SshMcpRuntimeOptions['metrics']
  private readonly approvalMode: ApprovalMode
  private readonly requestApproval?: SshMcpRuntimeOptions['requestApproval']
  private readonly jobs = new McpJobStore()
  private readonly ptys: PtySessionStore
  private readonly lastToolAt = new Map<string, number>()
  private readonly unsubTeardown?: () => void

  constructor(opts: SshMcpRuntimeOptions) {
    this.ssh = opts.ssh
    this.connections = opts.connections
    this.metrics = opts.metrics
    this.approvalMode = opts.approvalMode ?? 'deny-destructive'
    this.requestApproval = opts.requestApproval
    this.ptys = new PtySessionStore((sessionId, generation, shellOpts) =>
      this.ssh.openShellChannel(sessionId, generation, shellOpts),
    )
    this.unsubTeardown = opts.ssh.onSessionTeardown?.((sessionId) => {
      this.jobs.cancelForSession(sessionId)
      this.ptys.closeForSession(sessionId)
    })
  }

  listTools(): SshMcpToolDefinition[] {
    return SSH_MCP_TOOLS
  }

  async call(
    name: unknown,
    args: unknown,
    opts?: { approvalMode?: ApprovalMode },
  ): Promise<SshMcpToolResult> {
    if (!isSshMcpToolName(name)) {
      return this.error('UNKNOWN_TOOL', `Unknown tool: ${String(name)}`)
    }
    const input = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
    const approvalMode = opts?.approvalMode ?? this.approvalMode
    const host = this.host()
    try {
      switch (name) {
        case 'list_connections':
          return this.ok(listConnections(host))
        case 'list_groups':
          return this.ok(listGroups(host))
        case 'list_sessions':
          return this.ok(listSessions(host))
        case 'connect':
          return await connectSaved(host, input)
        case 'save_connection':
          return await saveConnection(host, input)
        case 'disconnect':
          return disconnectSessions(host, input)
        case 'exec':
          return await execCommand(host, input, approvalMode)
        case 'list_jobs':
          return this.ok({ jobs: this.jobs.list().map((j) => this.jobs.summary(j)) })
        case 'get_job':
          return getJob(host, input)
        case 'cancel_job':
          return cancelJob(host, input)
        case 'read_file':
          return await readFileTool(host, input)
        case 'write_file':
          return await writeFileTool(host, input)
        case 'download_file':
          return await downloadFile(host, input)
        case 'upload_file':
          return await uploadFile(host, input)
        case 'list_dir':
          return await listDir(host, input)
        case 'stat_path':
          return await statPath(host, input)
        case 'tail_file':
          return await tailFile(host, input)
        case 'service_control':
          return await serviceControl(host, input, approvalMode)
        case 'pty_open':
          return await ptyOpen(host, input)
        case 'pty_write':
          return ptyWrite(host, input)
        case 'pty_read':
          return await ptyRead(host, input)
        case 'pty_resize':
          return ptyResize(host, input)
        case 'pty_close':
          return ptyClose(host, input)
        case 'pty_list':
          return this.ok({ ptys: this.ptys.list() })
        case 'get_metrics':
          return getMetrics(host, input)
        default:
          return this.error('UNKNOWN_TOOL', `Unknown tool: ${name}`)
      }
    } catch (err) {
      const mapped = mapThrown(err)
      if (mapped) return this.error(mapped.code, mapped.message)
      const message = err instanceof Error ? err.message : String(err)
      return this.error('TOOL_FAILED', message)
    }
  }

  private host(): McpRuntimeHost {
    const host: McpRuntimeHost = {
      ssh: this.ssh,
      connections: this.connections,
      metrics: this.metrics,
      jobs: this.jobs,
      ptys: this.ptys,
      lastToolAt: this.lastToolAt,
      approvalMode: this.approvalMode,
      requestApproval: this.requestApproval,
      ok: (data) => this.ok(data),
      error: (code, message, cls) => this.error(code, message, cls),
      touch: (sessionId) => this.touch(sessionId),
      requireSession: (sessionId) => this.requireSession(sessionId),
      assertGeneration: (sessionId, generation) => this.assertGeneration(sessionId, generation),
      withSftp: (sessionId, generation, fn) => this.withSftp(sessionId, generation, fn),
      ensureCommandAllowed: (classification, sessionId, command, approvalMode) =>
        this.ensureCommandAllowed(classification, sessionId, command, approvalMode),
      runForegroundExec: (target, command, classification, timeoutMs, stdin) =>
        runForegroundExec(host, target, command, classification, timeoutMs, stdin),
    }
    return host
  }

  private async ensureCommandAllowed(
    classification: { class: CommandClass; reason: string },
    sessionId: string,
    command: string,
    approvalMode = this.approvalMode,
  ): Promise<SshMcpToolResult | null> {
    let decision = decideCommandPolicy(classification, approvalMode)
    if (!decision.allow && decision.code === 'APPROVAL_REQUIRED') {
      if (!this.requestApproval) {
        return this.error('DESTRUCTIVE_DENIED', policyErrorMessage('DESTRUCTIVE_DENIED', classification.reason), classification.class)
      }
      const approved = await this.requestApproval({
        tool: 'exec',
        sessionId,
        command,
        class: classification.class,
        reason: classification.reason,
      })
      if (!approved) {
        return this.error('DESTRUCTIVE_DENIED', 'User denied the command', classification.class)
      }
      decision = { allow: true }
    }
    if (!decision.allow) {
      return this.error(decision.code, policyErrorMessage(decision.code, classification.reason, classification.class), classification.class)
    }
    return null
  }

  private async withSftp<T>(sessionId: string, generation: number, fn: () => Promise<T>): Promise<T> {
    this.assertGeneration(sessionId, generation)
    await this.ssh.initSftp(sessionId)
    this.assertGeneration(sessionId, generation)
    const result = await fn()
    this.assertGeneration(sessionId, generation)
    return result
  }

  private requireSession(sessionId: unknown): { sessionId: string; generation: number } {
    if (typeof sessionId !== 'string' || !isValidUUID(sessionId)) {
      throw toolError('INVALID_SESSION_ID', 'sessionId must be a UUID of an open SSH session')
    }
    const snap = this.ssh.getSessionSnapshot(sessionId)
    if (!snap) {
      throw toolError('SESSION_NOT_FOUND', 'No open SSH session with that id')
    }
    return { sessionId: snap.sessionId, generation: snap.generation }
  }

  private assertGeneration(sessionId: string, generation: number) {
    if (this.ssh.getSessionGeneration(sessionId) !== generation || !this.ssh.getSessionSnapshot(sessionId)) {
      throw toolError('SESSION_STALE', 'SSH session generation changed')
    }
  }

  private touch(sessionId: string) {
    this.lastToolAt.set(sessionId, Date.now())
  }

  private ok<T>(structuredContent: T): SshMcpToolResult<T> {
    return resultOk(structuredContent)
  }

  private error(code: SshMcpToolErrorCode, message: string, cls?: SshMcpErrorPayload['class']): SshMcpToolResult<SshMcpErrorPayload> {
    return resultError(code, message, cls)
  }
}

export function createSshMcpRuntime(opts: SshMcpRuntimeOptions): SshMcpRuntime {
  return new SshMcpRuntime(opts)
}
