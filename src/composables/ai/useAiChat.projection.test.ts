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
