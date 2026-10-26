import { afterEach, expect, it, vi } from 'vitest'
import type { AiResolvedConfig, AiSessionStore } from '../../../shared/types/ai'
import type { SshMcpJobResult } from '../../../shared/mcp/types'
import type { SshMcpRuntime } from '../../mcp/runtime'
import { AiExecutionService, type AiExecutionRequest } from './executionService'
import { waitForUserAnswer } from '../tools/streamControl'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('./chatStream', async importOriginal => ({ ...await importOriginal<typeof import('./chatStream')>(), runAiChatStream: mocks.run }))

const services: AiExecutionService[] = []
afterEach(() => { services.forEach(service => service.dispose()); services.length = 0; mocks.run.mockReset(); vi.unstubAllGlobals() })

function setup(workspaceTargets?: import('./executionService').AiExecutionPorts['workspaceTargets'], workspaceOwned?: import('./executionService').AiExecutionPorts['workspaceOwned']) {
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
  const hasSession = vi.fn((_id: string) => true)
  const save = vi.fn(async (_history: string, record: any, threadId: string) => {
    expect(ready).toBe(true)
    const thread = store.threads.find(item => item.id === threadId)!
    const index = thread.messages.findIndex(item => item.id === record.id)
    const copy = JSON.parse(JSON.stringify(record))
    if (index < 0) thread.messages.push(copy)
    else thread.messages[index] = copy
  })
  const service = new AiExecutionService({
    workspaceTargets, workspaceOwned,
    settings: { ready: async () => { ready = true }, config: () => config, limits: () => ({}) },
    history: { read: async () => JSON.parse(JSON.stringify(store)), save, checkpoint: vi.fn(), hydrate: vi.fn() },
    runtime: { hasSession, getJobResult: (id: string) => jobs.get(id), onJobSettled: (callback: (job: SshMcpJobResult) => void) => { settled = callback; return unsubscribe } } as unknown as SshMcpRuntime,
  })
  services.push(service)
  const request: AiExecutionRequest = {
    requestId: 'service-request', historyId: 'history-a', owner: { id: 'automation:test', kind: 'automation' },
    target: { sessionId: 'ssh-a', threadId: 'thread-a', assistantMessageId: 'assistant-a', createdAt: 2 },
  }
  return { service, request, store, config, save, jobs, hasSession, unsubscribe, settle: (job: SshMcpJobResult) => settled(job) }
}

it.each([false, true])('saves cancellation without waking the model (%s while launch is still running)', async duringLaunch => {
  const { service, request, store, jobs, settle } = setup()
  const job: SshMcpJobResult = { jobId: 'cancelled-job', sessionId: 'ssh-a', command: 'inspect', status: 'running', startedAt: 1 }
  jobs.set(job.jobId, job)
  mocks.run.mockImplementationOnce(async opts => {
    opts.onBackgroundJobsStarted([job.jobId])
    if (duringLaunch) settle({ ...job, status: 'cancelled', finishedAt: 3, error: 'cancelled' })
    opts.emit({ type: 'tool', value: { id: 'launch', name: 'exec', phase: 'done', args: '{"command":"inspect"}',
      content: '{"jobId":"cancelled-job","status":"running"}', jobIds: [job.jobId] } })
    return { content: 'Started.' }
  })
  const onRecord = vi.fn()
  await service.run(request, { onRecord })
  if (!duringLaunch) settle({ ...job, status: 'cancelled', finishedAt: 3, error: 'cancelled' })
  await service.waitForIdle()
  expect(mocks.run).toHaveBeenCalledOnce()
  const result = store.threads[0].messages.find(message => message.id === 'ai-job-result-cancelled-job')!
  expect(result.backgroundNotice).toContain('"status":"cancelled"')
  expect(result.status).toBe('completed')
  expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ passive: true, trigger: 'background', record: result }))
  expect(store.threads[0].messages.find(message => message.id === 'assistant-a')?.content).toBe('Started.')
})

it('does not restore a cleared conversation when cancellation persistence is pending', async () => {
  const { service, request, store, jobs, settle } = setup()
  const job: SshMcpJobResult = { jobId: 'cleared-job', sessionId: 'ssh-a', command: 'inspect', status: 'running', startedAt: 1 }
  jobs.set(job.jobId, job)
  mocks.run.mockImplementationOnce(async opts => {
    opts.onBackgroundJobsStarted([job.jobId])
    opts.emit({ type: 'tool', value: { id: 'launch', name: 'exec', phase: 'done', args: '{}',
      content: '{"jobId":"cleared-job","status":"running"}', jobIds: [job.jobId] } })
    return { content: 'Started.' }
  })
  await service.run(request)
  settle({ ...job, status: 'cancelled' })
  store.threads[0].messages = []
  await service.waitForIdle()
  expect(store.threads[0].messages).toEqual([])
  expect(mocks.run).toHaveBeenCalledOnce()
})

it('drains an aborted stream through its final persisted record before reporting idle', async () => {
  const { service, request, store, save } = setup()
  let finishSave!: () => void
  const finalSave = new Promise<void>(resolve => { finishSave = resolve })
  const originalSave = save.getMockImplementation()!
  save.mockImplementation(async (...args) => {
    await originalSave(...args)
    if (args[1].status === 'aborted') await finalSave
  })
  mocks.run.mockImplementationOnce(async opts => {
    opts.emit({ type: 'content', value: 'partial reply' })
    return new Promise((_resolve, reject) => opts.abortController.signal.addEventListener('abort', () => reject(opts.abortController.signal.reason), { once: true }))
  })
  const running = service.run(request)
  await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
  service.dispose()
  await expect(service.run({ ...request, requestId: 'late' })).rejects.toThrow('disposed')
  let idle = false
  const draining = service.waitForIdle().then(() => { idle = true })
  await vi.waitFor(() => expect(store.threads[0].messages.at(-1)?.status).toBe('aborted'))
  expect(idle).toBe(false)
  finishSave()
  expect(await running).toMatchObject({ aborted: true, content: 'partial reply' })
  await draining
  expect(idle).toBe(true)
})

it('seals persistence at the shutdown deadline even if a provider ignores cancellation', async () => {
  const { service, request, save } = setup()
  let finish!: () => void
  mocks.run.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ content: 'late reply' }) }))
  const running = service.run(request)
  await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
  service.dispose()
  service.sealPersistence()
  const writes = save.mock.calls.length
  finish()
  await running
  await service.waitForIdle()
  expect(save).toHaveBeenCalledTimes(writes)
})

it('cancels and drains a running background continuation without starting another reply', async () => {
  const { service, request, jobs, settle, store } = setup()
  const job: SshMcpJobResult = { jobId: 'shutdown-job', sessionId: 'ssh-a', command: 'inspect', status: 'running', startedAt: 1 }
  jobs.set(job.jobId, job)
  mocks.run.mockImplementationOnce(async opts => {
    opts.onBackgroundJobsStarted([job.jobId])
    return { content: 'started' }
  }).mockImplementationOnce(async opts => {
    opts.emit({ type: 'content', value: 'background partial' })
    return new Promise((_resolve, reject) => opts.abortController.signal.addEventListener('abort', () => reject(opts.abortController.signal.reason), { once: true }))
  })
  await service.run(request)
  const completed = { ...job, status: 'completed' as const, stdout: 'done', exitCode: 0 }
  jobs.set(job.jobId, completed)
  settle(completed)
  await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2))
  service.dispose()
  settle(completed)
  await service.waitForIdle()
  expect(store.threads[0].messages.at(-1)).toMatchObject({ content: 'background partial', status: 'aborted' })
  expect(mocks.run).toHaveBeenCalledTimes(2)
})

it('runs and persists with no UI observer and enforces unattended read-only permissions', async () => {
  const { service, request, store, config } = setup()
  mocks.run.mockImplementationOnce(async opts => {
    expect(opts.getToolPermission()).toBe('readonly')
    expect(opts.allowQuestions).toBe(false)
    expect(opts.settings.toolPermission).toBe('readonly')
    expect(opts.onToolApprovalRequested).toBeUndefined()
    expect(opts.transferContext).toBeUndefined()
    config.toolPermission = 'auto'
    expect(opts.getToolPermission()).toBe('readonly')
    opts.emit({ type: 'content', value: 'Server is healthy.' })
    return { content: 'Server is healthy.' }
  })
  const reply = await service.run(request)
  expect(reply.content).toBe('Server is healthy.')
  expect(store.threads[0].messages.at(-1)).toMatchObject({ role: 'assistant', content: 'Server is healthy.', status: 'completed' })
})

it('binds transfer UI routing to the interactive owner and exact conversation thread', async () => {
  const { service, request } = setup()
  request.owner = { id: 5, kind: 'interactive' }
  mocks.run.mockImplementationOnce(async opts => {
    expect(opts.transferContext).toEqual({ ownerId: 5, conversationId: 'ssh-a', threadId: 'thread-a' })
    return { content: 'done' }
  })
  await service.run(request)
})

it('manual compaction shares the execution lock and creates no chat record', async () => {
  const { service, request, store, save } = setup()
  store.threads[0].messages = [
    { id: 'u1', role: 'user', content: '检查配置，保留用户约束。'.repeat(100), createdAt: 1 },
    { id: 'a1', role: 'assistant', content: '已读取配置，未修改。'.repeat(100), status: 'completed', createdAt: 2 },
    { id: 'u2', role: 'user', content: '继续检查', createdAt: 3 },
  ]
  const original = structuredClone(store.threads[0].messages)
  let complete!: (response: Response) => void
  const fetching = new Promise<Response>(resolve => { complete = resolve })
  const fetcher = vi.fn(() => fetching)
  vi.stubGlobal('fetch', fetcher)
  const pending = service.run({ ...request, owner: { id: 1, kind: 'interactive' }, target: { ...request.target, compactOnly: true } })
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  await expect(service.run({ ...request, requestId: 'competing' })).rejects.toThrow('already running')
  complete(Response.json({ choices: [{ message: { content: '目标：继续；配置已读取，尚未修改。' }, finish_reason: 'stop' }] }))
  const result = await pending
  expect(result.contextCompacted).toBe(true)
  expect(result.contextCheckpoint?.throughMessageId).toBe('a1')
  expect(result.contextPressure?.usedTokens).toBeGreaterThan(0)
  expect(save).not.toHaveBeenCalled()
  expect(mocks.run).not.toHaveBeenCalled()
  expect(store.threads[0].messages).toEqual(original)
})

it('accepts a question answer only from its active interactive owner', async () => {
  const { service, request } = setup()
  request.owner = { id: 7, kind: 'interactive' }
  mocks.run.mockImplementationOnce(async opts => {
    expect(opts.allowQuestions).toBe(true)
    const answer = await waitForUserAnswer(request.requestId, 'question', [{ id: 'scope', question: '哪个环境？' }], opts.abortController.signal)
    return { content: JSON.stringify(answer) }
  })
  const pending = service.run(request)
  await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce())
  const answer = { cancelled: false, answers: [{ id: 'scope', selected: [], text: '测试环境' }] }
  expect(service.answerQuestion(8, request.requestId, 'question', answer)).toBe(false)
  expect(service.answerQuestion(7, request.requestId, 'other', answer)).toBe(false)
  expect(service.answerQuestion(7, request.requestId, 'question', answer)).toBe(true)
  expect((await pending).content).toContain('测试环境')
  expect(service.answerQuestion(7, request.requestId, 'question', answer)).toBe(false)
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


it('routes a workspace execution and background completion through its saved scope instead of the virtual session id', async () => {
  const targets = ['a', 'b'].map(id => ({ connectionId: id, sessionId: `ssh-${id}`, name: id, host: `${id}.example`, port: 22, username: 'ops' }))
  const resolver = vi.fn((session: string, owner: number | string) => {
    if (session !== 'workspace:one') return undefined
    if (owner !== 1) throw new Error('not owned')
    return targets
  })
  const { service, request, jobs, settle, hasSession, store } = setup(resolver)
  request.owner = { id: 1, kind: 'interactive' }
  request.target.sessionId = 'workspace:one'
  hasSession.mockImplementation((id: string) => id === 'ssh-a' || id === 'ssh-b')
  const job: SshMcpJobResult = { jobId: 'host-b-job', sessionId: 'ssh-b', command: 'inspect B', status: 'running', startedAt: 2 }
  const outside: SshMcpJobResult = { ...job, jobId: 'outside-job', sessionId: 'ssh-c' }
  jobs.set(job.jobId, job); jobs.set(outside.jobId, outside)
  mocks.run.mockImplementationOnce(async opts => {
    expect(opts.workspaceTargets).toEqual(targets)
    opts.onBackgroundJobsStarted([job.jobId, outside.jobId])
    return { content: 'started B' }
  }).mockImplementationOnce(async opts => {
    expect(opts.sessionId).toBe('workspace:one')
    expect(opts.messages.at(-1).content).toContain('"connectionId":"b"')
    expect(opts.messages.at(-1).content).not.toContain('outside-job')
    return { content: 'B completed' }
  })
  await service.run(request)
  Object.assign(job, { status: 'completed', stdout: 'B output' })
  settle({ ...outside, status: 'completed' }); settle(job)
  await vi.waitFor(() => expect(store.threads[0].messages.at(-1)?.content).toBe('B completed'))
  expect(mocks.run).toHaveBeenCalledTimes(2)
  await expect(service.run({ ...request, requestId: 'unowned', owner: { id: 2, kind: 'interactive' } })).rejects.toThrow('not owned')
  expect(mocks.run).toHaveBeenCalledTimes(2)
})


it('retains a scoped completion while another selected host is disconnected, then resumes after reconnect', async () => {
  let connected = true
  const targets = ['a', 'b'].map(id => ({ connectionId: id, sessionId: `ssh-${id}`, name: id, host: `${id}.example`, port: 22, username: 'ops' }))
  const { service, request, jobs, settle, store } = setup(() => {
    if (!connected) throw new Error('selected server disconnected')
    return targets
  }, () => true)
  request.owner = { id: 1, kind: 'interactive' }
  request.target.sessionId = 'workspace:one'
  const job: SshMcpJobResult = { jobId: 'retained', sessionId: 'ssh-b', command: 'inspect B', status: 'running', startedAt: 1 }
  jobs.set(job.jobId, job)
  mocks.run.mockImplementationOnce(async opts => { opts.onBackgroundJobsStarted([job.jobId]); return { content: 'started' } })
    .mockImplementationOnce(async opts => {
      expect(opts.messages.at(-1).content).toContain('"connectionId":"b"')
      return { content: 'retained result delivered' }
    })
  await service.run(request)
  connected = false
  settle({ ...job, status: 'completed', stdout: 'B finished' })
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(mocks.run).toHaveBeenCalledTimes(1)
  targets[1].sessionId = 'reconnected-b'
  connected = true
  service.selectConversation(1, 'workspace:one', request.target.threadId)
  await vi.waitFor(() => expect(store.threads[0].messages.at(-1)?.content).toBe('retained result delivered'))
})
