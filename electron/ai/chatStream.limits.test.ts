import { afterEach, expect, it, vi } from 'vitest'
import { runAiChatStream } from './chatStream'
import {
  MAX_AI_TOOL_CALLS_PER_TURN,
  MAX_AI_TURN_API_MESSAGES,
  normalizeAiToolRounds,
} from '../../shared/aiToolLimits'
import { validateAiSettings } from './providerHttp'
import type { SshMcpRuntime } from '../mcp/runtime'
const settings = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test', systemPrompt: '', temperature: 0, maxToolRounds: 2 }
const sse = (delta: object) => new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
const toolDelta = { tool_calls: [{ index: 0, id: 'call', function: { name: 'list_sessions', arguments: JSON.stringify({ risk: 'read', explanation: '查看当前会话' }) } }] }
afterEach(() => vi.unstubAllGlobals())
it.each([1, 2, 9])('pauses visibly after exactly %s rounds and retains tool results', async limit => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(sse(toolDelta)))
  vi.stubGlobal('fetch', fetcher)
  const events: any[] = []
  const result = await runAiChatStream({
    settings: { ...settings, maxToolRounds: limit }, messages: [{ role: 'user', content: 'investigate' }], requestId: `limit-${limit}`,
    sessionId: 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7',
    sshMcpRuntime: { call: vi.fn().mockResolvedValue({ isError: false, content: 'results', structuredContent: { sessions: [] } }) } as unknown as SshMcpRuntime,
    emit: event => events.push(event),
  })
  expect(fetcher).toHaveBeenCalledTimes(limit)
  expect(result.toolRuns).toHaveLength(limit)
  expect(result.content).toContain('调查已暂停')
  expect(events.some(e => e.type === 'content' && e.value.includes('调查已暂停'))).toBe(true)
  expect(result.apiMessages?.filter(m => m.role === 'tool')).toHaveLength(limit)
  expect(result.apiMessages?.at(-1)?.content).toContain('调查已暂停')
})
it('does not report a limit when the model completes normally', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sse(toolDelta)).mockResolvedValueOnce(sse({ content: 'finished' })))
  const result = await runAiChatStream({ settings, messages: [{ role: 'user', content: 'investigate' }], requestId: 'normal-limit', sessionId: 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7', emit: () => {}, sshMcpRuntime: { call: vi.fn().mockResolvedValue({ isError: false, content: 'results', structuredContent: { sessions: [] } }) } as unknown as SshMcpRuntime })
  expect(result.content).toBe('finished')
})
it('normalizes limits and carries them through settings validation', () => {
  expect(normalizeAiToolRounds(undefined)).toBe(50)
  expect(normalizeAiToolRounds('')).toBe(50)
  expect(normalizeAiToolRounds(NaN)).toBe(50)
  expect(normalizeAiToolRounds(-1)).toBe(1)
  expect(normalizeAiToolRounds(999)).toBe(200)
  expect(normalizeAiToolRounds(12.8)).toBe(12)
  expect(validateAiSettings({ maxToolRounds: 30 }).maxToolRounds).toBe(30)
  expect(MAX_AI_TOOL_CALLS_PER_TURN).toBe(6_400)
  expect(MAX_AI_TURN_API_MESSAGES).toBe(6_601)
})

it('includes a fixed context file in every reply request without adding it to chat history', async () => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(sse({ content: 'done' })))
  vi.stubGlobal('fetch', fetcher)
  const file = { source: 'local' as const, path: 'C:/rules.txt', content: 'Always answer in concise steps.' }
  const secondFile = { source: 'ssh' as const, path: '/srv/checklist.md', content: 'Check disk usage before changes.' }
  for (let turn = 0; turn < 2; turn++) {
    await runAiChatStream({
      settings,
      messages: [{ role: 'user', content: `question ${turn}` }],
      contextFiles: [file, secondFile],
      requestId: `fixed-context-${turn}`,
      emit: () => {},
    })
  }
  expect(fetcher).toHaveBeenCalledTimes(2)
  for (const call of fetcher.mock.calls) {
    const body = JSON.parse(call[1].body)
    expect(body.messages[0]).toMatchObject({ role: 'system' })
    expect(body.messages[0].content).toContain(file.content)
    expect(body.messages[0].content).toContain(secondFile.content)
    expect(body.messages.filter((message: { role: string }) => message.role === 'user')).toHaveLength(1)
  }
})

it('keeps fixed context when a stream falls back to a normal completion', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.error(new Error('stream interrupted')) },
    })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'fallback' } }] })))
  vi.stubGlobal('fetch', fetcher)
  const file = { source: 'ssh' as const, path: '/home/user/rules.txt', content: 'Reply in steps.' }
  const result = await runAiChatStream({
    settings,
    messages: [{ role: 'user', content: 'help' }],
    contextFiles: [file],
    requestId: 'fixed-context-fallback',
    emit: () => {},
  })
  expect(result.content).toBe('fallback')
  expect(fetcher).toHaveBeenCalledTimes(2)
  const fallbackBody = JSON.parse(fetcher.mock.calls[1][1].body)
  expect(fallbackBody.messages[0].content).toContain(file.content)
})
