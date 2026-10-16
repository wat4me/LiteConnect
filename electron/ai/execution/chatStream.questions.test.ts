import { afterEach, expect, it, vi } from 'vitest'
import { runAiChatStream } from './chatStream'
import { runPersistedAiReply } from './streamPersistence'
import { createAiStreamControl, resolveUserAnswer, waitForUserAnswer, clearPendingUserQuestions } from '../tools/streamControl'
import type { SshMcpRuntime } from '../../mcp/runtime'
import type { AiChatStreamPayload, AiHistoryRecord, AiResolvedConfig } from '../../../shared/types/ai'

const settings: AiResolvedConfig = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test', systemPrompt: '', temperature: 0, toolPermission: 'readonly' }
const sessionId = 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7'
const questions = [{ id: 'scope', question: '检查哪个环境？', options: [{ label: '测试' }, { label: '生产' }] }]
const answer = { cancelled: false, answers: [{ id: 'scope', selected: ['生产'], text: '只检查状态' }] }
const sse = (delta: object) => new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
const questionDelta = { tool_calls: [{ index: 0, id: 'question-1', function: { name: 'ask_user', arguments: JSON.stringify({ questions }) } }] }
afterEach(() => vi.unstubAllGlobals())

it.each([false, true])('waits for an actual answer, validates owner and resumes once (cancelled=$0)', async cancelled => {
  const requestId = `ask-interactive-${cancelled}`
  const control = createAiStreamControl(requestId, 7)
  const call = vi.fn(async (_name: string) => ({ isError: false, content: '{}', structuredContent: { sessions: [] } }))
  const fetcher = vi.fn().mockResolvedValueOnce(sse(questionDelta)).mockResolvedValueOnce(sse({ content: cancelled ? '已跳过，等待必要信息。' : '按生产环境继续。' }))
  vi.stubGlobal('fetch', fetcher)
  const events: AiChatStreamPayload[] = []
  const pending = runAiChatStream({ settings, sessionId, messages: [{ role: 'user', content: '检查服务' }], requestId, abortController: control.controller,
    emit: event => events.push(event), sshMcpRuntime: { call } as unknown as SshMcpRuntime,
  })
  try {
    await vi.waitFor(() => expect(events.some(event => event.type === 'tool' && event.value.phase === 'question')).toBe(true))
    expect(fetcher).toHaveBeenCalledOnce()
    expect(resolveUserAnswer(requestId, 'question-1', answer, 8)).toBe(false)
    expect(resolveUserAnswer(requestId, 'wrong-call', answer, 7)).toBe(false)
    expect(resolveUserAnswer(requestId, 'question-1', { ...answer, answers: [{ ...answer.answers[0], selected: ['forged'] }] }, 7)).toBe(false)
    const response = cancelled ? { cancelled: true, answers: [] } : answer
    expect(resolveUserAnswer(requestId, 'question-1', response, 7)).toBe(true)
    expect(resolveUserAnswer(requestId, 'question-1', response, 7)).toBe(false)
    const result = await pending
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(call.mock.calls.some(([name]) => name === 'ask_user')).toBe(false)
    const toolResult = JSON.parse(fetcher.mock.calls[1][1].body).messages.find((message: { role: string }) => message.role === 'tool')
    expect(JSON.parse(toolResult.content)).toEqual(response)
    expect(result.toolRuns?.[0].status).toBe('done')
    expect(result.apiMessages?.map(message => message.role)).toEqual(['assistant', 'tool', 'assistant'])
  } finally { control.controller.abort(); control.cleanup(); await pending }
})

it.each([{ allowQuestions: false }, { foregroundOnly: true }])('does not provide questions or question guidance for unattended requests %j', async flags => {
  const call = vi.fn(async () => ({ isError: false, content: '{}', structuredContent: { sessions: [] } }))
  const fetcher = vi.fn().mockResolvedValueOnce(sse({ content: '巡检完成。' }))
  vi.stubGlobal('fetch', fetcher)
  await runAiChatStream({ ...flags, settings, sessionId, messages: [{ role: 'user', content: '巡检' }], requestId: `ask-unattended-${JSON.stringify(flags)}`, emit: () => {}, sshMcpRuntime: { call } as unknown as SshMcpRuntime })
  const body = JSON.parse(fetcher.mock.calls[0][1].body)
  expect(body.tools.some((tool: { function: { name: string } }) => tool.function.name === 'ask_user')).toBe(false)
  expect(body.messages[0].content).not.toContain('用 ask_user 提问')
})

it('does not hang if an unattended model invents a question-tool call', async () => {
  const call = vi.fn(async () => ({ isError: false, content: '{}', structuredContent: { sessions: [] } }))
  const fetcher = vi.fn().mockResolvedValueOnce(sse(questionDelta)).mockResolvedValueOnce(sse({ content: '缺少必要信息，已记录。' }))
  vi.stubGlobal('fetch', fetcher)
  const result = await runAiChatStream({ allowQuestions: false, settings, sessionId, messages: [{ role: 'user', content: '巡检' }], requestId: 'ask-unattended-forged', emit: () => {}, sshMcpRuntime: { call } as unknown as SshMcpRuntime })
  expect(result.toolRuns?.[0].content).toContain('QUESTION_UNAVAILABLE')
  expect(result.toolRuns?.[0].isError).toBe(true)
})

it('persists the pending card and stops it cleanly without claiming any remote command ran', async () => {
  const control = createAiStreamControl('ask-stop', 7)
  const records: AiHistoryRecord[] = []
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sse(questionDelta)))
  const call = vi.fn(async () => ({ isError: false, content: '{}', structuredContent: { sessions: [] } }))
  const pending = runPersistedAiReply({ target: { sessionId, threadId: 'thread', assistantMessageId: 'reply', createdAt: 1 },
    save: async record => { records.push(record) }, publish: () => {},
    run: (emit, checkpoint) => runAiChatStream({ settings, sessionId, messages: [{ role: 'user', content: '检查服务' }], requestId: 'ask-stop', emit, checkpoint, abortController: control.controller, sshMcpRuntime: { call } as unknown as SshMcpRuntime }),
  })
  try {
    await vi.waitFor(() => expect(records.at(-1)?.toolRuns?.[0].status).toBe('question'))
    control.controller.abort()
    const result = await pending
    expect(result.aborted).toBe(true)
    expect(result.toolRuns?.[0]).toMatchObject({ status: 'aborted', isError: false })
    expect(result.toolRuns?.[0].content).toContain('No answer or approval')
    expect(result.toolRuns?.[0].content).not.toContain('TOOL_RESULT_UNKNOWN')
    expect(resolveUserAnswer('ask-stop', 'question-1', answer, 7)).toBe(false)
  } finally { control.controller.abort(); control.cleanup(); await pending }
})

it('cleans up question waiters when their request ends, without a polling or timeout loop', async () => {
  const control = createAiStreamControl('ask-cleanup', 7)
  const pending = waitForUserAnswer('ask-cleanup', 'question', questions, control.controller.signal)
  clearPendingUserQuestions('other')
  control.cleanup()
  expect(await pending).toBeUndefined()
  expect(resolveUserAnswer('ask-cleanup', 'question', answer, 7)).toBe(false)
})

it('defers other tools in a question batch until the model has interpreted the user response', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(sse({ tool_calls: [
    { index: 0, id: 'premature-exec', function: { name: 'exec', arguments: JSON.stringify({ command: 'restart app', risk: 'write', explanation: 'restart' }) } },
    { ...questionDelta.tool_calls[0], index: 1 },
  ] })).mockResolvedValueOnce(sse({ content: '用户暂不回答，未执行重启。' }))
  vi.stubGlobal('fetch', fetcher)
  const call = vi.fn(async (_name: string) => ({ isError: false, content: '{}', structuredContent: { sessions: [] } }))
  const result = await runAiChatStream({ settings: { ...settings, toolPermission: 'auto' }, sessionId, messages: [{ role: 'user', content: '检查服务' }], requestId: 'ask-mixed-tools',
    sshMcpRuntime: { call } as unknown as SshMcpRuntime,
    emit: event => { if (event.type === 'tool' && event.value.phase === 'question') resolveUserAnswer('ask-mixed-tools', event.value.id, { cancelled: true }) },
  })
  expect(call.mock.calls.every(([name]) => name === 'list_sessions')).toBe(true)
  expect(result.toolRuns?.[0].content).toContain('not executed')
  expect(result.toolRuns?.[1].content).toContain('"cancelled":true')
  expect(result.apiMessages?.map(message => message.role)).toEqual(['assistant', 'tool', 'tool', 'assistant'])
})
