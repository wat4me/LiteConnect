import { afterEach, expect, it, vi } from 'vitest'
import { useAiChat } from './useAiChat'
import type { AiChatResult, AiHistoryRecord } from '../../env.d'

vi.mock('../../i18n', () => ({ t: (key: string) => key }))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { warning: vi.fn() } }))
afterEach(() => vi.unstubAllGlobals())

it('recovers the full reply without stream events and never writes assistant snapshots', async () => {
  const records: AiHistoryRecord[] = []
  const reply: AiChatResult = {
    content: 'complete', reasoningContent: 'plan',
    toolRuns: [{ id: 't', name: 'grep', args: '{}', content: 'match', status: 'done', isError: false }],
    segments: [{ kind: 'reasoning', text: 'plan' }, { kind: 'tool', runId: 't' }, { kind: 'content', text: 'complete' }],
  }
  const invoke = vi.fn(async () => reply)
  vi.stubGlobal('window', { LiteConnect: {
    appendAiSessionHistory: async (_id: string, record: AiHistoryRecord, threadId?: string) => {
      records.push(record)
      expect(threadId).toBe('test-thread')
    },
    onAiChatStream: () => () => {}, // Simulate the UI missing every notification.
    aiChatStream: invoke,
    aiGenerateConversationTitle: async () => undefined,
  } })
  const chat = useAiChat()
  const state = chat.getSessionState('projection-test')
  state.activeThreadId = 'test-thread'
  await chat.sendText('projection-test', 'inspect', () => {})
  const assistant = state.messages.at(-1)!
  expect(assistant).toMatchObject({ ...reply, streaming: false })
  expect(records.map(r => r.role)).toEqual(['user'])
  expect(invoke.mock.calls[0]).toEqual(expect.arrayContaining([
    expect.objectContaining({ threadId: 'test-thread', assistantMessageId: assistant.id }),
  ]))
  expect(state.loading).toBe(false)
})


it('routes approvals and aborts by session after recreating the sidebar', async () => {
  const finish = new Map<string, (reply: AiChatResult) => void>()
  const ids = new Map<string, string>()
  const listeners = new Map<string, (event: any) => void>()
  const approve = vi.fn(async () => true)
  const abort = vi.fn(async () => true)
  vi.stubGlobal('window', { LiteConnect: {
    appendAiSessionHistory: async () => {},
    onAiChatStream: (id: string, cb: (event: any) => void) => {
      listeners.set(id, cb)
      return () => listeners.delete(id)
    },
    aiChatStream: (id: string, _messages: unknown, opts: { sessionId: string }) => {
      ids.set(opts.sessionId, id)
      return new Promise<AiChatResult>(resolve => finish.set(opts.sessionId, resolve))
    },
    aiResolveToolApproval: approve,
    aiAbortChatStream: abort,
  } })
  const original = useAiChat()
  const sessions = ['approval-a', 'approval-b']
  for (const session of sessions) original.getSessionState(session).activeThreadId = 'thread'
  const requests = sessions.map(session => original.sendText(session, 'inspect', () => {}))
  await vi.waitFor(() => expect(finish.size).toBe(2))
  for (const id of ids.values()) listeners.get(id)!({ type: 'tool', value: { id: 'same-call', name: 'exec', phase: 'ask' } })
  const recreated = useAiChat()
  await recreated.resolveToolApproval('approval-a', 'same-call', true)
  await recreated.resolveToolApproval('approval-b', 'same-call', false)
  expect(approve.mock.calls).toEqual([[ids.get('approval-a'), 'same-call', true], [ids.get('approval-b'), 'same-call', false]])
  await recreated.stopGeneration('approval-a')
  expect(abort).toHaveBeenCalledWith(ids.get('approval-a'))
  for (const resolve of finish.values()) resolve({ content: '', aborted: true })
  await Promise.all(requests)
  expect(recreated.getSessionState('approval-a').loading).toBe(false)
  expect(recreated.getSessionState('approval-a').messages.at(-1)?.toolRuns?.[0].status).toBe('denied')
  await recreated.resolveToolApproval('approval-a', 'same-call', true)
  expect(approve).toHaveBeenCalledTimes(2)
  expect(await recreated.stopGeneration('approval-a')).toBe(false)
})
