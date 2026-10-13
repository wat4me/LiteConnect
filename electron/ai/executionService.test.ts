import { afterEach, expect, it, vi } from 'vitest'
import type { AiResolvedConfig, AiSessionStore } from '../../shared/types/ai'
import type { SshMcpJobResult } from '../../shared/mcp/types'
import type { SshMcpRuntime } from '../mcp/runtime'
import { AiExecutionService, type AiExecutionRequest } from './executionService'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('./chatStream', async importOriginal => ({ ...await importOriginal<typeof import('./chatStream')>(), runAiChatStream: mocks.run }))

const services: AiExecutionService[] = []
afterEach(() => { services.forEach(service => service.dispose()); services.length = 0; mocks.run.mockReset() })

function setup() {
  const store: AiSessionStore = {
    version: 1, activeThreadId: 'thread-a', defaultContextFiles: [],
    threads: [{ id: 'thread-a', title: '', createdAt: 1, updatedAt: 1, contextFiles: [],
      messages: [{ id: 'user', role: 'user', content: 'inspect this server', createdAt: 1 }] }],
  }
  const config: AiResolvedConfig = { baseUrl: 'https://example.test/v1', apiKey: 'test-only', model: 'test', systemPrompt: '', temperature: 0, toolPermission: 'auto' }
  const jobs = new Map<string, SshMcpJobResult>()
  let settled: (job: SshMcpJobResult) => void = () => {}
  let ready = false
  const unsubscribe = vi.fn()
  const hasSession = vi.fn(() => true)
  const save = vi.fn(async (_history: string, record: any, threadId: string) => {
    expect(ready).toBe(true)
    const thread = store.threads.find(item => item.id === threadId)!
    const index = thread.messages.findIndex(item => item.id === record.id)
    const copy = JSON.parse(JSON.stringify(record))
    if (index < 0) thread.messages.push(copy)
    else thread.messages[index] = copy
  })
  const service = new AiExecutionService({
    settings: { ready: async () => { ready = true }, config: () => config, limits: () => ({}) },
    history: { read: async () => JSON.parse(JSON.stringify(store)), save, checkpoint: vi.fn(), hydrate: vi.fn() },
    runtime: { hasSession, getJobResult: id => jobs.get(id), onJobSettled: callback => { settled = callback; return unsubscribe } } as unknown as SshMcpRuntime,
  })
  services.push(service)
  const request: AiExecutionRequest = {
    requestId: 'service-request', historyId: 'history-a', owner: { id: 'automation:test', kind: 'automation' },
    target: { sessionId: 'ssh-a', threadId: 'thread-a', assistantMessageId: 'assistant-a', createdAt: 2 },
  }
  return { service, request, store, config, save, jobs, hasSession, unsubscribe, settle: (job: SshMcpJobResult) => settled(job) }
}

it('runs and persists with no UI observer and enforces unattended read-only permissions', async () => {
  const { service, request, store, config } = setup()
  mocks.run.mockImplementationOnce(async opts => {
    expect(opts.getToolPermission()).toBe('readonly')
    expect(opts.settings.toolPermission).toBe('readonly')
    expect(opts.onToolApprovalRequested).toBeUndefined()
    config.toolPermission = 'auto'
    expect(opts.getToolPermission()).toBe('readonly')
    opts.emit({ type: 'content', value: 'Server is healthy.' })
    return { content: 'Server is healthy.' }
  })
  const reply = await service.run(request)
  expect(reply.content).toBe('Server is healthy.')
  expect(store.threads[0].messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Server is healthy.', status: 'completed' })
})

it('forwards the bounded foreground-only contract for scheduled runs', async () => {
  const { service, request } = setup()
  mocks.run.mockImplementationOnce(async opts => {
    expect(opts.foregroundOnly).toBe(true)
    expect(opts.getToolPermission()).toBe('readonly')
    return { content: 'done' }
  })
  await service.run({ ...request, foregroundOnly: true })
})

it('resumes an unattended background job without a renderer or event subscription', async () => {
  const { service, request, store, jobs, settle } = setup()
  const job: SshMcpJobResult = { jobId: 'headless-job', sessionId: 'ssh-a', command: 'inspect', status: 'running', startedAt: 2 }
  jobs.set(job.jobId, job)
  mocks.run.mockImplementationOnce(async opts => { opts.onBackgroundJobsStarted([job.jobId]); return { content: 'Inspection started.' } })
    .mockImplementationOnce(async opts => {
      expect(opts.messages.at(-1).content).toContain('server healthy')
      expect(opts.getToolPermission()).toBe('readonly')
      return { content: 'Inspection completed.' }
    })
  await service.run(request)
  Object.assign(job, { status: 'completed', stdout: 'server healthy', exitCode: 0 })
  settle(job)
  await vi.waitFor(() => expect(store.threads[0].messages.at(-1)?.content).toBe('Inspection completed.'))
  expect(mocks.run).toHaveBeenCalledTimes(2)
  expect(store.threads[0].messages.at(-1)?.backgroundNotice).toContain('server healthy')
})

it('observer failures cannot break the execution or its persisted result', async () => {
  const { service, request, store } = setup()
  mocks.run.mockImplementationOnce(async opts => { opts.emit({ type: 'content', value: 'done' }); return { content: 'done' } })
  const fail = () => { throw new Error('view is detached') }
  expect((await service.run(request, { onRecord: fail, onStream: fail })).content).toBe('done')
  expect(store.threads[0].messages.at(-1)?.status).toBe('completed')
})

it('keeps background ownership independent when another caller selects a different thread on the same SSH session', async () => {
  const { service, request, store, jobs, settle } = setup()
  store.threads.push({ id: 'thread-b', title: '', createdAt: 1, updatedAt: 1, contextFiles: [], messages: [{ id: 'user-b', role: 'user', content: 'second task', createdAt: 1 }] })
  const job: SshMcpJobResult = { jobId: 'owned-a', sessionId: 'ssh-a', command: 'inspect', status: 'running', startedAt: 2 }
  jobs.set(job.jobId, job)
  mocks.run.mockImplementationOnce(async opts => { opts.onBackgroundJobsStarted([job.jobId]); return { content: 'A started.' } })
    .mockResolvedValueOnce({ content: 'B completed.' })
    .mockImplementationOnce(async opts => {
      expect(opts.messages[0].content).toBe('inspect this server')
      expect(opts.messages.at(-1).content).toContain('A result')
      return { content: 'A completed.' }
    })
  await service.run(request)
  await service.run({ ...request, requestId: 'caller-b', owner: { id: 'automation:b', kind: 'automation' },
    target: { ...request.target, threadId: 'thread-b', assistantMessageId: 'assistant-b' } })
  settle({ ...job, status: 'completed', stdout: 'A result', exitCode: 0 })
  await vi.waitFor(() => expect(store.threads[0].messages.at(-1)?.content).toBe('A completed.'))
  expect(store.threads[1].messages.at(-1)?.content).toBe('B completed.')
})

it('captures target and owner so caller mutations cannot change execution permissions', async () => {
  const { service, request } = setup()
  mocks.run.mockImplementationOnce(async opts => {
    expect(opts.sessionId).toBe('ssh-a')
    expect(opts.getToolPermission()).toBe('readonly')
    return { content: 'original target inspected' }
  })
  const promise = service.run(request)
  request.owner.kind = 'interactive'
  request.owner.id = 7
  request.target.sessionId = 'ssh-other'
  request.target.threadId = 'other-thread'
  expect((await promise).content).toBe('original target inspected')
})

it('authorizes abort by exact execution owner and prevents late background wakeups', async () => {
  const { service, request, jobs, settle } = setup()
  request.owner = { id: 7, kind: 'interactive' }
  const job: SshMcpJobResult = { jobId: 'later-job', sessionId: 'ssh-a', command: 'inspect', status: 'running', startedAt: 2 }
  jobs.set(job.jobId, job)
  mocks.run.mockImplementationOnce(opts => {
    expect(opts.getToolPermission()).toBe('auto')
    opts.onBackgroundJobsStarted([job.jobId])
    return new Promise(resolve => opts.abortController.signal.addEventListener('abort', () => resolve({ content: '', aborted: true })))
  })
  const promise = service.run(request)
  await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
  expect(service.abort(8, request.requestId)).toBe(false)
  expect(service.resolveApproval(8, request.requestId, 'call', true)).toBe(false)
  expect(service.abort(7, request.requestId)).toBe(true)
  expect((await promise).aborted).toBe(true)
  settle({ ...job, status: 'completed', stdout: 'late' })
  await new Promise(resolve => setTimeout(resolve, 80))
  expect(mocks.run).toHaveBeenCalledOnce()
})

it('serializes a history across callers and releases it after abort', async () => {
  const { service, request } = setup()
  mocks.run.mockImplementationOnce(opts => new Promise(resolve => opts.abortController.signal.addEventListener('abort', () => resolve({ content: '', aborted: true }))))
  const first = service.run(request)
  await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
  await expect(service.run({ ...request, requestId: 'second', owner: { id: 'automation:other', kind: 'automation' } })).rejects.toThrow('already running')
  service.abort(request.owner.id, request.requestId)
  await first
  mocks.run.mockResolvedValueOnce({ content: 'retry completed' })
  expect((await service.run({ ...request, requestId: 'retry' })).content).toBe('retry completed')
})

it('does not recreate a deleted conversation or run against a missing SSH session', async () => {
  const { service, request, store, save, hasSession } = setup()
  hasSession.mockReturnValue(false)
  await expect(service.run(request)).rejects.toThrow('SSH session is unavailable')
  hasSession.mockReturnValue(true)
  store.threads = []
  await expect(service.run({ ...request, requestId: 'missing-thread' })).rejects.toThrow('conversation no longer exists')
  expect(save).not.toHaveBeenCalled()
  expect(mocks.run).not.toHaveBeenCalled()
})

it('disposes runtime subscriptions and rejects new runs after shutdown', async () => {
  const { service, request, unsubscribe } = setup()
  service.dispose()
  expect(unsubscribe).toHaveBeenCalledOnce()
  await expect(service.run(request)).rejects.toThrow('disposed')
})
