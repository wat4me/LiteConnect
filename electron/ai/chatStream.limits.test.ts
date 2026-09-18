import { afterEach, expect, it, vi } from 'vitest'
import { runAiChatStream } from './chatStream'
import { normalizeAiToolRounds } from '../../shared/aiToolLimits'
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
})
