import { randomUUID } from 'crypto'
import { t } from '../../i18n'
import type { CommandClass, SshMcpJobResult } from '../../../shared/mcp/types'
import type { AiDeclaredRisk } from '../../../shared/aiToolPolicy'
import {
  MCP_MAX_SCHEDULED_JOBS, MCP_SCHEDULE_GRACE_MS, MCP_SCHEDULE_MAX_DELAY_MS, MCP_SCHEDULE_MIN_DELAY_MS, MCP_SCHEDULE_NOTE_MAX_CHARS,
} from '../../../shared/mcp/limits'

export type AiDeferredJobStatus = 'scheduled' | 'waiting' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired'

/** A command the model approved now and asked to run later, bound to one conversation. */
export interface AiDeferredJob {
  id: string
  historyId: string
  threadId: string
  connectionId: string
  connectionName?: string
  /** The session it was scheduled from, then the session it ran on. */
  sessionId: string
  command: string
  stdin?: string
  jobTimeoutMs: number
  class: CommandClass
  risk: AiDeclaredRisk
  note?: string
  createdAt: number
  dueAt: number
  status: AiDeferredJobStatus
  startedAt?: number
  finishedAt?: number
  error?: string
}

export interface AiDeferredJobsSnapshot { version: 1; jobs: AiDeferredJob[] }

export interface AiDeferredJobInput {
  historyId: string
  threadId: string
  sessionId: string
  connectionId: string
  connectionName?: string
  command: string
  stdin?: string
  jobTimeoutMs: number
  startAfterMs: number
  note?: string
  risk: AiDeclaredRisk
  class: CommandClass
}

export interface AiDeferredJobsPorts {
  read: () => AiDeferredJobsSnapshot | undefined
  save: (state: AiDeferredJobsSnapshot) => void
  runtime: {
    registerScheduledJob: (input: {
      jobId: string; sessionId: string; connectionId?: string; connectionName?: string
      command: string; class: CommandClass; dueAt: number; note?: string; cancel: () => void
    }) => void
    setScheduledJobAwaiting: (jobId: string, waiting: boolean) => void
    startScheduledJob: (jobId: string, sessionId: string, input: { command: string; jobTimeoutMs: number; stdin?: string }) => Promise<unknown>
    failScheduledJob: (jobId: string, message: string) => void
    cancelJob: (jobId: string) => void
    listSessionsForConnection: (connectionId: string) => string[]
    onJobSettled: (listener: (job: SshMcpJobResult) => void) => () => void
  }
  execution: {
    bindDeferredJob: (input: { jobId: string; sessionId: string; historyId: string; threadId: string }) => boolean
    recordDeferredJobResult: (binding: { historyId: string; threadId: string; sessionId: string }, job: SshMcpJobResult) => Promise<void>
  }
  changed?: () => void
  now?: () => number
  onError?: (error: unknown) => void
}

const RETAIN_FINISHED_MS = 24 * 60 * 60 * 1000
const TICK_MS = 30_000
const isPending = (job: AiDeferredJob) => job.status === 'scheduled' || job.status === 'waiting'

/**
 * One-shot commands scheduled by the model. The clock only checks due records; a
 * due job runs as an ordinary background job on an open session of its host, and
 * its completion reaches the conversation through the existing delivery path.
 * With no open session it waits for the next connection instead of opening one.
 */
export class AiDeferredJobs {
  private state: AiDeferredJobsSnapshot
  private timer?: ReturnType<typeof setInterval>
  private disposed = false
  private readonly bound = new Set<string>()
  /** Jobs settled without a window: their store settlement is written into the conversation here. */
  private readonly pendingRecords = new Set<string>()
  private readonly tasks = new Set<Promise<unknown>>()
  private unsubscribe?: () => void

  constructor(private readonly ports: AiDeferredJobsPorts) {
    const stored = ports.read()
    this.state = stored && Array.isArray(stored.jobs) ? structuredClone(stored) : { version: 1, jobs: [] }
    let changed = false
    const now = this.now()
    // A closed app cannot retain a running exec; its output is gone.
    for (const job of this.state.jobs) {
      if (job.status !== 'running') continue
      job.status = 'failed'
      job.finishedAt = now
      job.error = t('notice.deferredJobClosedInterrupted')
      changed = true
    }
    const retained = this.state.jobs.filter(job => isPending(job) || (job.finishedAt ?? job.createdAt) > now - RETAIN_FINISHED_MS)
    if (retained.length !== this.state.jobs.length) {
      this.state.jobs = retained
      changed = true
    }
    if (changed) this.persist()
  }

  private now() { return this.ports.now?.() ?? Date.now() }

  private persist() {
    this.ports.save(structuredClone(this.state))
    try { this.ports.changed?.() } catch (error) { this.ports.onError?.(error) }
  }

  private find(id: string) { return this.state.jobs.find(job => job.id === id) }

  snapshot(): AiDeferredJob[] { return structuredClone(this.state.jobs) }

  start() {
    if (this.disposed || this.timer) return
    for (const job of this.state.jobs) if (isPending(job)) this.register(job)
    this.unsubscribe = this.ports.runtime.onJobSettled(job => this.settled(job))
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.timer.unref?.()
    this.tick()
  }

  private register(job: AiDeferredJob) {
    try {
      this.ports.runtime.registerScheduledJob({
        jobId: job.id, sessionId: job.sessionId, connectionId: job.connectionId, connectionName: job.connectionName,
        command: job.command, class: job.class, dueAt: job.dueAt, note: job.note, cancel: () => { this.cancel(job.id) },
      })
      if (job.status === 'waiting') this.ports.runtime.setScheduledJobAwaiting(job.id, true)
    } catch (error) { this.ports.onError?.(error) }
  }

  schedule(input: AiDeferredJobInput): AiDeferredJob {
    if (this.disposed) throw new Error('SCHEDULE_UNAVAILABLE')
    const delay = input.startAfterMs
    if (!Number.isInteger(delay) || delay < MCP_SCHEDULE_MIN_DELAY_MS || delay > MCP_SCHEDULE_MAX_DELAY_MS) throw new Error('INVALID_SCHEDULE_DELAY')
    if (this.state.jobs.filter(isPending).length >= MCP_MAX_SCHEDULED_JOBS) throw new Error('SCHEDULE_LIMIT')
    if (this.state.jobs.some(job => isPending(job) && job.historyId === input.historyId && job.threadId === input.threadId
      && job.connectionId === input.connectionId && job.command === input.command)) throw new Error('SCHEDULE_DUPLICATE')
    const now = this.now()
    const note = input.note?.replace(/\s+/g, ' ').trim().slice(0, MCP_SCHEDULE_NOTE_MAX_CHARS)
    const job: AiDeferredJob = {
      id: randomUUID(), historyId: input.historyId, threadId: input.threadId, connectionId: input.connectionId,
      connectionName: input.connectionName, sessionId: input.sessionId, command: input.command, stdin: input.stdin,
      jobTimeoutMs: input.jobTimeoutMs, class: input.class, risk: input.risk, ...(note ? { note } : {}),
      createdAt: now, dueAt: now + delay, status: 'scheduled',
    }
    this.state.jobs.push(job)
    this.register(job)
    this.persist()
    return structuredClone(job)
  }

  /** Cancel a pending job; the settlement reaches the conversation whether or not a window still owns it. */
  cancel(id: string): boolean {
    if (this.disposed) return false
    const job = this.find(id)
    if (!job || !isPending(job)) return false
    job.status = 'cancelled'
    job.finishedAt = this.now()
    this.persist()
    this.settlePending(job, 'cancelled', 'cancelled')
    return true
  }

  /** Due long enough ago without a usable session: tell the conversation instead of running stale work later. */
  private expire(job: AiDeferredJob) {
    job.status = 'expired'
    job.finishedAt = this.now()
    job.error = t('notice.deferredJobExpired', { hours: MCP_SCHEDULE_GRACE_MS / 3_600_000 })
    this.persist()
    this.settlePending(job, 'failed', job.error)
  }

  /**
   * Settle a job that never ran. A window owning the session receives the store
   * settlement through the normal background path; otherwise the result is written
   * into the conversation here, from a local result if the store never held the job.
   */
  private settlePending(job: AiDeferredJob, status: 'cancelled' | 'failed', message: string) {
    const bound = this.ports.execution.bindDeferredJob({ jobId: job.id, sessionId: job.sessionId, historyId: job.historyId, threadId: job.threadId })
    if (bound) this.bound.add(job.id)
    else this.pendingRecords.add(job.id)
    if (status === 'cancelled') this.ports.runtime.cancelJob(job.id)
    else this.ports.runtime.failScheduledJob(job.id, message)
    if (this.pendingRecords.delete(job.id)) {
      this.record(job, {
        jobId: job.id, sessionId: job.sessionId, connectionId: job.connectionId, connectionName: job.connectionName, command: job.command,
        status, startedAt: job.createdAt, finishedAt: job.finishedAt, error: message, class: job.class,
      })
    }
    this.bound.delete(job.id)
  }

  private record(job: AiDeferredJob, result: SshMcpJobResult) {
    const task = this.ports.execution.recordDeferredJobResult({ historyId: job.historyId, threadId: job.threadId, sessionId: job.sessionId }, result)
      .catch(error => this.ports.onError?.(error))
    this.tasks.add(task)
    void task.finally(() => this.tasks.delete(task))
  }

  /** A session for the connection opened: run the jobs that were waiting for it. */
  sessionReady(connectionId: string) {
    if (!this.disposed) this.tick(connectionId)
  }

  tick(connectionId?: string) {
    if (this.disposed) return
    const now = this.now()
    for (const job of [...this.state.jobs]) {
      if (!isPending(job) || (connectionId && job.connectionId !== connectionId) || job.dueAt > now) continue
      if (now - job.dueAt > MCP_SCHEDULE_GRACE_MS) {
        this.expire(job)
        continue
      }
      const sessions = this.ports.runtime.listSessionsForConnection(job.connectionId)
      if (!sessions.length) {
        if (job.status !== 'waiting') {
          job.status = 'waiting'
          this.ports.runtime.setScheduledJobAwaiting(job.id, true)
          this.persist()
        }
        continue
      }
      this.run(job, sessions[sessions.length - 1])
    }
  }

  private run(job: AiDeferredJob, sessionId: string) {
    job.status = 'running'
    job.startedAt = this.now()
    job.sessionId = sessionId
    this.persist()
    if (this.ports.execution.bindDeferredJob({ jobId: job.id, sessionId, historyId: job.historyId, threadId: job.threadId })) this.bound.add(job.id)
    const task = this.ports.runtime.startScheduledJob(job.id, sessionId, { command: job.command, jobTimeoutMs: job.jobTimeoutMs, stdin: job.stdin })
      .then(() => undefined, (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        // Settle the store record so the failure reaches the conversation like any other result.
        this.ports.runtime.failScheduledJob(job.id, message)
        if (job.status === 'running') {
          job.status = 'failed'
          job.finishedAt = this.now()
          job.error = message
          this.persist()
        }
      })
    this.tasks.add(task)
    void task.finally(() => this.tasks.delete(task))
  }

  private settled(result: SshMcpJobResult) {
    const job = this.find(result.jobId)
    if (!job) return
    if (job.status === 'running') {
      job.status = result.status === 'completed' ? 'completed' : result.status === 'cancelled' ? 'cancelled' : 'failed'
      job.finishedAt = this.now()
      if (result.error) job.error = result.error
      this.persist()
    } else if (!this.pendingRecords.delete(job.id)) return
    if (this.bound.delete(job.id)) return
    this.record(job, result)
  }

  async waitForIdle() { await Promise.allSettled([...this.tasks]) }

  /** Stop the clock; pending records stay persisted and are registered again on the next start. */
  dispose() {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }
}
