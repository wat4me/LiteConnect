import { afterEach, expect, it, vi } from 'vitest'
import { abortAiChatStream, runAiChatStream } from './chatStream'
import { runPersistedAiReply } from './streamPersistence'
import type { SshMcpRuntime } from '../mcp/runtime'
import type { AiHistoryRecord, AiResolvedConfig } from '../../shared/types/ai'

const settings: AiResolvedConfig = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test', systemPrompt: '', temperature: 0 }
afterEach(() => vi.unstubAllGlobals())
const sse = (delta: object) => new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)

it('persists tool arguments before executing and saves the final result with no UI', async () => {
  const records: AiHistoryRecord[] = []
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sse({ tool_calls: [{
    index: 0, id: 't', function: { name: 'read_file', arguments: '{"path":"/config.xml"}' },
  }] })).mockResolvedValueOnce(sse({ content: 'complete' })))
  const call = vi.fn(async (name: string) => {
    if (name === 'list_sessions') return { isError: false, content: '{}', structuredContent: { sessions: [] } }
    expect(records.at(-1)?.toolRuns?.[0]).toMatchObject({ name: 'read_file', args: '{"path":"/config.xml"}', status: 'running' })
    return { isError: false, content: 'file result' }
  })
  const result = await runPersistedAiReply({
    target: { sessionId: 's', threadId: 'thread', assistantMessageId: 'a', createdAt: 1 },
    save: async r => { records.push(r) }, publish: () => {},
    run: (emit, checkpoint) => runAiChatStream({
      emit, checkpoint, requestId: 'persist-before-tool', messages: [{ role: 'user', content: 'read config' }],
      sessionId: 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7', settings, sshMcpRuntime: { call } as unknown as SshMcpRuntime,
    }),
  })
  expect(call).toHaveBeenCalledTimes(2)
  expect(result.content).toBe('complete')
  expect(records.at(-1)?.apiMessages?.some(m => m.role === 'tool')).toBe(true)
  expect(records.at(-1)?.toolRuns?.[0].status).toBe('done')
})

it('keeps partial output when an abort interrupts the SSE body', async () => {
  const records: AiHistoryRecord[] = []
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
      // Leave the body open until the test aborts it after receiving the token.
      streamController = controller
    },
  }))))
  let streamController!: ReadableStreamDefaultController<Uint8Array>
  const result = await runPersistedAiReply({
    target: { sessionId: 's', threadId: 't', assistantMessageId: 'a', createdAt: 1 },
    save: async r => { records.push(r) },
    publish: payload => {
      if (payload.type === 'content') {
        expect(abortAiChatStream('abort-partial')).toBe(true)
        streamController.error(new DOMException('aborted', 'AbortError'))
      }
    },
    run: (emit, checkpoint) => runAiChatStream({ emit, checkpoint, requestId: 'abort-partial', settings, messages: [{ role: 'user', content: 'hello' }] }),
  })
  expect(result).toMatchObject({ content: 'partial', aborted: true })
  expect(records.at(-1)?.content).toBe('partial')
  expect(abortAiChatStream('abort-partial')).toBe(false)
})
