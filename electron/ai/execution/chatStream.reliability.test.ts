import { afterEach, expect, it, vi } from 'vitest'
import { runAiChatStream } from './chatStream'
import { runPersistedAiReply } from './streamPersistence'
import { runAiChatCompletion } from './chatCompletion'
import { flattenConversationForApi } from '../../../shared/aiMessages'
import { workspaceToolSystemAddendum } from '../../../shared/aiWorkspacePrompt'
import type { AiHistoryRecord, AiResolvedConfig } from '../../../shared/types/ai'
import type { SshMcpRuntime } from '../../mcp/runtime'

const sessionId = 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7'
const settings: AiResolvedConfig = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test', systemPrompt: '', temperature: 0, maxToolRounds: 3, toolPermission: 'auto' }
const messages = [{ role: 'user', content: '修复并验证应用状态' }]
const sse = (delta: object, finishReason?: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`)
const tool = (index: number, command: string, extra: object = {}) => ({ index, id: `call-${index}`, function: { name: 'exec', arguments: JSON.stringify({ command, risk: 'read', explanation: '检查应用状态', ...extra }) } })
const runtime = (call: ReturnType<typeof vi.fn>) => ({ call, hasSession: () => true }) as unknown as SshMcpRuntime
const metadata = { isError: false, content: '{}', structuredContent: { sessions: [] } }
const interruptedBody = () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('stream interrupted')) } }))

afterEach(() => vi.unstubAllGlobals())

it('retains a completed modification when the next model response fails, without a blind completion fallback', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(sse({ tool_calls: [tool(0, 'mkdir /tmp/application', { risk: 'write' })] }))
    .mockResolvedValueOnce(interruptedBody())
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'unverified success' } }] }))
  vi.stubGlobal('fetch', fetcher)
  const call = vi.fn(async (name: string) => name === 'list_sessions' ? metadata : { isError: false, content: '{"exitCode":0}' })
  const records: AiHistoryRecord[] = []
  const result = await runPersistedAiReply({
    target: { sessionId, threadId: 'thread', assistantMessageId: 'reply', createdAt: 1 },
    save: async record => { records.push(record) }, publish: () => {},
    run: (emit, checkpoint) => runAiChatStream({ settings, messages, sessionId, requestId: 'keep-modification', sshMcpRuntime: runtime(call), emit, checkpoint }),
  })
  expect(result.error).toBe(true)
  expect(result.toolRuns?.[0]).toMatchObject({ status: 'done', isError: false })
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(call.mock.calls.filter(([name]) => name === 'exec')).toHaveLength(1)
  expect(result.content).not.toContain('unverified success')
  const next = flattenConversationForApi([{ role: 'user', content: 'repair' }, records.at(-1)!, { role: 'user', content: '继续，先检查实际状态' }])
  expect(next[1].content).toContain('mkdir /tmp/application')
  expect(next[1].content).toContain('tool-returned-result')
  expect(next[1].content).toContain('Do not repeat')
  expect(next.some(message => message.role === 'tool')).toBe(false)
})

it('does not strip already executed tool results when a later request rejects tools', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(sse({ tool_calls: [tool(0, 'hostname')] }))
    .mockResolvedValueOnce(Response.json({ error: { message: 'tools is not supported' } }, { status: 400 }))
  vi.stubGlobal('fetch', fetcher)
  const call = vi.fn(async () => metadata)
  await expect(runAiChatStream({ settings, messages, sessionId, requestId: 'late-tool-rejection', sshMcpRuntime: runtime(call), emit: () => {} })).rejects.toThrow('tools is not supported')
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('records an unexpected failure per server and still executes the other selected server', async () => {
  const targets = ['a', 'b'].map(id => ({ connectionId: id, sessionId: `session-${id}`, name: `server-${id}`, host: `${id}.test`, port: 22, username: 'tester' }))
  const fetcher = vi.fn().mockResolvedValueOnce(sse({ tool_calls: [tool(0, 'hostname', { connectionId: 'a' }), tool(1, 'hostname', { connectionId: 'b' })] }))
    .mockResolvedValueOnce(sse({ content: 'A 结果未知；B 返回了主机名。' }))
  vi.stubGlobal('fetch', fetcher)
  const call = vi.fn(async (_name: string, args: { sessionId: string }) => {
    if (args.sessionId === 'session-a') throw new Error('connection failed unexpectedly')
    return { isError: false, content: 'server-b' }
  })
  const result = await runAiChatStream({ settings, messages, workspaceTargets: targets, requestId: 'partial-host-failure', sshMcpRuntime: runtime(call), emit: () => {} })
  expect(call).toHaveBeenCalledTimes(2)
  expect(result.toolRuns).toEqual([
    expect.objectContaining({ isError: true, target: 'server-a (tester@a.test:22)', content: expect.stringContaining('TOOL_RESULT_UNKNOWN') }),
    expect.objectContaining({ isError: false, target: 'server-b (tester@b.test:22)', content: 'server-b' }),
  ])
  const request = JSON.parse(fetcher.mock.calls[1][1].body)
  expect(request.messages.filter((message: { role: string }) => message.role === 'tool')).toHaveLength(2)
  expect(request.messages.some((message: { content: string | null }) => message.content?.includes('do not assume rollback'))).toBe(true)
})

it('stops remaining tool calls after cancellation and preserves earlier completed operations', async () => {
  const controller = new AbortController()
  const fetcher = vi.fn().mockResolvedValueOnce(sse({ tool_calls: [tool(0, 'mkdir /tmp/first', { risk: 'write' }), tool(1, 'hostname'), tool(2, 'mkdir /tmp/never', { risk: 'write' })] }))
  vi.stubGlobal('fetch', fetcher)
  const call = vi.fn(async (name: string, args: { command: string }) => {
    if (name === 'list_sessions') return metadata
    if (args.command === 'hostname') { controller.abort(); throw new DOMException('stopped', 'AbortError') }
    return { isError: false, content: '{"exitCode":0}' }
  })
  const records: AiHistoryRecord[] = []
  const result = await runPersistedAiReply({
    target: { sessionId, threadId: 'thread', assistantMessageId: 'reply', createdAt: 1 },
    save: async record => { records.push(record) }, publish: () => {},
    run: (emit, checkpoint) => runAiChatStream({ settings, messages, sessionId, requestId: 'cancel-tool-batch', abortController: controller, sshMcpRuntime: runtime(call), emit, checkpoint }),
  })
  expect(result.aborted).toBe(true)
  expect(call.mock.calls.filter(([name]) => name === 'exec').map(([, args]) => args.command)).toEqual(['mkdir /tmp/first', 'hostname'])
  expect(result.toolRuns?.map(run => run.status)).toEqual(['done', 'aborted'])
  const evidence = flattenConversationForApi([records.at(-1)!])[0].content
  expect(evidence).toContain('mkdir /tmp/first')
  expect(evidence).toContain('execution-result-unknown')
  expect(fetcher).toHaveBeenCalledOnce()
})

it.each(['eof', 'length', 'content_filter'])('never executes complete-looking tool arguments from a truncated %s response', async ending => {
  const delta = { tool_calls: [tool(0, 'mkdir /tmp/never', { risk: 'write' })] }
  const response = ending === 'eof'
    ? new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`)
    : sse(delta, ending)
  const fetcher = vi.fn().mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetcher)
  const call = vi.fn(async () => metadata)
  await expect(runAiChatStream({ settings, messages, sessionId, requestId: `truncated-${ending}`, sshMcpRuntime: runtime(call), emit: () => {} })).rejects.toThrow(/未确认回复完整|输出限制/)
  expect(call).toHaveBeenCalledTimes(1) // Only session metadata, no exec.
  expect(fetcher).toHaveBeenCalledOnce()
})

it('accepts a compatible stream with an explicit finish reason even without the DONE sentinel', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}')))
  const result = await runAiChatStream({ settings, messages, requestId: 'finish-without-sentinel', emit: () => {} })
  expect(result.content).toBe('done')
})

it('marks partial text as an error instead of a completed answer when the stream ends unexpectedly', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"partial finding"}}]}\n\n'))
  vi.stubGlobal('fetch', fetcher)
  const records: AiHistoryRecord[] = []
  const result = await runPersistedAiReply({
    target: { sessionId, threadId: 'thread', assistantMessageId: 'reply', createdAt: 1 },
    save: async record => { records.push(record) }, publish: () => {},
    run: emit => runAiChatStream({ settings, messages, requestId: 'truncated-text', emit }),
  })
  expect(result.error).toBe(true)
  expect(result.content).toContain('partial finding')
  expect(records.at(-1)?.status).toBe('error')
  expect(fetcher).toHaveBeenCalledOnce()
})

it('does not mark an empty final response as task completion after a remote operation', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(sse({ tool_calls: [tool(0, 'mkdir /tmp/application', { risk: 'write' })] }))
    .mockResolvedValueOnce(sse({}))
  vi.stubGlobal('fetch', fetcher)
  const call = vi.fn(async () => metadata)
  await expect(runAiChatStream({ settings, messages, sessionId, requestId: 'empty-final', sshMcpRuntime: runtime(call), emit: () => {} })).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(call.mock.calls.filter(([name]) => name === 'exec')).toHaveLength(1)
})

it.each(['length', 'max_tokens', 'content_filter'])('rejects an incomplete nonstream reply ending with %s', async finishReason => {
  const settingsForProtocol = finishReason === 'max_tokens' ? { ...settings, protocol: 'anthropic' as const } : settings
  const body = finishReason === 'max_tokens'
    ? { content: [{ type: 'text', text: 'partial' }], stop_reason: finishReason }
    : { choices: [{ message: { content: 'partial' }, finish_reason: finishReason }] }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(body)))
  await expect(runAiChatCompletion(settingsForProtocol, messages)).rejects.toThrow('输出限制')
})

it('does not execute remote changes when the tool boundary cannot be saved', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(sse({ tool_calls: [tool(0, 'mkdir /tmp/never', { risk: 'write' })] }))
  vi.stubGlobal('fetch', fetcher)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const call = vi.fn(async () => metadata)
  try {
    const result = await runPersistedAiReply({
      target: { sessionId, threadId: 'thread', assistantMessageId: 'reply', createdAt: 1 },
      save: async record => { if (record.toolRuns?.some(run => run.status === 'running')) throw new Error('history disk full') }, publish: () => {},
      run: (emit, checkpoint) => runAiChatStream({ settings, messages, sessionId, requestId: 'failed-boundary', sshMcpRuntime: runtime(call), emit, checkpoint }),
    })
    expect(result.error).toBe(true)
    expect(result.content).toContain('history disk full')
    expect(result.toolRuns?.[0]).toMatchObject({ isError: true, status: 'done', content: expect.stringContaining('TOOL_RESULT_UNKNOWN') })
    expect(call).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledOnce()
  } finally { warn.mockRestore() }
})

it('keeps verification and uncertain-result guidance for every selected server', () => {
  const prompt = workspaceToolSystemAddendum([{ connectionId: 'a', sessionId, name: 'server-a', host: 'a.test', port: 22, username: 'tester' }])
  expect(prompt).toContain('同一台服务器')
  expect(prompt).toContain('尚未验证')
  expect(prompt).toContain('不要假定已回滚')
})
