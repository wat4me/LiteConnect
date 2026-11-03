import { describe, expect, it, vi } from 'vitest'
import { McpJobStore } from './execJobs'

describe('background job status observers', () => {
  it('preserves termination signals in snapshots as well as full job details', () => {
    const store = new McpJobStore()
    const job = store.create({ sessionId: 'A', command: 'inspect', class: 'read-only', cancel: () => {} })
    store.finish(job.jobId, 'completed', { stdout: 'partial', stderr: '', exitCode: null, signal: 'TERM' })
    expect(store.summary(job)).toMatchObject({ signal: 'TERM', exitCode: null })
    expect(store.detail(job)).toMatchObject({ signal: 'TERM', stdout: 'partial' })
  })
  it('reports start, completion and session cancellation without duplicate finishes', () => {
    const store = new McpJobStore()
    const observed: string[][] = []
    const unsubscribe = store.onChanged(() => observed.push(store.list().map(job => job.status)))
    const cancel = vi.fn()
    const input = { sessionId: 'A', command: 'sleep 5', class: 'read-only' as const, cancel }
    const completed = store.create(input)
    store.finish(completed.jobId, 'completed')
    store.finish(completed.jobId, 'failed')
    const running = store.create(input)
    store.cancelForSession('A')
    expect(observed).toHaveLength(4)
    expect(store.get(running.jobId)?.status).toBe('cancelled')
    expect(cancel).toHaveBeenCalledOnce()
    unsubscribe()
    store.create(input)
    expect(observed).toHaveLength(4)
  })
  it('does not let an observer failure prevent a job from finishing', () => {
    const store = new McpJobStore()
    store.onChanged(() => { throw new Error('closed window') })
    const job = store.create({ sessionId: 'A', command: 'echo ok', class: 'read-only', cancel: () => {} })
    expect(() => store.finish(job.jobId, 'failed')).not.toThrow()
    expect(store.get(job.jobId)?.status).toBe('failed')
  })
})

describe('scheduled jobs', () => {
  it('keeps a scheduled job visible until it starts, then runs it under the same id', () => {
    const store = new McpJobStore()
    const cancel = vi.fn()
    const scheduled = store.createScheduled({ jobId: 'later', sessionId: 'A', command: 'df -h', class: 'read-only', dueAt: 123, note: 'recheck disk', cancel })
    expect(store.summary(scheduled)).toMatchObject({ jobId: 'later', status: 'scheduled', dueAt: 123, note: 'recheck disk' })
    store.setAwaitingConnection('later', true)
    expect(store.summary(store.get('later')!).awaitingConnection).toBe(true)
    expect(store.list().map(job => job.jobId)).toEqual(['later'])
    const started = store.start('later', { sessionId: 'B', connectionName: 'host-b', cancel: () => {} })
    expect(started).toMatchObject({ jobId: 'later', status: 'running', sessionId: 'B', connectionName: 'host-b' })
    expect(store.summary(started!).awaitingConnection).toBeUndefined()
    expect(store.start('later', { sessionId: 'B', cancel: () => {} })).toBeUndefined()
    store.finish('later', 'completed', { stdout: 'ok', stderr: '', exitCode: 0 })
    expect(store.get('later')?.status).toBe('completed')
    expect(cancel).not.toHaveBeenCalled()
  })
  it('cancels a pending scheduled job through its hook and settles it, while session teardown leaves it waiting', () => {
    const store = new McpJobStore()
    const settled: string[] = []
    store.onSettled(job => settled.push(`${job.jobId}:${job.status}`))
    const cancel = vi.fn()
    store.createScheduled({ jobId: 'pending', sessionId: 'A', command: 'uptime', class: 'read-only', dueAt: 5, cancel })
    expect(store.cancel('pending')).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
    expect(store.get('pending')?.status).toBe('cancelled')
    expect(settled).toEqual(['pending:cancelled'])
    store.createScheduled({ jobId: 'waiting', sessionId: 'A', command: 'uptime', class: 'read-only', dueAt: 5, cancel: () => {} })
    store.cancelForSession('A')
    expect(store.get('waiting')?.status).toBe('scheduled')
    expect(store.createScheduled({ jobId: 'waiting', sessionId: 'A', command: 'other', class: 'read-only', dueAt: 9, cancel: () => {} }).command).toBe('uptime')
  })
})
