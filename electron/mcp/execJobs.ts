import { randomUUID } from 'crypto'
import { MCP_JOB_TTL_MS, MCP_MAX_JOBS } from '../../shared/mcp/limits'
import type { CommandClass, SshMcpJobResult, SshMcpJobStatus, SshMcpJobSummary } from '../../shared/mcp/types'
import type { SessionExecResult } from '../ssh/sessionExec'

export type McpJobRecord = {
  jobId: string
  sessionId: string
  connectionId?: string
  connectionName?: string
  command: string
  class: CommandClass
  status: SshMcpJobStatus
  startedAt: number
  finishedAt?: number
  result?: SessionExecResult
  error?: string
  cancel: () => void
}

export class McpJobStore {
  private readonly jobs = new Map<string, McpJobRecord>()
  private readonly listeners = new Set<() => void>()
  private readonly settlementListeners = new Set<(job: SshMcpJobResult) => void>()

  onSettled(listener: (job: SshMcpJobResult) => void): () => void {
    this.settlementListeners.add(listener)
    return () => { this.settlementListeners.delete(listener) }
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notifyChanged() {
    for (const listener of this.listeners) {
      try { listener() } catch { /* Observers must not interrupt remote jobs. */ }
    }
  }

  create(input: {
    sessionId: string
    connectionId?: string
    connectionName?: string
    command: string
    class: CommandClass
    cancel: () => void
  }): McpJobRecord {
    this.prune()
    while (this.jobs.size >= MCP_MAX_JOBS) {
      const oldest = this.oldestFinished()
      if (oldest) this.jobs.delete(oldest)
      else break
    }
    const job: McpJobRecord = {
      jobId: randomUUID(),
      sessionId: input.sessionId,
      connectionId: input.connectionId,
      connectionName: input.connectionName,
      command: input.command,
      class: input.class,
      status: 'running',
      startedAt: Date.now(),
      cancel: input.cancel,
    }
    this.jobs.set(job.jobId, job)
    this.notifyChanged()
    return job
  }

  get(jobId: string): McpJobRecord | undefined {
    return this.jobs.get(jobId)
  }

  list(): McpJobRecord[] {
    this.prune()
    return [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  finish(jobId: string, status: Exclude<SshMcpJobStatus, 'running'>, result?: SessionExecResult, error?: string) {
    const job = this.jobs.get(jobId)
    if (!job || job.status !== 'running') return
    job.status = status
    job.finishedAt = Date.now()
    job.result = result
    job.error = error
    job.cancel = () => {}
    this.notifyChanged()
    for (const listener of this.settlementListeners) {
      try { listener(this.detail(job)) } catch { /* Observers cannot interrupt settlement. */ }
    }
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job) return false
    if (job.status !== 'running') return true
    try {
      job.cancel()
    } catch {}
    this.finish(jobId, 'cancelled', undefined, 'cancelled')
    return true
  }

  cancelForSession(sessionId: string) {
    for (const job of this.jobs.values()) {
      if (job.sessionId === sessionId && job.status === 'running') {
        this.cancel(job.jobId)
      }
    }
  }

  summary(job: McpJobRecord): SshMcpJobSummary {
    return {
      jobId: job.jobId,
      sessionId: job.sessionId,
      connectionId: job.connectionId,
      connectionName: job.connectionName,
      command: job.command,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      exitCode: job.result?.exitCode,
    }
  }

  detail(job: McpJobRecord): SshMcpJobResult {
    return {
      ...this.summary(job),
      stdout: job.result?.stdout,
      stderr: job.result?.stderr,
      truncated: job.result?.truncated,
      signal: job.result?.signal,
      error: job.error,
      class: job.class,
    }
  }

  private oldestFinished(): string | null {
    let oldest: McpJobRecord | null = null
    for (const job of this.jobs.values()) {
      if (job.status === 'running') continue
      if (!oldest || (job.finishedAt || 0) < (oldest.finishedAt || 0)) oldest = job
    }
    return oldest?.jobId ?? null
  }

  private prune() {
    const now = Date.now()
    for (const [id, job] of this.jobs) {
      if (job.status === 'running') continue
      if (job.finishedAt && now - job.finishedAt > MCP_JOB_TTL_MS) this.jobs.delete(id)
    }
  }
}
