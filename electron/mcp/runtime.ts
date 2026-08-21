import { mkdir, stat } from 'fs/promises'
import { dirname } from 'path'
import {
  MCP_DEFAULT_FANOUT_CONCURRENCY,
  MCP_DEFAULT_JOB_TIMEOUT_MS,
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_MAX_DIR_ENTRIES,
  MCP_MAX_FANOUT,
  MCP_MAX_FANOUT_CONCURRENCY,
  MCP_MAX_JOB_TIMEOUT_MS,
  MCP_MAX_READ_FILE_BYTES,
  MCP_MAX_STDIN_CHARS,
  MCP_MAX_TIMEOUT_MS,
  MCP_MAX_TRANSFER_BYTES,
  MCP_MAX_WRITE_FILE_BYTES,
  MCP_MIN_IDLE_DISCONNECT_MS,
  MCP_MIN_TIMEOUT_MS,
  MCP_SERVICE_UNIT_MAX,
  MCP_TAIL_DEFAULT_LINES,
  MCP_TAIL_MAX_BYTES,
  MCP_TAIL_MAX_LINES,
} from '../../shared/mcp/limits'
import { classifyCommand, validateMcpCommand } from '../../shared/mcp/classify'
import { decideCommandPolicy, policyErrorMessage } from '../../shared/mcp/policy'
import { SSH_MCP_TOOLS } from '../../shared/mcp/tools'
import { capExecOutput } from '../../shared/mcp/truncate'
import type {
  ApprovalMode,
  CommandClass,
  SshMcpDirEntry,
  SshMcpErrorPayload,
  SshMcpGroup,
  SshMcpPublicConnection,
  SshMcpSessionSnapshot,
  SshMcpToolDefinition,
  SshMcpToolErrorCode,
  SshMcpToolResult,
} from '../../shared/mcp/types'
import { isSshMcpToolName } from '../../shared/mcp/types'
import { isSafeLocalPath, isStrictPath, isValidUUID } from '../utils/validation'
import { McpJobStore } from './execJobs'
import { PtySessionStore } from './ptySessions'
import type { SshMcpRuntimeOptions, SshMcpSessionPort } from './ports'

type SessionRef = { sessionId: string; generation: number; connectionId: string; connectionName: string }

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

  async call(name: unknown, args: unknown): Promise<SshMcpToolResult> {
    if (!isSshMcpToolName(name)) {
      return this.error('UNKNOWN_TOOL', `Unknown tool: ${String(name)}`)
    }
    const input = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
    try {
      switch (name) {
        case 'list_connections':
          return this.ok(this.listConnections())
        case 'list_groups':
          return this.ok(this.listGroups())
        case 'list_sessions':
          return this.ok(this.listSessions())
        case 'connect':
          return await this.connect(input)
        case 'disconnect':
          return this.disconnect(input)
        case 'exec':
          return await this.exec(input)
        case 'list_jobs':
          return this.ok({ jobs: this.jobs.list().map((j) => this.jobs.summary(j)) })
        case 'get_job':
          return this.getJob(input)
        case 'cancel_job':
          return this.cancelJob(input)
        case 'read_file':
          return await this.readFile(input)
        case 'write_file':
          return await this.writeFile(input)
        case 'download_file':
          return await this.downloadFile(input)
        case 'upload_file':
          return await this.uploadFile(input)
        case 'list_dir':
          return await this.listDir(input)
        case 'stat_path':
          return await this.statPath(input)
        case 'tail_file':
          return await this.tailFile(input)
        case 'service_control':
          return await this.serviceControl(input)
        case 'pty_open':
          return await this.ptyOpen(input)
        case 'pty_write':
          return this.ptyWrite(input)
        case 'pty_read':
          return await this.ptyRead(input)
        case 'pty_resize':
          return this.ptyResize(input)
        case 'pty_close':
          return this.ptyClose(input)
        case 'pty_list':
          return this.ok({ ptys: this.ptys.list() })
        case 'get_metrics':
          return this.getMetrics(input)
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

  private listConnections(): { connections: SshMcpPublicConnection[] } {
    const open = new Set(this.ssh.listSessionSnapshots().map((s) => s.connectionId))
    const connections = this.connections.listPublicConnections().map((c) => ({
      ...c,
      hasOpenSession: open.has(c.id),
    }))
    return { connections }
  }

  private listGroups(): { groups: SshMcpGroup[] } {
    const conns = this.connections.listPublicConnections()
    const open = new Set(this.ssh.listSessionSnapshots().map((s) => s.connectionId))
    const groups = this.connections.listGroups().map((g) => {
      const members = conns.filter((c) => c.group === g.id)
      return {
        id: g.id,
        name: g.name,
        connectionCount: members.length,
        openSessionCount: members.filter((c) => open.has(c.id)).length,
        connectionIds: members.map((c) => c.id),
      }
    })
    return { groups }
  }

  private listSessions(): { sessions: SshMcpSessionSnapshot[] } {
    const byId = new Map(this.connections.listPublicConnections().map((c) => [c.id, c]))
    const now = Date.now()
    const live = new Set<string>()
    const sessions = this.ssh.listSessionSnapshots().map((snap) => {
      live.add(snap.sessionId)
      const conn = byId.get(snap.connectionId)
      const lastToolAt = this.lastToolAt.get(snap.sessionId) ?? null
      return {
        sessionId: snap.sessionId,
        connectionId: snap.connectionId,
        connectionName: snap.connectionName,
        host: conn?.host,
        port: conn?.port,
        username: conn?.username,
        group: conn?.group,
        generation: snap.generation,
        hasSftp: snap.hasSftp,
        healthy: true,
        lastToolAt,
        idleMs: lastToolAt ? Math.max(0, now - lastToolAt) : 0,
      }
    })
    for (const id of [...this.lastToolAt.keys()]) {
      if (!live.has(id)) this.lastToolAt.delete(id)
    }
    return { sessions }
  }

  private async connect(input: Record<string, unknown>): Promise<SshMcpToolResult> {
    const connectionId = this.resolveConnectionId(input)
    if (connectionId === null) {
      return this.error(
        'CONNECTION_AMBIGUOUS',
        'name matched more than one saved connection; pass connectionId from list_connections',
      )
    }
    if (!connectionId) {
      return this.error('CONNECTION_NOT_FOUND', 'Pass connectionId from list_connections, or an exact saved name')
    }
    try {
      const opened = await this.ssh.connectSaved(connectionId)
      this.touch(opened.sessionId)
      const snap = this.ssh.getSessionSnapshot(opened.sessionId)
      const conn = this.connections.listPublicConnections().find((c) => c.id === connectionId)
      return this.ok({
        sessionId: opened.sessionId,
        connectionId,
        reused: opened.reused,
        host: conn?.host,
        port: conn?.port,
        username: conn?.username,
        connectionName: snap?.connectionName || conn?.name,
        generation: snap?.generation,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'CONNECT_TIMEOUT') return this.error('CONNECT_TIMEOUT', 'Connect timed out waiting for the app window (host key confirmation may be pending)')
      if (message === 'CONNECT_UNAVAILABLE') return this.error('CONNECT_UNAVAILABLE', 'LiteConnect has no open window to complete the connection')
      if (message === 'CONNECT_FAILED') return this.error('CONNECT_FAILED', 'SSH connect failed')
      return this.error('CONNECT_FAILED', message)
    }
  }

  /** Returns id, empty string if missing, null if name matched multiple. */
  private resolveConnectionId(input: Record<string, unknown>): string | null {
    const rawId = typeof input.connectionId === 'string' ? input.connectionId.trim() : ''
    if (rawId) {
      if (!isValidUUID(rawId)) return ''
      const found = this.connections.listPublicConnections().some((c) => c.id === rawId)
      return found ? rawId : ''
    }
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) return ''
    const lowered = name.toLowerCase()
    const matches = this.connections.listPublicConnections().filter((c) => {
      if (c.name === name || c.host === name) return true
      if (`${c.username}@${c.host}` === name) return true
      if (c.name.toLowerCase() === lowered) return true
      return false
    })
    if (matches.length === 1) return matches[0].id
    if (matches.length > 1) return null
    return ''
  }

  private disconnect(input: Record<string, unknown>): SshMcpToolResult {
    const ids = new Set<string>()
    if (typeof input.sessionId === 'string' && input.sessionId.trim()) {
      if (!isValidUUID(input.sessionId)) {
        return this.error('INVALID_SESSION_ID', 'sessionId must be a UUID of an open SSH session')
      }
      ids.add(input.sessionId)
    }
    if (Array.isArray(input.sessionIds)) {
      for (const raw of input.sessionIds) {
        if (typeof raw !== 'string' || !isValidUUID(raw)) {
          return this.error('INVALID_SESSION_ID', 'sessionIds must be UUIDs of open SSH sessions')
        }
        ids.add(raw)
      }
    }
    if (ids.size === 0 && typeof input.idleMs === 'number' && Number.isFinite(input.idleMs)) {
      const minIdle = Math.max(MCP_MIN_IDLE_DISCONNECT_MS, Math.floor(input.idleMs))
      const now = Date.now()
      for (const snap of this.ssh.listSessionSnapshots()) {
        const last = this.lastToolAt.get(snap.sessionId)
        const idle = last != null ? now - last : 0
        if (idle >= minIdle) ids.add(snap.sessionId)
      }
    }
    if (ids.size === 0) {
      return this.error(
        'INVALID_ARGUMENTS',
        'Pass sessionId, sessionIds, or idleMs (>= 60000) to select sessions to close',
      )
    }
    const closed: string[] = []
    const missing: string[] = []
    for (const id of ids) {
      if (!this.ssh.getSessionSnapshot(id)) {
        missing.push(id)
        continue
      }
      this.jobs.cancelForSession(id)
      this.ptys.closeForSession(id)
      this.ssh.disconnectSession(id)
      this.lastToolAt.delete(id)
      closed.push(id)
    }
    return this.ok({ closed, missing, count: closed.length })
  }

  private async exec(input: Record<string, unknown>): Promise<SshMcpToolResult> {
    const validated = validateMcpCommand(input.command)
    if (!validated.ok) {
      return this.error('INVALID_COMMAND', validated.reason)
    }
    const classification = classifyCommand(validated.command)
    const stdin = parseStdin(input.stdin)
    if (stdin === false) {
      return this.error('INVALID_ARGUMENTS', `stdin exceeds ${MCP_MAX_STDIN_CHARS} characters`)
    }
    const background = input.background === true
    const timeoutMs = background
      ? clampJobTimeout(input.jobTimeoutMs)
      : clampTimeout(input.timeoutMs)
    const targets = await this.resolveExecTargets(input)
    if ('isError' in targets) return targets
    if (targets.length === 0) {
      return this.error('SESSION_NOT_FOUND', 'No open sessions matched. Connect first, or pass connectMissing=true.')
    }

    const allowed = await this.ensureCommandAllowed(classification, targets[0].sessionId, validated.command)
    if (allowed) return allowed

    if (background) {
      const jobs = []
      for (const target of targets) {
        jobs.push(await this.startJob(target, validated.command, classification, timeoutMs, stdin || undefined))
      }
      if (targets.length === 1) return this.ok(jobs[0])
      return this.ok({ jobs })
    }

    const concurrency = clampConcurrency(input.concurrency)
    const results = await mapPool(targets, concurrency, async (target) => {
      try {
        return await this.runForegroundExec(target, validated.command, classification, timeoutMs, stdin || undefined)
      } catch (err) {
        const mapped = mapThrown(err)
        return {
          sessionId: target.sessionId,
          connectionName: target.connectionName,
          isError: true as const,
          code: mapped?.code || 'TOOL_FAILED',
          message: mapped?.message || (err instanceof Error ? err.message : String(err)),
        }
      }
    })
    if (targets.length === 1) {
      const one = results[0] as { isError?: boolean; code?: SshMcpToolErrorCode; message?: string }
      if (one.isError && one.code && one.message) return this.error(one.code, one.message)
      return this.ok(results[0])
    }
    return this.ok({ results })
  }

  private async startJob(
    target: SessionRef,
    command: string,
    classification: { class: CommandClass },
    timeoutMs: number,
    stdin?: string,
  ) {
    this.assertGeneration(target.sessionId, target.generation)
    const started = await this.ssh.beginSessionExec(
      target.sessionId,
      command,
      target.generation,
      timeoutMs,
      stdin ? { stdin } : undefined,
    )
    const job = this.jobs.create({
      sessionId: target.sessionId,
      connectionId: target.connectionId,
      connectionName: target.connectionName,
      command,
      class: classification.class,
      cancel: started.cancel,
    })
    void started.promise
      .then((raw) => {
        const capped = capExecOutput(raw.stdout, raw.stderr)
        this.jobs.finish(job.jobId, 'completed', {
          ...raw,
          stdout: capped.stdout,
          stderr: capped.stderr,
          truncated: raw.truncated || capped.truncated,
        })
        this.touch(target.sessionId)
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        if (/timeout after/i.test(message)) this.jobs.finish(job.jobId, 'timeout', undefined, message)
        else if (/cancelled/i.test(message)) this.jobs.finish(job.jobId, 'cancelled', undefined, message)
        else this.jobs.finish(job.jobId, 'failed', undefined, message)
      })
    this.touch(target.sessionId)
    return this.jobs.summary(job)
  }

  private async runForegroundExec(
    target: SessionRef,
    command: string,
    classification: { class: CommandClass },
    timeoutMs: number,
    stdin?: string,
  ) {
    this.assertGeneration(target.sessionId, target.generation)
    const raw = await this.ssh.executeSessionExec(
      target.sessionId,
      command,
      target.generation,
      timeoutMs,
      stdin ? { stdin } : undefined,
    )
    this.assertGeneration(target.sessionId, target.generation)
    this.touch(target.sessionId)
    const capped = capExecOutput(raw.stdout, raw.stderr)
    return {
      sessionId: target.sessionId,
      connectionName: target.connectionName,
      exitCode: raw.exitCode,
      signal: raw.signal,
      stdout: capped.stdout,
      stderr: capped.stderr,
      truncated: raw.truncated || capped.truncated,
      class: classification.class,
    }
  }

  private async resolveExecTargets(input: Record<string, unknown>): Promise<SessionRef[] | SshMcpToolResult> {
    const explicit: string[] = []
    if (typeof input.sessionId === 'string' && input.sessionId.trim()) {
      const id = input.sessionId.trim()
      if (!isValidUUID(id)) {
        return this.error('INVALID_SESSION_ID', 'sessionId must be a UUID of an open SSH session')
      }
      explicit.push(id)
    }
    if (Array.isArray(input.sessionIds)) {
      for (const raw of input.sessionIds) {
        if (typeof raw !== 'string' || !isValidUUID(raw)) {
          return this.error('INVALID_SESSION_ID', 'sessionIds must be UUIDs of open SSH sessions')
        }
        explicit.push(raw)
      }
    }
    const groupRaw = typeof input.group === 'string' ? input.group.trim() : ''
    const connectMissing = input.connectMissing === true

    if (explicit.length === 0 && !groupRaw) {
      return this.error('INVALID_SESSION_ID', 'Pass sessionId, sessionIds, or group')
    }

    const connectionIds = new Set<string>()
    if (groupRaw) {
      const groups = this.connections.listGroups()
      const lowered = groupRaw.toLowerCase()
      const group = groups.find((g) => g.id === groupRaw || g.name === groupRaw || g.name.toLowerCase() === lowered)
      if (!group) return this.error('GROUP_NOT_FOUND', `No saved group matching ${groupRaw}`)
      for (const c of this.connections.listPublicConnections()) {
        if (c.group === group.id) connectionIds.add(c.id)
      }
    }

    const out: SessionRef[] = []
    const seen = new Set<string>()
    const addSnap = (sessionId: string) => {
      const snap = this.ssh.getSessionSnapshot(sessionId)
      if (!snap) return false
      if (seen.has(snap.sessionId)) return true
      if (out.length >= MCP_MAX_FANOUT) return true
      seen.add(snap.sessionId)
      out.push({
        sessionId: snap.sessionId,
        generation: snap.generation,
        connectionId: snap.connectionId,
        connectionName: snap.connectionName,
      })
      return true
    }

    for (const id of explicit) {
      if (!addSnap(id)) return this.error('SESSION_NOT_FOUND', `No open SSH session with id ${id}`)
    }

    if (connectionIds.size > 0) {
      const byConn = new Map<string, string[]>()
      for (const snap of this.ssh.listSessionSnapshots()) {
        const list = byConn.get(snap.connectionId) || []
        list.push(snap.sessionId)
        byConn.set(snap.connectionId, list)
      }
      for (const connectionId of connectionIds) {
        const open = byConn.get(connectionId)
        if (open?.length) {
          addSnap(open[open.length - 1])
          continue
        }
        if (!connectMissing) continue
        const opened = await this.ssh.connectSaved(connectionId)
        this.touch(opened.sessionId)
        addSnap(opened.sessionId)
      }
    }

    return out
  }

  private getJob(input: Record<string, unknown>): SshMcpToolResult {
    const jobId = typeof input.jobId === 'string' ? input.jobId.trim() : ''
    if (!jobId) return this.error('INVALID_ARGUMENTS', 'jobId is required')
    const job = this.jobs.get(jobId)
    if (!job) return this.error('JOB_NOT_FOUND', 'No background job with that id')
    return this.ok(this.jobs.detail(job))
  }

  private cancelJob(input: Record<string, unknown>): SshMcpToolResult {
    const jobId = typeof input.jobId === 'string' ? input.jobId.trim() : ''
    if (!jobId) return this.error('INVALID_ARGUMENTS', 'jobId is required')
    const job = this.jobs.get(jobId)
    if (!job) return this.error('JOB_NOT_FOUND', 'No background job with that id')
    this.jobs.cancel(jobId)
    const next = this.jobs.get(jobId)
    return this.ok(next ? this.jobs.summary(next) : { jobId, status: 'cancelled' })
  }

  private async readFile(input: Record<string, unknown>): Promise<SshMcpToolResult> {
    const session = this.requireSession(input.sessionId)
    const path = requireRemotePath(input.path)
    const offset = clampOffset(input.offset)
    const length = clampLength(input.length, MCP_MAX_READ_FILE_BYTES)
    const encoding = parseEncoding(input.encoding)
    const ranged = await this.withSftp(session.sessionId, session.generation, () =>
      this.ssh.sftpReadFileRange(session.sessionId, path, offset, length),
    )
    this.touch(session.sessionId)
    const content = encoding === 'base64' ? ranged.buffer.toString('base64') : ranged.buffer.toString('utf8')
    const nextOffset = offset + ranged.buffer.length
    return this.ok({
      path,
      content,
      encoding,
      bytes: ranged.buffer.length,
      size: ranged.size,
      offset,
      eof: ranged.eof,
      nextOffset,
    })
  }

  private async writeFile(input: Record<string, unknown>): Promise<SshMcpToolResult> {
    const session = this.requireSession(input.sessionId)
    const path = requireRemotePath(input.path)
    if (typeof input.content !== 'string') {
      return this.error('INVALID_ARGUMENTS', 'content is required')
    }
    const encoding = parseEncoding(input.encoding)
    let buffer: Buffer
    try {
      buffer = encoding === 'base64' ? Buffer.from(input.content, 'base64') : Buffer.from(input.content, 'utf8')
    } catch {
      return this.error('INVALID_ARGUMENTS', 'content is not valid for the chosen encoding')
    }
    if (buffer.length > MCP_MAX_WRITE_FILE_BYTES) {
      return this.error(
        'FILE_TOO_LARGE',
        `Write is limited to ${MCP_MAX_WRITE_FILE_BYTES} bytes per call; use upload_file for larger files`,
      )
    }
    await this.withSftp(session.sessionId, session.generation, () =>
      this.ssh.sftpWriteBuffer(session.sessionId, path, buffer),
    )
    this.touch(session.sessionId)
    return this.ok({ path, bytes: buffer.length, encoding })
  }

  private async downloadFile(input: Record<string, unknown>): Promise<SshMcpToolResult> {
    const session = this.requireSession(input.sessionId)
    const remotePath = requireRemotePath(input.remotePath)
    const localPath = requireLocalPath(input.localPath)
    const st = await this.withSftp(session.sessionId, session.generation, () =>
      this.ssh.sftpStat(session.sessionId, remotePath),
    )
    if (st.size > MCP_MAX_TRANSFER_BYTES) {
      return this.error('FILE_TOO_LARGE', `Remote file is ${st.size} bytes; max download is ${MCP_MAX_TRANSFER_BYTES}`)
    }
    await mkdir(dirname(localPath), { recursive: true })
    await this.withSftp(session.sessionId, session.generation, () =>
      this.ssh.sftpDownload(session.sessionId, remotePath, localPath),
    )
    this.touch(session.sessionId)
    return this.ok({ remotePath, localPath, bytes: st.size })
  }

  private async uploadFile(input: Record<string, unknown>): Promise<SshMcpToolResult> {
    const session = this.requireSession(input.sessionId)
    const remotePath = requireRemotePath(input.remotePath)
    const localPath = requireLocalPath(input.localPath)
    let size = 0
    try {
      const st = await stat(localPath)
      if (!st.isFile()) return this.error('INVALID_PATH', 'localPath must be a regular file')
      size = st.size
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return this.error('INVALID_PATH', message)
    }
    if (size > MCP_MAX_TRANSFER_BYTES) {
      return this.error('FILE_TOO_LARGE', `Local file is ${size} bytes; max upload is ${MCP_MAX_TRANSFER_BYTES}`)
    }
    await this.withSftp(session.sessionId, session.generation, () =>
      this.ssh.sftpUpload(session.sessionId, localPath, remotePath),
    )
    this.touch(session.sessionId)
    return this.ok({ localPath, remotePath, bytes: size })
  }

  private async listDir(input: Record<string, unknown>): Promise<SshMcpToolResult> {
    const session = this.requireSession(input.sessionId)
    const path = requireRemotePath(input.path)
    const entries = await this.withSftp(session.sessionId, session.generation, () =>
      this.ssh.sftpReaddir(session.sessionId, path),
    )
    this.touch(session.sessionId)
    const truncated = entries.length > MCP_MAX_DIR_ENTRIES
    const sliced: SshMcpDirEntry[] = entries.slice(0, MCP_MAX_DIR_ENTRIES).map((e) => ({
      name: e.name,
      path: e.path,
      isDirectory: e.isDirectory,
      isSymlink: e.isSymlink,
      size: e.size,
      modifyTime: e.modifyTime,
      permissions: e.permissions,
    }))
    return this.ok({ path, entries: sliced, truncated, total: entries.length })
  }

  private async statPath(input: Record<string, unknown>): Promise<SshMcpToolResult> {
    const session = this.requireSession(input.sessionId)
    const path = requireRemotePath(input.path)
    const statResult = await this.withSftp(session.sessionId, session.generation, () =>
      this.ssh.sftpStat(session.sessionId, path),
    )
    this.touch(session.sessionId)
    return this.ok({
      path,
      mode: statResult.mode,
      size: statResult.size,
      uid: statResult.uid,
      gid: statResult.gid,
      atime: statResult.atime,
      mtime: statResult.mtime,
    })
  }

  private async tailFile(input: Record<string, unknown>): Promise<SshMcpToolResult> {
    const session = this.requireSession(input.sessionId)
    const path = requireRemotePath(input.path)
    const lines = clampLines(input.lines)
    const st = await this.withSftp(session.sessionId, session.generation, () =>
      this.ssh.sftpStat(session.sessionId, path),
    )
    if (st.size <= 0) {
      this.touch(session.sessionId)
      return this.ok({ path, lines: [], lineCount: 0, size: 0, truncated: false })
    }
    const length = Math.min(st.size, MCP_TAIL_MAX_BYTES)
    const offset = Math.max(0, st.size - length)
    const ranged = await this.withSftp(session.sessionId, session.generation, () =>
      this.ssh.sftpReadFileRange(session.sessionId, path, offset, Math.max(1, length) || 1),
    )
    this.touch(session.sessionId)
    const text = ranged.buffer.toString('utf8')
    const all = text.split(/\r?\n/)
    if (all.length && all[all.length - 1] === '') all.pop()
    const sliced = all.slice(-lines)
    return this.ok({
      path,
      lines: sliced,
      lineCount: sliced.length,
      size: st.size,
      truncated: st.size > MCP_TAIL_MAX_BYTES || all.length > lines,
    })
  }

  private async serviceControl(input: Record<string, unknown>): Promise<SshMcpToolResult> {
    const session = this.requireSession(input.sessionId)
    const unit = typeof input.unit === 'string' ? input.unit.trim() : ''
    if (!unit || unit.length > MCP_SERVICE_UNIT_MAX || !/^[A-Za-z0-9:._@-]+$/.test(unit)) {
      return this.error('INVALID_UNIT', 'unit must match [A-Za-z0-9:._@-] and be at most 128 characters')
    }
    const actionRaw = typeof input.action === 'string' ? input.action.trim() : 'status'
    const action = actionRaw as 'status' | 'start' | 'stop' | 'restart' | 'reload'
    if (!['status', 'start', 'stop', 'restart', 'reload'].includes(action)) {
      return this.error('INVALID_ARGUMENTS', 'action must be status, start, stop, restart, or reload')
    }
    const command =
      action === 'status'
        ? `systemctl status --no-pager -n 25 -- ${unit}`
        : `systemctl ${action} --no-pager -- ${unit}`
    const classification = classifyCommand(command)
    const denied = await this.ensureCommandAllowed(classification, session.sessionId, command)
    if (denied) return denied
    const result = await this.runForegroundExec(
      { ...session, connectionId: this.ssh.getSessionSnapshot(session.sessionId)?.connectionId || '', connectionName: this.ssh.getSessionSnapshot(session.sessionId)?.connectionName || '' },
      command,
      classification,
      clampTimeout(undefined),
    )
    return this.ok({ ...result, unit, action })
  }

  private async ptyOpen(input: Record<string, unknown>): Promise<SshMcpToolResult> {
    const session = this.requireSession(input.sessionId)
    const opened = await this.ptys.open({
      sessionId: session.sessionId,
      generation: session.generation,
      cols: typeof input.cols === 'number' ? input.cols : undefined,
      rows: typeof input.rows === 'number' ? input.rows : undefined,
    })
    this.touch(session.sessionId)
    return this.ok({
      ...opened,
      sessionId: session.sessionId,
      hint: 'Poll with pty_read(mode=screen, waitForIdleMs=300) after pty_write. Close with pty_close. This PTY is not the user-visible terminal.',
    })
  }

  private ptyWrite(input: Record<string, unknown>): SshMcpToolResult {
    const ptyId = typeof input.ptyId === 'string' ? input.ptyId.trim() : ''
    if (!ptyId) return this.error('INVALID_ARGUMENTS', 'ptyId is required')
    if (typeof input.data !== 'string') return this.error('INVALID_ARGUMENTS', 'data is required')
    this.ptys.write(ptyId, input.data, input.raw === true)
    this.touch(this.ptys.list().find((p) => p.ptyId === ptyId)?.sessionId || '')
    return this.ok({ ptyId, bytes: input.data.length, raw: input.raw === true })
  }

  private async ptyRead(input: Record<string, unknown>): Promise<SshMcpToolResult> {
    const ptyId = typeof input.ptyId === 'string' ? input.ptyId.trim() : ''
    if (!ptyId) return this.error('INVALID_ARGUMENTS', 'ptyId is required')
    const result = await this.ptys.read(ptyId, {
      mode: input.mode === 'snapshot' || input.mode === 'screen' ? input.mode : 'streaming',
      waitForIdleMs: typeof input.waitForIdleMs === 'number' ? input.waitForIdleMs : undefined,
      maxBytes: typeof input.maxBytes === 'number' ? input.maxBytes : undefined,
    })
    return this.ok(result)
  }

  private ptyResize(input: Record<string, unknown>): SshMcpToolResult {
    const ptyId = typeof input.ptyId === 'string' ? input.ptyId.trim() : ''
    if (!ptyId) return this.error('INVALID_ARGUMENTS', 'ptyId is required')
    if (typeof input.cols !== 'number' || typeof input.rows !== 'number') {
      return this.error('INVALID_ARGUMENTS', 'cols and rows are required')
    }
    const size = this.ptys.resize(ptyId, input.cols, input.rows)
    return this.ok({ ptyId, ...size })
  }

  private ptyClose(input: Record<string, unknown>): SshMcpToolResult {
    const ptyId = typeof input.ptyId === 'string' ? input.ptyId.trim() : ''
    if (!ptyId) return this.error('INVALID_ARGUMENTS', 'ptyId is required')
    const ok = this.ptys.close(ptyId)
    if (!ok) return this.error('PTY_NOT_FOUND', 'No agent PTY with that id')
    return this.ok({ ptyId, closed: true })
  }

  private getMetrics(input: Record<string, unknown>): SshMcpToolResult {
    const session = this.requireSession(input.sessionId)
    this.touch(session.sessionId)
    const cached = this.metrics?.getCached(session.sessionId)
    if (!cached) {
      return this.error(
        'MONITOR_NOT_STARTED',
        'No cached metrics for this session. Start the in-app monitor, or use exec with df/free/uptime.',
      )
    }
    return this.ok({ sessionId: session.sessionId, metrics: cached })
  }

  private async ensureCommandAllowed(
    classification: { class: CommandClass; reason: string },
    sessionId: string,
    command: string,
  ): Promise<SshMcpToolResult | null> {
    let decision = decideCommandPolicy(classification, this.approvalMode)
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
    return {
      isError: false,
      content: JSON.stringify(structuredContent, null, 2),
      structuredContent,
    }
  }

  private error(code: SshMcpToolErrorCode, message: string, cls?: SshMcpErrorPayload['class']): SshMcpToolResult<SshMcpErrorPayload> {
    const structuredContent: SshMcpErrorPayload = cls ? { code, message, class: cls } : { code, message }
    return {
      isError: true,
      content: `${code}: ${message}`,
      structuredContent,
    }
  }
}

class ToolError extends Error {
  code: SshMcpToolErrorCode
  constructor(code: SshMcpToolErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

function toolError(code: SshMcpToolErrorCode, message: string): ToolError {
  return new ToolError(code, message)
}

function mapThrown(err: unknown): { code: SshMcpToolErrorCode; message: string } | null {
  if (err instanceof ToolError) return { code: err.code, message: err.message }
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: string }).code
    if (
      code === 'PTY_NOT_FOUND' ||
      code === 'PTY_CLOSED' ||
      code === 'PTY_LIMIT' ||
      code === 'INVALID_ARGUMENTS'
    ) {
      return { code, message: err instanceof Error ? err.message : String(err) }
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (/generation changed/i.test(message)) return { code: 'SESSION_STALE', message }
  if (/timeout after/i.test(message)) return { code: 'EXEC_TIMEOUT', message }
  if (/cancelled/i.test(message)) return { code: 'EXEC_CANCELLED', message }
  if (/session not found/i.test(message)) return { code: 'SESSION_NOT_FOUND', message }
  if (/too large/i.test(message)) return { code: 'FILE_TOO_LARGE', message }
  return null
}

function requireRemotePath(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw toolError('INVALID_PATH', 'path is required')
  }
  if (!isStrictPath(path)) {
    throw toolError('INVALID_PATH', 'path is invalid or contains parent-directory segments')
  }
  return path.replace(/\/+$/, '') || '/'
}

function requireLocalPath(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw toolError('INVALID_PATH', 'localPath is required')
  }
  if (!isSafeLocalPath(path)) {
    throw toolError('INVALID_PATH', 'localPath must be an absolute path without parent-directory segments')
  }
  return path
}

function clampTimeout(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MCP_DEFAULT_TIMEOUT_MS
  const n = Math.floor(raw)
  if (n < MCP_MIN_TIMEOUT_MS) return MCP_MIN_TIMEOUT_MS
  if (n > MCP_MAX_TIMEOUT_MS) return MCP_MAX_TIMEOUT_MS
  return n
}

function clampJobTimeout(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MCP_DEFAULT_JOB_TIMEOUT_MS
  const n = Math.floor(raw)
  if (n < MCP_MIN_TIMEOUT_MS) return MCP_MIN_TIMEOUT_MS
  if (n > MCP_MAX_JOB_TIMEOUT_MS) return MCP_MAX_JOB_TIMEOUT_MS
  return n
}

function clampConcurrency(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MCP_DEFAULT_FANOUT_CONCURRENCY
  return Math.min(MCP_MAX_FANOUT_CONCURRENCY, Math.max(1, Math.floor(raw)))
}

function clampOffset(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return 0
  return Math.floor(raw)
}

function clampLength(raw: unknown, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return max
  return Math.min(max, Math.max(1, Math.floor(raw)))
}

function clampLines(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MCP_TAIL_DEFAULT_LINES
  return Math.min(MCP_TAIL_MAX_LINES, Math.max(1, Math.floor(raw)))
}

function parseEncoding(raw: unknown): 'utf8' | 'base64' {
  return raw === 'base64' ? 'base64' : 'utf8'
}

function parseStdin(raw: unknown): string | '' | false {
  if (raw == null) return ''
  if (typeof raw !== 'string') return false
  if (raw.length > MCP_MAX_STDIN_CHARS) return false
  return raw
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return []
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      out[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return out
}

export function createSshMcpRuntime(opts: SshMcpRuntimeOptions): SshMcpRuntime {
  return new SshMcpRuntime(opts)
}
