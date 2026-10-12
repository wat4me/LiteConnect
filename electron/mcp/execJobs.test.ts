import { describe, expect, it, vi } from 'vitest'
import { McpJobStore } from './execJobs'

describe('background job status observers', () => {
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
