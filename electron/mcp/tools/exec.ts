import { MCP_MAX_FANOUT, MCP_MAX_STDIN_CHARS } from '../../../shared/mcp/limits'
import { classifyCommand, validateMcpCommand } from '../../../shared/mcp/classify'
import { capExecOutput } from '../../../shared/mcp/truncate'
import type { ApprovalMode, CommandClass, SshMcpToolErrorCode, SshMcpToolResult } from '../../../shared/mcp/types'
import { isValidUUID } from '../../utils/validation'
import { clampConcurrency, clampJobTimeout, clampTimeout, mapPool, parseStdin } from '../args'
import { mapThrown } from '../errors'
import type { McpRuntimeHost, SessionRef } from '../runtimeHost'

export async function execCommand(
  host: McpRuntimeHost,
  input: Record<string, unknown>,
  approvalMode: ApprovalMode,
): Promise<SshMcpToolResult> {
  const validated = validateMcpCommand(input.command)
  if (!validated.ok) {
    return host.error('INVALID_COMMAND', validated.reason)
  }
  const classification = classifyCommand(validated.command)
  const stdin = parseStdin(input.stdin)
  if (stdin === false) {
    return host.error('INVALID_ARGUMENTS', `stdin exceeds ${MCP_MAX_STDIN_CHARS} characters`)
  }
  const background = input.background === true
  const timeoutMs = background
    ? clampJobTimeout(input.jobTimeoutMs)
    : clampTimeout(input.timeoutMs)
  const targets = await resolveExecTargets(host, input)
  if ('isError' in targets) return targets
  if (targets.length === 0) {
    return host.error('SESSION_NOT_FOUND', 'No open sessions matched. Connect first, or pass connectMissing=true.')
  }

  const allowed = await host.ensureCommandAllowed(
    classification,
    targets[0].sessionId,
    validated.command,
    approvalMode,
  )
  if (allowed) return allowed

  if (background) {
    const jobs = []
    for (const target of targets) {
      jobs.push(await startJob(host, target, validated.command, classification, timeoutMs, stdin || undefined))
    }
    if (targets.length === 1) return host.ok(jobs[0])
    return host.ok({ jobs })
  }

  const concurrency = clampConcurrency(input.concurrency)
  const results = await mapPool(targets, concurrency, async (target) => {
    try {
      return await host.runForegroundExec(target, validated.command, classification, timeoutMs, stdin || undefined)
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
    if (one.isError && one.code && one.message) return host.error(one.code, one.message)
    return host.ok(results[0])
  }
  return host.ok({ results })
}

async function startJob(
  host: McpRuntimeHost,
  target: SessionRef,
  command: string,
  classification: { class: CommandClass },
  timeoutMs: number,
  stdin?: string,
) {
  host.assertGeneration(target.sessionId, target.generation)
  const started = await host.ssh.beginSessionExec(
    target.sessionId,
    command,
    target.generation,
    timeoutMs,
    stdin ? { stdin } : undefined,
  )
  const job = host.jobs.create({
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
      host.jobs.finish(job.jobId, 'completed', {
        ...raw,
        stdout: capped.stdout,
        stderr: capped.stderr,
        truncated: raw.truncated || capped.truncated,
      })
      host.touch(target.sessionId)
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      if (/timeout after/i.test(message)) host.jobs.finish(job.jobId, 'timeout', undefined, message)
      else if (/cancelled/i.test(message)) host.jobs.finish(job.jobId, 'cancelled', undefined, message)
      else host.jobs.finish(job.jobId, 'failed', undefined, message)
    })
  host.touch(target.sessionId)
  return host.jobs.summary(job)
}

export async function runForegroundExec(
  host: McpRuntimeHost,
  target: SessionRef,
  command: string,
  classification: { class: CommandClass },
  timeoutMs: number,
  stdin?: string,
) {
  host.assertGeneration(target.sessionId, target.generation)
  const raw = await host.ssh.executeSessionExec(
    target.sessionId,
    command,
    target.generation,
    timeoutMs,
    stdin ? { stdin } : undefined,
  )
  host.assertGeneration(target.sessionId, target.generation)
  host.touch(target.sessionId)
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

export async function resolveExecTargets(
  host: McpRuntimeHost,
  input: Record<string, unknown>,
): Promise<SessionRef[] | SshMcpToolResult> {
  const explicit: string[] = []
  if (typeof input.sessionId === 'string' && input.sessionId.trim()) {
    const id = input.sessionId.trim()
    if (!isValidUUID(id)) {
      return host.error('INVALID_SESSION_ID', 'sessionId must be a UUID of an open SSH session')
    }
    explicit.push(id)
  }
  if (Array.isArray(input.sessionIds)) {
    for (const raw of input.sessionIds) {
      if (typeof raw !== 'string' || !isValidUUID(raw)) {
        return host.error('INVALID_SESSION_ID', 'sessionIds must be UUIDs of open SSH sessions')
      }
      explicit.push(raw)
    }
  }
  const groupRaw = typeof input.group === 'string' ? input.group.trim() : ''
  const connectMissing = input.connectMissing === true

  if (explicit.length === 0 && !groupRaw) {
    return host.error('INVALID_SESSION_ID', 'Pass sessionId, sessionIds, or group')
  }

  const connectionIds = new Set<string>()
  if (groupRaw) {
    const groups = host.connections.listGroups()
    const lowered = groupRaw.toLowerCase()
    const group = groups.find((g) => g.id === groupRaw || g.name === groupRaw || g.name.toLowerCase() === lowered)
    if (!group) return host.error('GROUP_NOT_FOUND', `No saved group matching ${groupRaw}`)
    for (const c of host.connections.listPublicConnections()) {
      if (c.group === group.id) connectionIds.add(c.id)
    }
  }

  const out: SessionRef[] = []
  const seen = new Set<string>()
  const addSnap = (sessionId: string) => {
    const snap = host.ssh.getSessionSnapshot(sessionId)
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
    if (!addSnap(id)) return host.error('SESSION_NOT_FOUND', `No open SSH session with id ${id}`)
  }

  if (connectionIds.size > 0) {
    const byConn = new Map<string, string[]>()
    for (const snap of host.ssh.listSessionSnapshots()) {
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
      const opened = await host.ssh.connectSaved(connectionId)
      host.touch(opened.sessionId)
      addSnap(opened.sessionId)
    }
  }

  return out
}

export function getJob(host: McpRuntimeHost, input: Record<string, unknown>): SshMcpToolResult {
  const jobId = typeof input.jobId === 'string' ? input.jobId.trim() : ''
  if (!jobId) return host.error('INVALID_ARGUMENTS', 'jobId is required')
  const job = host.jobs.get(jobId)
  if (!job) return host.error('JOB_NOT_FOUND', 'No background job with that id')
  return host.ok(host.jobs.detail(job))
}

export function cancelJob(host: McpRuntimeHost, input: Record<string, unknown>): SshMcpToolResult {
  const jobId = typeof input.jobId === 'string' ? input.jobId.trim() : ''
  if (!jobId) return host.error('INVALID_ARGUMENTS', 'jobId is required')
  const job = host.jobs.get(jobId)
  if (!job) return host.error('JOB_NOT_FOUND', 'No background job with that id')
  host.jobs.cancel(jobId)
  const next = host.jobs.get(jobId)
  return host.ok(next ? host.jobs.summary(next) : { jobId, status: 'cancelled' })
}
