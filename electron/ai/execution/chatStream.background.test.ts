import { afterEach, expect, it, vi } from 'vitest'
import { runAiChatStream } from './chatStream'
import { runPersistedAiReply } from './streamPersistence'
import { flattenConversationForApi } from '../../../shared/aiMessages'
import { aiBackgroundResultNotices, AI_BACKGROUND_RESULT_PREFIX } from '../../../shared/aiBackgroundResults'
import { MAX_AI_BACKGROUND_CONTINUATIONS } from '../../../shared/aiToolLimits'
import type { AiChatStreamPayload, AiHistoryRecord, AiResolvedConfig } from '../../../shared/types/ai'
import type { SshMcpRuntime } from '../../mcp/runtime'

const settings: AiResolvedConfig = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test', systemPrompt: '', temperature: 0, toolPermission: 'readonly' }
const messages = [{ role: 'user', content: 'inspect' }]
const sessionId = 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7'
const sse = (delta: object) => new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
const notice = (id: number) => `${AI_BACKGROUND_RESULT_PREFIX}\n[{"jobId":"job-${id}","status":"completed","stdout":"output-${id}"}]`
afterEach(() => vi.unstubAllGlobals())

it('continues in the same turn when a completion arrives during a final response', async () => {
  let pending = false
  const acknowledge = vi.fn(() => { pending = false })
  const persist = vi.fn(async () => {})
  const fetcher = vi.fn().mockImplementationOnce(async () => { pending = true; return sse({ content: 'Waiting.' }) })
    .mockImplementationOnce(async (_url, request) => {
      expect(persist).toHaveBeenCalledOnce()
      expect(acknowledge).toHaveBeenCalledOnce()
      expect(JSON.parse(request.body).messages.slice(-2)).toEqual([
        { role: 'assistant', content: 'Waiting.' }, { role: 'user', content: notice(1) },
      ])
      return sse({ content: 'Result analyzed.' })
    })
  vi.stubGlobal('fetch', fetcher)
  const events: AiChatStreamPayload[] = []
  const result = await runAiChatStream({ settings, messages, requestId: 'busy-final', emit: event => events.push(event),
    pendingBackgroundResults: () => pending ? { notice: notice(1), acknowledge } : undefined,
    persistBackgroundResults: persist,
  })
  expect(result.content).toBe('Waiting.\n\nResult analyzed.')
  expect(events.filter(event => event.type === 'content').map(event => event.value).join('')).toBe(result.content)
  expect(result.apiMessages?.map(message => message.role)).toEqual(['assistant', 'user', 'assistant'])
  expect(events.filter(event => event.type === 'done')).toHaveLength(1)
})

it('injects only after the complete tool batch, never between a call and its results', async () => {
  let pending = false
  const acknowledge = vi.fn(() => { pending = false })
  const calls = [0, 1].map(index => ({ index, id: `call-${index}`, function: { name: 'exec', arguments: JSON.stringify({ command: `hostname ${index}`, risk: 'read', explanation: 'inspect' }) } }))
  const fetcher = vi.fn().mockResolvedValueOnce(sse({ tool_calls: calls })).mockImplementationOnce(async (_url, request) => {
    expect(JSON.parse(request.body).messages.slice(-4).map((message: { role: string }) => message.role)).toEqual(['assistant', 'tool', 'tool', 'user'])
    return sse({ content: 'Both commands and the background result analyzed.' })
  })
  vi.stubGlobal('fetch', fetcher)
  const call = vi.fn(async (name: string) => {
    if (name === 'exec') pending = true
    return { isError: false, content: '{"exitCode":0}', structuredContent: { sessions: [] } }
  })
  const result = await runAiChatStream({ settings, messages, sessionId, requestId: 'busy-tools', emit: () => {},
    sshMcpRuntime: { call } as unknown as SshMcpRuntime,
    pendingBackgroundResults: () => pending ? { notice: notice(1), acknowledge } : undefined,
  })
  expect(call.mock.calls.filter(([name]) => name === 'exec')).toHaveLength(2)
  expect(acknowledge).toHaveBeenCalledOnce()
  expect(result.apiMessages?.map(message => message.role)).toEqual(['assistant', 'tool', 'tool', 'user', 'assistant'])
})

it('bounds extra continuations and leaves later completions unacknowledged for idle delivery', async () => {
  let pending = 0
  const acknowledge = vi.fn(() => { pending = 0 })
  const fetcher = vi.fn(async () => { pending = fetcher.mock.calls.length; return sse({ content: `step ${pending}` }) })
  vi.stubGlobal('fetch', fetcher)
  const result = await runAiChatStream({ settings, messages, requestId: 'busy-budget', emit: () => {},
    pendingBackgroundResults: () => pending ? { notice: notice(pending), acknowledge } : undefined,
  })
  expect(fetcher).toHaveBeenCalledTimes(MAX_AI_BACKGROUND_CONTINUATIONS + 1)
  expect(acknowledge).toHaveBeenCalledTimes(MAX_AI_BACKGROUND_CONTINUATIONS)
  expect(pending).toBe(MAX_AI_BACKGROUND_CONTINUATIONS + 1)
  expect(aiBackgroundResultNotices(result)).toHaveLength(MAX_AI_BACKGROUND_CONTINUATIONS)
})

it('does not acknowledge results when their persistence fails', async () => {
  const acknowledge = vi.fn()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(runAiChatStream({ settings, messages, requestId: 'busy-checkpoint-failure', emit: () => {},
    pendingBackgroundResults: () => ({ notice: notice(1), acknowledge }),
    persistBackgroundResults: async () => { throw new Error('storage unavailable') },
  })).rejects.toThrow('storage unavailable')
  expect(acknowledge).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()
})

it.each(['failed', 'aborted'] as const)('preserves delivered output once if the next model request is %s', async state => {
  let pending = true
  const records: AiHistoryRecord[] = []
  const controller = new AbortController()
  vi.stubGlobal('fetch', vi.fn(async () => {
    expect(records.at(-1)?.apiMessages?.[0].content).toBe(notice(1))
    if (state === 'aborted') { controller.abort(); throw new DOMException('cancelled', 'AbortError') }
    return Response.json({ error: { message: 'provider unavailable' } }, { status: 500 })
  }))
  const result = await runPersistedAiReply({
    target: { sessionId, threadId: 'thread', assistantMessageId: 'reply', createdAt: 1 },
    save: async record => { records.push(record) }, publish: () => {},
    run: (emit, checkpoint, persistBackgroundResults) => runAiChatStream({ settings, messages, requestId: `busy-${state}`, emit, checkpoint, persistBackgroundResults,
      abortController: controller,
      pendingBackgroundResults: () => pending ? { notice: notice(1), acknowledge: () => { pending = false } } : undefined,
    }),
  })
  expect(state === 'aborted' ? result.aborted : result.error).toBe(true)
  const projected = flattenConversationForApi([records.at(-1)!])
  expect(projected).toEqual([{ role: 'user', content: notice(1) }])
  expect(aiBackgroundResultNotices(records.at(-1)!)).toEqual([notice(1)])
})

it('keeps received results when a stream falls back to a normal completion', async () => {
  let pending = true
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new Error('stream interrupted')) } })))
    .mockImplementationOnce(async (_url, request) => {
      expect(JSON.parse(request.body).messages.at(-1).content).toBe(notice(1))
      return Response.json({ choices: [{ message: { content: 'Output analyzed.' } }] })
    })
  vi.stubGlobal('fetch', fetcher)
  const result = await runAiChatStream({ settings, messages, requestId: 'busy-fallback', emit: () => {},
    pendingBackgroundResults: () => pending ? { notice: notice(1), acknowledge: () => { pending = false } } : undefined,
  })
  expect(result.content).toBe('Output analyzed.')
  expect(result.apiMessages?.map(message => message.role)).toEqual(['user', 'assistant'])
})
