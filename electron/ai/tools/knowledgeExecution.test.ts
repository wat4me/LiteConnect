import { afterEach, expect, it, vi } from 'vitest'
import { executeAiToolCall } from './toolExecution'
import type { AiToolExecutionContext } from './toolExecutionContext'
import type { AiKnowledgeAccess } from '../../../shared/aiKnowledge'
import { createAiStreamControl, resolveToolApproval } from './streamControl'
import { buildAiRequestEnvironment } from '../execution/requestContext'
import { runAiChatStream } from '../execution/chatStream'
import { AiKnowledgeService } from '../knowledge/knowledgeService'
import type { AiResolvedConfig } from '../../../shared/types/ai'
import type { SshMcpRuntime } from '../../mcp/runtime'

vi.mock('electron', () => ({ app: { getPath: () => 'C:/fixture' } }))
afterEach(() => vi.unstubAllGlobals())
const call = (name = 'knowledge_save') => ({ id: 'knowledge-1', type: 'function' as const, function: { name, arguments: JSON.stringify({ risk: 'read', explanation: 'Remember the confirmed service path.', title: 'Service', content: '/opt/app', expectedRevision: 0 }) } })
function setup(mode: 'readonly' | 'ask' | 'auto') {
  const save = vi.fn(async () => ({ isError: false, content: '{"saved":true,"documentId":"doc","connectionId":"host-a"}' }))
  const remote = vi.fn()
  const context = { requestId: 'knowledge-permission', boundSessionId: 'ssh-a', sshMcpRuntime: { call: remote },
    signal: new AbortController().signal, send: vi.fn(), getToolPermission: () => mode, availableTools: new Set(['knowledge_save', 'knowledge_read']), knowledge: { call: save } } as unknown as AiToolExecutionContext
  return { context, save, remote }
}
it('blocks understated local writes in readonly mode without routing to SSH', async () => {
  const { context, save, remote } = setup('readonly')
  expect((await executeAiToolCall(call(), context))?.run.status).toBe('blocked')
  expect(save).not.toHaveBeenCalled()
  expect(remote).not.toHaveBeenCalled()
})
it('uses the actual write risk in automatic mode and preserves the saved document locator', async () => {
  const { context, save, remote } = setup('auto')
  const result = await executeAiToolCall(call(), context)
  expect(save).toHaveBeenCalledOnce()
  expect(remote).not.toHaveBeenCalled()
  expect(result?.run).toMatchObject({ status: 'done', risk: 'write', isError: false })
  expect(JSON.parse(result!.run.content)).toMatchObject({ documentId: 'doc', connectionId: 'host-a' })
})
it('waits for approval before writing and supports denial', async () => {
  const { context, save } = setup('ask')
  const control = createAiStreamControl(context.requestId, 7)
  context.signal = control.controller.signal
  try {
    const waiting = executeAiToolCall(call(), context)
    await vi.waitFor(() => expect(context.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool', value: expect.objectContaining({ phase: 'ask', risk: 'write' }) })))
    expect(save).not.toHaveBeenCalled()
    expect(resolveToolApproval(context.requestId, 'knowledge-1', false, 7)).toBe(true)
    expect((await waiting)?.run.status).toBe('denied')
    expect(save).not.toHaveBeenCalled()
  } finally { control.cleanup() }
})
it('does not make local reads use a remote session or grant writes', async () => {
  const { context, save, remote } = setup('readonly')
  expect((await executeAiToolCall(call('knowledge_read'), context))?.run.status).toBe('done')
  expect(save).toHaveBeenCalledOnce()
  expect(remote).not.toHaveBeenCalled()
})
it('adds bounded knowledge context and tools only after the server is enabled', async () => {
  const runtime = { call: vi.fn(async () => ({ structuredContent: { sessions: [] } })) } as unknown as NonNullable<Parameters<typeof buildAiRequestEnvironment>[0]['sshMcpRuntime']>
  const prompt = vi.fn(async () => '')
  const options = { sessionId: '550e8400-e29b-41d4-a716-446655440000', sshMcpRuntime: runtime, knowledge: { prompt } as unknown as AiKnowledgeAccess }
  expect((await buildAiRequestEnvironment(options)).tools?.some(tool => tool.function.name === 'knowledge_save')).toBe(false)
  prompt.mockResolvedValue('Host A: service path /opt/app')
  const environment = await buildAiRequestEnvironment(options)
  expect(environment.extraSystem).toContain('/opt/app')
  expect(environment.tools?.filter(tool => tool.function.name.startsWith('knowledge_'))).toHaveLength(3)
})

it('completes a conversation through tool loading, knowledge reads, approved saves and persisted local revisions', async () => {
  const targets = [{ connectionId: 'host-a', name: 'Host A', host: 'a.test', port: 22, username: 'ops' }]
  const records = new Map<string, unknown>()
  const knowledge = new AiKnowledgeService(() => targets, () => ({
    getSingleton: <T>(key: string) => structuredClone(records.get(key)) as T | undefined,
    setSingleton: (key: string, value: unknown) => { records.set(key, structuredClone(value)) },
    transaction: <T>(work: () => T) => work(),
  }), '/profile/app.sqlite').access('fixture', 7)
  const binding = (await knowledge.manage({ action: 'overview' })).targets[0].binding
  await knowledge.manage({ action: 'enable', connectionId: 'host-a', binding, enabled: true })
  const source = (await knowledge.manage({ action: 'save', connectionId: 'host-a', binding, expectedRevision: 0, title: 'Application paths', content: 'Confirmed path: /srv/app' })).document!
  await knowledge.manage({ action: 'save', connectionId: 'host-a', binding, documentId: 'memory', expectedRevision: 1, title: 'MEMORY.md', content: 'Confirmed path: /opt/app' })
  let id = 0
  const response = (name?: string, args?: object) => new Response(`data: ${JSON.stringify({ choices: [{ delta: name ? { tool_calls: [{ index: 0, id: `call-${id++}`, function: { name, arguments: JSON.stringify(args) } }] } : { content: 'Saved the confirmed service path.' } }] })}\n\ndata: [DONE]\n\n`)
  const fetcher = vi.fn().mockResolvedValueOnce(response('load_tools', { groups: ['file_transfer'] }))
    .mockResolvedValueOnce(response('knowledge_read', { connectionId: 'host-a', documentId: 'memory', risk: 'read', explanation: '读取现有服务器知识，保留其他信息。' }))
    .mockResolvedValueOnce(response('knowledge_save', { connectionId: 'host-a', documentId: 'memory', expectedRevision: 2, title: 'MEMORY.md', memoryEntries: [{ text: 'Confirmed path: /srv/app', documentIds: [source.id] }], risk: 'read', explanation: '保存用户确认的新路径。' }))
    .mockResolvedValueOnce(response())
  vi.stubGlobal('fetch', fetcher)
  const remote = vi.fn(async () => ({ isError: false, content: '{}', structuredContent: { sessions: [] } }))
  const settings: AiResolvedConfig = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test', systemPrompt: '', toolPermission: 'ask' }
  const approved = vi.fn(({ requestId, callId }: { requestId: string; callId: string }) => {
    expect(resolveToolApproval(requestId, callId, true)).toBe(true)
  })
  const reply = await runAiChatStream({ requestId: 'knowledge-flow', settings, messages: [{ role: 'user', content: '记住我确认的新路径 /srv/app。' }],
    workspaceTargets: [{ ...targets[0], sessionId: 'd92f01d3-8124-4491-9104-b251e788d812' }], emit: () => {}, knowledge,
    sshMcpRuntime: { call: remote } as unknown as SshMcpRuntime, onToolApprovalRequested: approved,
  })
  expect(approved).toHaveBeenCalledOnce()
  expect(remote).not.toHaveBeenCalled()
  const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(init.body))
  expect(bodies[0].messages[0].content).toContain('/opt/app')
  expect(bodies.every(body => body.tools.some((tool: { function: { name: string } }) => tool.function.name === 'knowledge_save'))).toBe(true)
  expect(bodies[1].tools.some((tool: { function: { name: string } }) => tool.function.name === 'upload_file')).toBe(true)
  expect(reply.toolRuns?.at(-1)).toMatchObject({ name: 'knowledge_save', target: 'Host A', risk: 'write', status: 'done', isError: false })
  expect(JSON.parse(reply.toolRuns!.at(-1)!.content)).toMatchObject({ connectionId: 'host-a', documentId: 'memory', revision: 3, saved: true })
  expect((await knowledge.manage({ action: 'read', connectionId: 'host-a', documentId: 'memory' })).document).toMatchObject({ revision: 3, content: '- Confirmed path: /srv/app', memoryEntries: [{ text: 'Confirmed path: /srv/app', documentIds: [source.id] }], author: 'ai' })
  fetcher.mockResolvedValueOnce(response('knowledge_read', { connectionId: 'host-a', documentId: source.id, risk: 'read', explanation: '按摘要关联读取服务路径的最新依据。' })).mockResolvedValueOnce(response())
  const followup = await runAiChatStream({ requestId: 'knowledge-followup', settings: { ...settings, toolPermission: 'readonly' }, messages: [{ role: 'user', content: '应用部署路径在哪？' }],
    workspaceTargets: [{ ...targets[0], sessionId: 'd92f01d3-8124-4491-9104-b251e788d812' }], emit: () => {}, knowledge, sshMcpRuntime: { call: remote } as unknown as SshMcpRuntime,
  })
  const nextBody = JSON.parse(fetcher.mock.calls[4][1].body)
  expect(nextBody.messages[0].content).toContain(JSON.stringify({ documentId: source.id, title: 'Application paths', revision: 1 }))
  expect(nextBody.messages[0].content).toContain('use sufficient self-contained notes directly')
  expect(followup.toolRuns).toEqual([expect.objectContaining({ name: 'knowledge_read', isError: false, content: expect.stringContaining('/srv/app') })])
  expect(remote).not.toHaveBeenCalled()
  await knowledge.manage({ action: 'save', connectionId: 'host-a', binding, title: 'Environment', content: 'This is a test environment.', alwaysInclude: true, expectedRevision: 0 })
  fetcher.mockResolvedValueOnce(response())
  const direct = await runAiChatStream({ requestId: 'knowledge-direct', settings: { ...settings, toolPermission: 'readonly' }, messages: [{ role: 'user', content: '这是测试环境吗？' }],
    workspaceTargets: [{ ...targets[0], sessionId: 'd92f01d3-8124-4491-9104-b251e788d812' }], emit: () => {}, knowledge, sshMcpRuntime: { call: remote } as unknown as SshMcpRuntime,
  })
  expect(JSON.parse(fetcher.mock.calls[6][1].body).messages[0].content).toContain('This is a test environment.')
  expect(direct.toolRuns?.length || 0).toBe(0)
  expect(remote).not.toHaveBeenCalled()
})
