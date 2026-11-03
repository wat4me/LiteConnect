import { expect, it, vi } from 'vitest'
import { AiDeferredJobs, type AiDeferredJobsSnapshot } from './deferredJobs'
import type { SshMcpJobResult } from '../../../shared/mcp/types'

vi.mock('../../i18n', () => ({ t: (key: string) => key }))

const BASE = 10 * 24 * 60 * 60 * 1000

function harness(initial?: AiDeferredJobsSnapshot, options: { sessions?: Record<string, string[]>; bound?: boolean } = {}) {
  let saved = initial
  let now = BASE
  const settledListeners = new Set<(job: SshMcpJobResult) => void>()
  const registered: string[] = []
  const started: Array<{ jobId: string; sessionId: string }> = []
  const cancelled: string[] = []
  const awaiting: Array<[string, boolean]> = []
  const recorded: SshMcpJobResult[] = []
  const bind = vi.fn(() => options.bound ?? true)
  const failScheduledJob = vi.fn()
  const service = new AiDeferredJobs({
    read: () => saved,
    save: state => { saved = state },
    runtime: {
      registerScheduledJob: input => { registered.push(input.jobId) },
      setScheduledJobAwaiting: (jobId, waiting) => { awaiting.push([jobId, waiting]) },
      startScheduledJob: async (jobId, sessionId) => { started.push({ jobId, sessionId }) },
      failScheduledJob,
      cancelJob: jobId => { cancelled.push(jobId) },
      listSessionsForConnection: connectionId => options.sessions?.[connectionId] ?? [],
      onJobSettled: listener => { settledListeners.add(listener); return () => { settledListeners.delete(listener) } },
    },
    execution: { bindDeferredJob: bind, recordDeferredJobResult: async (_binding, job) => { recorded.push(job) } },
    now: () => now,
  })
  const settle = (job: Partial<SshMcpJobResult> & { jobId: string }) => {
    for (const listener of settledListeners) listener({ sessionId: 's', command: 'c', status: 'completed', startedAt: now, ...job } as SshMcpJobResult)
  }
  return { service, registered, started, cancelled, awaiting, recorded, bind, failScheduledJob, settle, advance: (ms: number) => { now += ms }, saved: () => saved }
}

const input = {
  historyId: 'h', threadId: 't', sessionId: 'session-a', connectionId: 'conn', connectionName: 'Host',
  command: 'df -h', jobTimeoutMs: 60_000, startAfterMs: 120_000, risk: 'read' as const, class: 'read-only' as const,
}

it('registers a scheduled job at once, runs it when due on an open session, and leaves delivery to the bound owner', async () => {
  const h = harness(undefined, { sessions: { conn: ['session-b'] } })
  h.service.start()
  const job = h.service.schedule({ ...input, note: '  re-check   disk  ' })
  expect(job).toMatchObject({ status: 'scheduled', dueAt: BASE + 120_000, note: 're-check disk' })
  expect(h.registered).toEqual([job.id])
  h.service.tick()
  expect(h.started).toEqual([])
  h.advance(120_000)
  h.service.tick()
  await h.service.waitForIdle()
  expect(h.started).toEqual([{ jobId: job.id, sessionId: 'session-b' }])
  expect(h.bind).toHaveBeenCalledWith({ jobId: job.id, sessionId: 'session-b', historyId: 'h', threadId: 't' })
  expect(h.saved()?.jobs[0]).toMatchObject({ status: 'running', sessionId: 'session-b' })
  h.settle({ jobId: job.id, status: 'completed' })
  await h.service.waitForIdle()
  expect(h.saved()?.jobs[0].status).toBe('completed')
  expect(h.recorded).toEqual([])
  h.service.dispose()
})

it('waits for a connection when the host has no session, then runs on the next connection', async () => {
  const sessions: Record<string, string[]> = {}
  const h = harness(undefined, { sessions })
  h.service.start()
  const job = h.service.schedule(input)
  h.advance(120_000)
  h.service.tick()
  expect(h.awaiting).toEqual([[job.id, true]])
  expect(h.saved()?.jobs[0].status).toBe('waiting')
  expect(h.started).toEqual([])
  sessions.conn = ['session-c']
  h.service.sessionReady('other')
  expect(h.started).toEqual([])
  h.service.sessionReady('conn')
  await h.service.waitForIdle()
  expect(h.started).toEqual([{ jobId: job.id, sessionId: 'session-c' }])
  h.service.dispose()
})

it('records an unbound result into the conversation and persists a cancellation before the store settles it', async () => {
  const h = harness(undefined, { sessions: { conn: ['session-b'] }, bound: false })
  h.service.start()
  const job = h.service.schedule(input)
  const other = h.service.schedule({ ...input, command: 'uptime' })
  expect(h.service.cancel(other.id)).toBe(true)
  expect(h.cancelled).toEqual([other.id])
  expect(h.saved()?.jobs.find(item => item.id === other.id)?.status).toBe('cancelled')
  expect(h.service.cancel(other.id)).toBe(false)
  h.advance(120_000)
  h.service.tick()
  await h.service.waitForIdle()
  h.settle({ jobId: job.id, status: 'failed', error: 'boom' })
  await h.service.waitForIdle()
  expect(h.recorded.map(item => [item.jobId, item.status])).toEqual([[other.id, 'cancelled'], [job.id, 'failed']])
  expect(h.saved()?.jobs.find(item => item.id === job.id)).toMatchObject({ status: 'failed', error: 'boom' })
  h.service.dispose()
})

it('settles a job that could not start so its failure still reaches the conversation', async () => {
  const h = harness(undefined, { sessions: { conn: ['session-b'] } })
  h.service.start()
  const job = h.service.schedule(input)
  h.service['ports'].runtime.startScheduledJob = async () => { throw new Error('SESSION_STALE') }
  h.advance(120_000)
  h.service.tick()
  await h.service.waitForIdle()
  expect(h.failScheduledJob).toHaveBeenCalledWith(job.id, 'SESSION_STALE')
  expect(h.saved()?.jobs[0]).toMatchObject({ status: 'failed', error: 'SESSION_STALE' })
  h.service.dispose()
})

it('rejects invalid delays, duplicates and too many pending jobs', () => {
  const h = harness()
  h.service.start()
  expect(() => h.service.schedule({ ...input, startAfterMs: 1000 })).toThrow('INVALID_SCHEDULE_DELAY')
  h.service.schedule(input)
  expect(() => h.service.schedule(input)).toThrow('SCHEDULE_DUPLICATE')
  for (let index = 1; index < 20; index++) h.service.schedule({ ...input, command: `echo ${index}` })
  expect(() => h.service.schedule({ ...input, command: 'echo overflow' })).toThrow('SCHEDULE_LIMIT')
  h.service.dispose()
})

it('recovers after a restart: running jobs fail with a notice, pending jobs are registered again and due ones run', async () => {
  const record = (patch: Partial<AiDeferredJobsSnapshot['jobs'][number]>) => ({
    id: 'x', historyId: 'h', threadId: 't', connectionId: 'conn', sessionId: 's', command: 'a', jobTimeoutMs: 1,
    class: 'read-only' as const, risk: 'read' as const, createdAt: 1, dueAt: 1, status: 'scheduled' as const, ...patch,
  })
  const snapshot: AiDeferredJobsSnapshot = { version: 1, jobs: [
    record({ id: 'was-running', status: 'running', startedAt: 2 }),
    record({ id: 'due', command: 'b', dueAt: BASE - 60_000 }),
    record({ id: 'old-done', command: 'c', status: 'completed', finishedAt: 1 }),
  ] }
  const h = harness(snapshot, { sessions: { conn: ['session-d'] } })
  expect(h.saved()?.jobs.map(job => [job.id, job.status])).toEqual([['was-running', 'failed'], ['due', 'scheduled']])
  expect(h.saved()?.jobs[0].error).toBe('notice.deferredJobClosedInterrupted')
  h.service.start()
  await h.service.waitForIdle()
  expect(h.registered).toEqual(['due'])
  expect(h.started).toEqual([{ jobId: 'due', sessionId: 'session-d' }])
  h.service.dispose()
})

it('expires a job that stayed unreachable past the grace window and reports that instead of running stale work', async () => {
  const sessions: Record<string, string[]> = {}
  const h = harness(undefined, { sessions, bound: false })
  h.service.start()
  const job = h.service.schedule(input)
  h.advance(120_000 + 2 * 60 * 60 * 1000 + 1)
  sessions.conn = ['session-late']
  h.service.sessionReady('conn')
  await h.service.waitForIdle()
  expect(h.started).toEqual([])
  expect(h.failScheduledJob).toHaveBeenCalledWith(job.id, 'notice.deferredJobExpired')
  expect(h.saved()?.jobs[0]).toMatchObject({ status: 'expired', error: 'notice.deferredJobExpired' })
  expect(h.recorded).toEqual([expect.objectContaining({ jobId: job.id, status: 'failed', error: 'notice.deferredJobExpired' })])
  h.service.dispose()
})
