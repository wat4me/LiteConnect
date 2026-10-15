import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiAnthropicContentBlock, AiChatMessage, AiResolvedConfig } from '../../shared/types/ai'
import { aggregateAiUsage } from '../../shared/aiUsage'
import { packRequestMessages } from './requestContext'
import { listAiProviderModels, testAiProviderConfig } from './providerService'
import { validateAiSettings } from './settingsValidation'
import { anthropicProvider, getAnthropicMessagesUrl, extractAnthropicUsage } from './providers/anthropic'
const buildAiProviderRequest = anthropicProvider.buildRequest
const parseAiProviderResponse = anthropicProvider.parseResponse
const readAiProviderStream = anthropicProvider.readStream
import { runAiChatCompletion } from './chatCompletion'
import { runAiChatStream } from './chatStream'
import { resolveToolApproval } from './streamControl'
import type { SshMcpRuntime } from '../mcp/runtime'
import type { AiWorkspaceTarget } from '../../shared/aiWorkspace'

const settings: AiResolvedConfig = { protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'fixture-key', model: 'claude-fixture', temperature: 0.7, systemPrompt: 'Manage the selected hosts.', toolPermission: 'readonly' }
const sessionId = 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7'
afterEach(() => vi.unstubAllGlobals())

const thinking: AiAnthropicContentBlock = { type: 'thinking', thinking: 'Inspect each host.', signature: 'opaque+/signature==' }
const redacted: AiAnthropicContentBlock = { type: 'redacted_thinking', data: 'opaque+/encrypted==' }
function stream(blocks: AiAnthropicContentBlock[], stopReason = 'end_turn', stopped = true) {
  const events: unknown[] = [{ type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 1 } } }, { type: 'ping' }]
  blocks.forEach((block, index) => {
    if (block.type === 'text') events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } })
    if (block.type === 'thinking') events.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } }, { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } }, { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } })
    if (block.type === 'redacted_thinking') events.push({ type: 'content_block_start', index, content_block: block })
    if (block.type === 'tool_use') {
      const input = JSON.stringify(block.input)
      events.push({ type: 'content_block_start', index, content_block: { ...block, input: {} } }, { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: input.slice(0, 5) } }, { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: input.slice(5) } })
    }
    events.push({ type: 'content_block_stop', index })
  })
  events.push({ type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 7 } }, { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 9 } })
  if (stopped) events.push({ type: 'message_stop' })
  const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''))
  return new Response(new ReadableStream({ start(controller) { for (let offset = 0; offset < bytes.length; offset += 11) controller.enqueue(bytes.slice(offset, offset + 11)); controller.close() } }))
}
const useTool = (id = 'call-one', command = 'hostname', connectionId?: string): AiAnthropicContentBlock => ({ type: 'tool_use', id, name: 'exec', input: { command, risk: 'read', explanation: 'Inspect selected host', ...(connectionId ? { connectionId } : {}) } })

describe('Anthropic Messages protocol', () => {
  it('normalizes old settings to OpenAI and explicitly selects Claude without guessing model names', () => {
    const validated = validateAiSettings({ providers: [{ id: 'old', baseUrl: 'https://example.test/v1', models: ['claude-fixture'] }, { id: 'claude', baseUrl: settings.baseUrl, protocol: 'anthropic', models: ['claude-fixture'] }] })
    expect(validated.providers.map(provider => provider.protocol)).toEqual(['openai', 'anthropic'])
    expect(() => validateAiSettings({ providers: [{ baseUrl: settings.baseUrl, protocol: 'unknown' }] })).toThrow(/protocol/)
  })
  it.each(['https://api.anthropic.com', 'https://api.anthropic.com/v1/', 'https://api.anthropic.com/v1/messages'])('accepts root, base and complete message URLs: %s', baseUrl => {
    expect(getAnthropicMessagesUrl(baseUrl)).toBe('https://api.anthropic.com/v1/messages')
  })
  it('uses native authentication for provider tests and paginated models without exposing credentials in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: 'claude-a' }], has_more: true, last_id: 'claude-a' }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'claude-b', max_input_tokens: 200000, max_tokens: 8192 }], has_more: false }))
      .mockResolvedValueOnce(Response.json({ type: 'message', content: [{ type: 'text', text: 'pong' }] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await listAiProviderModels(settings)).toEqual([{ id: 'claude-a' }, { id: 'claude-b', contextWindowTokens: 200000 }])
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.anthropic.com/v1/models?after_id=claude-a')
    await testAiProviderConfig(settings)
    const [url, request] = fetchMock.mock.calls[2]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(request.headers).toMatchObject({ 'x-api-key': 'fixture-key', 'anthropic-version': '2023-06-01' })
    expect(request.headers.Authorization).toBeUndefined()
    expect(JSON.parse(request.body)).toMatchObject({ model: 'claude-fixture', max_tokens: 1, stream: false })
  })
  it('converts tools and results, merges user results, and preserves signed blocks through packing', () => {
    const blocks = [thinking, redacted, useTool()]
    const messages: AiChatMessage[] = [{ role: 'user', content: 'inspect' }, { role: 'assistant', content: '', reasoningContent: 'Inspect each host.', anthropicContent: blocks, toolCalls: [{ id: 'call-one', type: 'function', function: { name: 'exec', arguments: JSON.stringify((blocks[2] as any).input) } }] }, { role: 'tool', toolCallId: 'call-one', content: 'host-a' }]
    const packed = packRequestMessages(settings, messages)
    const request = buildAiProviderRequest(settings, packed, { stream: true, includeUsage: true, tools: [{ type: 'function', function: { name: 'exec', description: 'run', parameters: { type: 'object' } } }] })
    const body = JSON.parse(request.body)
    expect(body.system[0]).toMatchObject({ type: 'text', text: settings.systemPrompt, cache_control: { type: 'ephemeral' } })
    expect(body.messages.map((message: any) => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(body.messages[1].content).toEqual(blocks)
    expect(body.messages[2].content).toEqual([{ type: 'tool_result', tool_use_id: 'call-one', content: 'host-a' }])
    expect(body.tools).toEqual([{ name: 'exec', description: 'run', input_schema: { type: 'object' } }])
    expect(body.max_tokens).toBeGreaterThan(0)
    expect(body.stream_options).toBeUndefined()
    expect(body.temperature).toBeUndefined()
  })
  it('converts validated image data to Claude base64 sources', () => {
    const image = { id: 'a'.repeat(64), name: 'a.png', mimeType: 'image/png' as const, width: 1, height: 1, dataUrl: 'data:image/png;base64,YQ==' }
    const body = JSON.parse(buildAiProviderRequest({ ...settings, supportsImages: true }, [{ role: 'user', content: 'inspect', images: [image] }]).body)
    expect(body.messages[0].content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YQ==' } })
    expect(() => buildAiProviderRequest(settings, [{ role: 'user', content: 'inspect', images: [{ ...image, missing: true }] }])).toThrow(/丢失/)
  })
  it('merges cumulative output usage with initial input and never counts cache creation twice', async () => {
    const deltas: any[] = []
    expect((await readAiProviderStream(settings, stream([thinking, redacted, useTool()], 'tool_use'), delta => deltas.push(delta))).anthropicContent).toEqual([thinking, redacted, useTool()])
    expect(deltas.filter(delta => delta.usage).at(-1).usage).toEqual({ promptTokens: 130, cachedPromptTokens: 100, uncachedPromptTokens: 30, cacheCreationPromptTokens: 20, completionTokens: 9, totalTokens: 139 })
    expect(deltas.filter(delta => delta.reasoning).map(delta => delta.reasoning).join('')).toBe('Inspect each host.')
    const usage = aggregateAiUsage([extractAnthropicUsage({ input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 9 }), extractAnthropicUsage({ input_tokens: 5, cache_read_input_tokens: 130, cache_creation_input_tokens: 0, output_tokens: 2 })])
    expect(usage).toMatchObject({ promptTokens: 265, cachedPromptTokens: 230, uncachedPromptTokens: 35, cacheCreationPromptTokens: 20, totalTokens: 276, requestCount: 2 })
  })
  it('normalizes nonstream replies including signed content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ type: 'message', content: [thinking, { type: 'text', text: 'healthy' }], stop_reason: 'end_turn', usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 2 } })))
    const reply = await runAiChatCompletion(settings, [{ role: 'user', content: 'inspect' }])
    expect(reply).toMatchObject({ content: 'healthy', reasoningContent: thinking.thinking, usage: { totalTokens: 12 } })
    expect(reply.apiMessages?.[0].anthropicContent?.[0]).toEqual(thinking)
    expect(parseAiProviderResponse(settings, { content: [{ type: 'text', text: 'partial' }], stop_reason: 'max_tokens' }).finishReason).toBe('max_tokens')
  })
  it('does not hide in-stream API errors or execute tools from incomplete/truncated streams', async () => {
    await expect(readAiProviderStream(settings, new Response('data: {"type":"error","error":{"message":"Overloaded"}}\n\n'), () => {})).rejects.toThrow('Overloaded')
    await expect(readAiProviderStream(settings, stream([useTool()], 'tool_use', false), () => {})).rejects.toThrow(/before completion/)
    await expect(readAiProviderStream(settings, stream([useTool()], 'max_tokens'), () => {})).rejects.toThrow(/output limit/)
    const call = vi.fn(async () => ({ content: '{}', structuredContent: { sessions: [] } }))
    const fetchMock = vi.fn().mockResolvedValue(stream([useTool()], 'tool_use', false))
    vi.stubGlobal('fetch', fetchMock)
    await expect(runAiChatStream({ settings, messages: [{ role: 'user', content: 'inspect' }], sessionId, sshMcpRuntime: { call } as unknown as SshMcpRuntime, requestId: 'native-incomplete', emit: () => {} })).rejects.toThrow(/before completion/)
    expect(call.mock.calls).toHaveLength(1) // Only list_sessions; exec never ran.
    expect(fetchMock).toHaveBeenCalledOnce()
  })
  it.each([true, false])('retains the existing tool confirmation policy: approval=%s', async approved => {
    const requestId = `native-approval-${approved}`
    const tool = useTool('write-tool', 'mkdir /tmp/claude-fixture')
    const fetchMock = vi.fn().mockResolvedValueOnce(stream([thinking, tool], 'tool_use')).mockResolvedValueOnce(stream([{ type: 'text', text: 'done' }]))
    vi.stubGlobal('fetch', fetchMock)
    const call = vi.fn(async (name: string) => name === 'list_sessions' ? { content: '{}', structuredContent: { sessions: [] } } : { content: 'created', isError: false })
    const reply = await runAiChatStream({ settings: { ...settings, toolPermission: 'ask' }, messages: [{ role: 'user', content: 'create a directory' }], sessionId, sshMcpRuntime: { call } as unknown as SshMcpRuntime, requestId,
      emit: event => { if (event.type === 'tool' && event.value.phase === 'ask') queueMicrotask(() => resolveToolApproval(requestId, event.value.id, approved)) },
    })
    expect(reply.toolRuns?.[0].status).toBe(approved ? 'done' : 'denied')
    expect(call).toHaveBeenCalledTimes(approved ? 2 : 1)
    const second = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(second.messages[1].content).toEqual([thinking, tool])
    expect(second.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'write-tool' })
    expect(reply.usage).toMatchObject({ requestCount: 2, totalTokens: 278 })
  })
  it('queries multiple selected hosts and blocks a third host before running its command', async () => {
    const targets: AiWorkspaceTarget[] = ['a', 'b'].map(id => ({ connectionId: id, sessionId: `ssh-${id}`, name: `server-${id}`, host: `${id}.example`, port: 22, username: 'ops' }))
    const blocks = [thinking, redacted, useTool('host-a', 'hostname', 'a'), useTool('host-b', 'hostname', 'b'), useTool('outside', 'hostname', 'c')]
    const fetchMock = vi.fn().mockResolvedValueOnce(stream(blocks, 'tool_use')).mockResolvedValueOnce(stream([{ type: 'text', text: 'A and B checked.' }]))
    vi.stubGlobal('fetch', fetchMock)
    const call = vi.fn(async () => ({ content: 'hostname result', isError: false, structuredContent: {} }))
    const reply = await runAiChatStream({ settings, messages: [{ role: 'user', content: 'inspect both hosts' }], workspaceTargets: targets, sshMcpRuntime: { hasSession: () => true, call } as unknown as SshMcpRuntime, requestId: 'claude-multiple-hosts', emit: () => {} })
    expect(call.mock.calls).toHaveLength(2)
    expect(call).toHaveBeenNthCalledWith(1, 'exec', expect.objectContaining({ sessionId: 'ssh-a' }), expect.anything())
    expect(call).toHaveBeenNthCalledWith(2, 'exec', expect.objectContaining({ sessionId: 'ssh-b' }), expect.anything())
    expect(reply.toolRuns?.map(run => run.status)).toEqual(['done', 'done', 'blocked'])
    const first = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(first.system[0].text).toContain('a.example')
    expect(first.tools.find((tool: any) => tool.name === 'exec').input_schema.required).toContain('connectionId')
    const second = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(second.messages[1].content).toEqual(blocks)
    expect(second.messages[2].content.map((block: any) => block.tool_use_id)).toEqual(['host-a', 'host-b', 'outside'])
    expect(reply.apiMessages?.[0].anthropicContent).toEqual(blocks)
    // Simulate IPC serialization and a later request from the saved transcript.
    const restored = JSON.parse(JSON.stringify(reply.apiMessages))
    const next = JSON.parse(buildAiProviderRequest(settings, packRequestMessages(settings, [{ role: 'user', content: 'inspect both hosts' }, ...restored, { role: 'user', content: 'continue' }]), { tools: [{ type: 'function', function: { name: 'exec', parameters: { type: 'object' } } }] }).body)
    expect(next.messages[1].content).toEqual(blocks)
  })
})
