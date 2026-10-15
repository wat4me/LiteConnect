import { afterEach, expect, it, vi } from 'vitest'
import { runAiChatStream } from './chatStream'
import type { AiChatStreamPayload, AiResolvedConfig } from '../../../shared/types/ai'
import type { SshMcpRuntime } from '../../mcp/runtime'

const settings: AiResolvedConfig = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test', systemPrompt: '', temperature: 0, toolPermission: 'readonly', contextWindowTokens: 20000, maxToolRounds: 16 }
const sessionId = 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7'
const sse = (delta: unknown) => new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
const tool = (index: number) => ({ tool_calls: [{ index: 0, id: `c${index}`, function: { name: 'exec', arguments: JSON.stringify({ command: 'pwd', risk: 'read', explanation: '检查当前目录' }) } }] })
afterEach(() => vi.unstubAllGlobals())

it('compacts during tool continuation but retains every executed tool in the saved transcript', async () => {
  let steps = 0
  let summaries = 0
  const requests: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    if (!body.stream) {
      summaries++
      return Response.json({ choices: [{ message: { content: '目标：检查目录；已完成此前读取，继续剩余检查。' }, finish_reason: 'stop' }] })
    }
    return sse(steps++ < 12 ? tool(steps) : { content: '全部检查完成' })
  }))
  const call = vi.fn(async (name: string) => name === 'list_sessions'
    ? { isError: false, content: '{}', structuredContent: { sessions: [] } }
    : { isError: false, content: 'x'.repeat(8000) })
  const events: AiChatStreamPayload[] = []
  const result = await runAiChatStream({ settings, requestId: 'live-context', messages: [{ role: 'user', content: '检查所有目录' }], sessionId, sshMcpRuntime: { call } as unknown as SshMcpRuntime, emit: event => events.push(event) })
  expect(summaries).toBeGreaterThan(0)
  expect(requests.some(body => body.stream && body.messages.some((message: any) => message.content?.includes('<compacted-summary>')))).toBe(true)
  expect(result.apiMessages?.filter(message => message.role === 'tool')).toHaveLength(12)
  expect(result.toolRuns).toHaveLength(12)
  expect(call.mock.calls.filter(([name]) => name === 'exec')).toHaveLength(12)
  expect(events.some(event => event.type === 'context-pressure')).toBe(true)
})

it.each([false, true])('recovers once from a tool-continuation overflow without executing the command twice (rejected again: %s)', async rejectedAgain => {
  let requests = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    requests++
    if (requests === 1) return sse(tool(1))
    if (requests === 2 || rejectedAgain) return Response.json({ error: { message: 'maximum context length exceeded' } }, { status: 400 })
    return sse({ content: '检查完成' })
  }))
  const call = vi.fn(async (name: string) => name === 'list_sessions'
    ? { isError: false, content: '{}', structuredContent: { sessions: [] } }
    : { isError: false, content: 'current directory: /srv' })
  const result = runAiChatStream({ settings: { ...settings, contextWindowTokens: 64000 }, requestId: `overflow-${rejectedAgain}`, messages: [{ role: 'user', content: '检查目录' }], sessionId, sshMcpRuntime: { call } as unknown as SshMcpRuntime, emit: () => {} })
  if (rejectedAgain) await expect(result).rejects.toThrow('maximum context')
  else expect((await result).content).toBe('检查完成')
  expect(requests).toBe(3)
  expect(call.mock.calls.filter(([name]) => name === 'exec')).toHaveLength(1)
})
