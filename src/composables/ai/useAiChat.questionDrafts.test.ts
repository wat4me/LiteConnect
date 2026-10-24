import { afterEach, expect, it, vi } from 'vitest'
import { disposeAiSessionState, useAiChat } from './useAiChat'
import { releaseAiSessionState } from './chat/sessionState'

vi.mock('../../i18n', () => ({ t: (key: string) => key }))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { warning: vi.fn() } }))
afterEach(() => { releaseAiSessionState('question-draft'); vi.unstubAllGlobals() })

function fixture(answer: () => Promise<boolean>) {
  const abort = vi.fn(async () => {})
  vi.stubGlobal('window', { LiteConnect: { aiAnswerQuestion: answer, aiAbortChatStream: abort } })
  const chat = useAiChat()
  const state = chat.getSessionState('question-draft')
  state.activeThreadId = 'thread'
  state.activeRequestId = 'request'
  state.loading = true
  state.messages.push({ id: 'reply', role: 'assistant', createdAt: 1, content: '', streaming: true,
    toolRuns: [{ id: 'ask', name: 'ask_user', args: '{}', content: '', status: 'question', isError: false }],
  })
  const run = state.messages[0].toolRuns![0]
  const draft = chat.getQuestionDraft('question-draft', run)
  draft.text.scope = 'private draft'
  return { chat, state, run, draft, abort }
}

it('retains failed answer drafts and removes them only after successful resolution', async () => {
  const resolve = vi.fn(async () => false)
  const f = fixture(resolve)
  const answer = { cancelled: false, answers: [{ id: 'scope', selected: [], text: 'private draft' }] }
  expect(await f.chat.answerQuestion('question-draft', 'ask', answer)).toBe(false)
  expect(f.chat.getQuestionDraft('question-draft', f.run).text.scope).toBe('private draft')
  resolve.mockResolvedValue(true)
  expect(await f.chat.answerQuestion('question-draft', 'ask', answer)).toBe(true)
  expect(f.state.questionDrafts?.size).toBe(0)
  expect(f.run.status).toBe('running')
})

it('does not resolve or erase a new question when an older submission finishes late', async () => {
  let finish!: (resolved: boolean) => void
  const f = fixture(() => new Promise(resolve => { finish = resolve }))
  const pending = f.chat.answerQuestion('question-draft', 'ask', { cancelled: true, answers: [] })
  f.state.activeRequestId = 'new-request'
  const newerDraft = f.chat.getQuestionDraft('question-draft', f.run)
  newerDraft.text.scope = 'new answer'
  finish(true)
  expect(await pending).toBe(true)
  expect(f.run.status).toBe('question')
  expect(f.state.questionDrafts?.size).toBe(1)
  expect(f.chat.getQuestionDraft('question-draft', f.run).text.scope).toBe('new answer')
})

it('releases answer text immediately when the session is disposed during a pending request', () => {
  const f = fixture(async () => false)
  disposeAiSessionState('question-draft')
  expect(f.state.questionDrafts?.size).toBe(0)
  expect(f.abort).toHaveBeenCalledWith('request')
})
