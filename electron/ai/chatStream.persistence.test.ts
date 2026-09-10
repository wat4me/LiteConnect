import { afterEach, expect, it, vi } from 'vitest'
import { abortAiChatStream, resolveToolApproval, runAiChatStream } from './chatStream'
import { runPersistedAiReply } from './streamPersistence'
import type { SshMcpRuntime } from '../mcp/runtime'
import type { AiHistoryRecord, AiResolvedConfig } from '../../shared/types/ai'

const settings: AiResolvedConfig = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test', systemPrompt: '', temperature: 0 }
afterEach(() => vi.unstubAllGlobals())
const sse = (delta: object) => new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)

it.each([true, false])('honors declared write approval (%s) and retains the explanation', async approved => {
  const requestId = `declared-approval-${approved}`
  const explanation = '查看磁盘信息，本次主动申请修改权限以验证审批流程。'
  const args = { command: 'df -h', risk: 'write', explanation, group: 'prod', connectMissing: true, sessionIds: ['other'] }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sse({ tool_calls: [{
    index: 0, id: 't', function: { name: 'exec', arguments: JSON.stringify(args) },
  }] })).mockResolvedValueOnce(sse({ content: 'complete' })))
  const records: AiHistoryRecord[] = []
  const call = vi.fn(async (name: string, received: unknown) => {
    if (name === 'list_sessions') return { isError: false, content: '{}', structuredContent: { sessions: [] } }
    expect(approved).toBe(true)
    expect(received).toEqual({ command: 'df -h', sessionId: 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7' })
    return { isError: false, content: 'disk info' }
  })
  const result = await runPersistedAiReply({
    target: { sessionId: 's', threadId: 't', assistantMessageId: 'a', createdAt: 1 },
    save: async r => { records.push(r) },
    publish: event => {
      if (event.type === 'tool' && event.value.phase === 'ask') {
        expect(event.value).toMatchObject({ risk: 'write', reason: explanation })
        queueMicrotask(() => { expect(resolveToolApproval(requestId, 't', approved)).toBe(true) })
      }
    },
    run: (emit, checkpoint) => runAiChatStream({
      emit, checkpoint, requestId, settings, messages: [{ role: 'user', content: 'inspect' }],
      sessionId: 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7', sshMcpRuntime: { call } as unknown as SshMcpRuntime,
    }),
  })
  expect(call).toHaveBeenCalledTimes(approved ? 2 : 1)
  expect(result.toolRuns?.[0]).toMatchObject({ risk: 'write', reason: explanation, status: approved ? 'done' : 'denied' })
  expect(records.some(r => r.toolRuns?.[0]?.status === 'ask')).toBe(true)
})

it('does not execute a tool when the required explanation is missing', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sse({ tool_calls: [{
    index: 0, id: 't', function: { name: 'exec', arguments: '{"command":"df -h","risk":"read"}' },
  }] })).mockResolvedValueOnce(sse({ content: 'incomplete request' })))
  const call = vi.fn(async () => ({ isError: false, content: '{}', structuredContent: { sessions: [] } }))
  const result = await runAiChatStream({
    emit: () => {}, requestId: 'invalid-declaration', settings,
    messages: [{ role: 'user', content: 'inspect' }], sessionId: 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7',
    sshMcpRuntime: { call } as unknown as SshMcpRuntime,
  })
  expect(call).toHaveBeenCalledTimes(1)
  expect(result.toolRuns?.[0].content).toContain('EXPLANATION_REQUIRED')
})

it('persists tool arguments before executing and saves the final result with no UI', async () => {
  const records: AiHistoryRecord[] = []
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sse({ tool_calls: [{
    index: 0, id: 't', function: { name: 'read_file', arguments: '{"path":"/config.xml","risk":"read","explanation":"查看配置文件，不修改内容。"}' },
  }] })).mockResolvedValueOnce(sse({ content: 'complete' })))
  const call = vi.fn(async (name: string, args: unknown) => {
    if (name === 'list_sessions') return { isError: false, content: '{}', structuredContent: { sessions: [] } }
    expect(records.at(-1)?.toolRuns?.[0]).toMatchObject({ name: 'read_file', reason: '查看配置文件，不修改内容。', status: 'running', risk: 'read' })
    expect(args).toEqual({ path: '/config.xml', sessionId: 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7' })
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


it('clears and persists pending approval when cancelled during its checkpoint', async () => {
  const requestId = 'abort-approval-checkpoint'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sse({ tool_calls: [{
    index: 0, id: 't', function: { name: 'exec', arguments: JSON.stringify({ command: 'hostname', risk: 'write', explanation: 'Inspect host' }) },
  }] })))
  const call = vi.fn(async () => ({ isError: false, content: '{}', structuredContent: { sessions: [] } }))
  const records: AiHistoryRecord[] = []
  const result = await runPersistedAiReply({
    target: { sessionId: 's', threadId: 't', assistantMessageId: 'a', createdAt: 1 },
    save: async r => { records.push(r) },
    publish: event => {
      if (event.type === 'tool' && event.value.phase === 'ask') {
        queueMicrotask(() => { abortAiChatStream(requestId) })
      }
    },
    run: (emit, checkpoint) => runAiChatStream({
      emit, checkpoint, requestId, settings, messages: [{ role: 'user', content: 'inspect' }],
      sessionId: 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7', sshMcpRuntime: { call } as unknown as SshMcpRuntime,
    }),
  })
  expect(result.aborted).toBe(true)
  expect(result.toolRuns?.[0].status).toBe('denied')
  expect(records.at(-1)?.toolRuns?.[0].status).toBe('denied')
  expect(call).toHaveBeenCalledTimes(1) // Session metadata only; no command ran.
  expect(resolveToolApproval(requestId, 't', true)).toBe(false)
})
