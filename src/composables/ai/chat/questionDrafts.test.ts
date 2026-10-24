import { expect, it } from 'vitest'
import { isReactive, reactive } from 'vue'
import type { AiSessionState } from '@/domain/ai/chat'
import { clearAiQuestionDrafts, getAiQuestionDraft, pruneAiQuestionDrafts } from './questionDrafts'

const run = { id: 'question', name: 'ask_user', args: '{"questions":[]}', content: '', status: 'question', isError: false }
function session() {
  return reactive<AiSessionState>({
    compactionCount: 0, draftImages: [], input: '', loading: true, persisting: false,
    activeThreadId: 'thread', threads: [], activeRequestId: 'request', loaded: true,
    disposeAfterReply: false, contextFiles: [], defaultContextFiles: [],
    messages: [{ id: 'reply', role: 'assistant', createdAt: 1, content: '', streaming: true, toolRuns: [{ ...run }] }],
  })
}

it('restores reactive choices, custom text and page after the question view is recreated', () => {
  const state = session()
  const draft = getAiQuestionDraft(state, run)
  expect(isReactive(draft)).toBe(true)
  draft.selected.scope = ['production']
  draft.custom.checks = true
  draft.text.checks = 'look at logs'
  draft.currentIndex = 1
  expect(getAiQuestionDraft(state, { ...run })).toBe(draft)
  expect(getAiQuestionDraft(state, run)).toMatchObject({
    selected: { scope: ['production'] }, custom: { checks: true }, text: { checks: 'look at logs' }, currentIndex: 1,
  })
})

it('isolates sessions and threads even when providers reuse the same tool id', () => {
  const a = session(), b = session()
  getAiQuestionDraft(a, run).text.scope = 'first session'
  expect(getAiQuestionDraft(b, run).text).toEqual({})
  a.activeThreadId = 'other-thread'
  expect(getAiQuestionDraft(a, run).text).toEqual({})
  a.activeThreadId = 'thread'
  expect(getAiQuestionDraft(a, run).text.scope).toBe('first session')
})

it('starts fresh when a tool id is reused for a different question or request', () => {
  const state = session()
  getAiQuestionDraft(state, run).text.scope = 'old answer'
  expect(getAiQuestionDraft(state, { ...run, args: 'new questions' }).text).toEqual({})
  getAiQuestionDraft(state, run).text.scope = 'another answer'
  state.activeRequestId = 'next-request'
  expect(getAiQuestionDraft(state, run).text).toEqual({})
  expect(state.questionDrafts?.size).toBe(1)
})

it('cleans only resolved questions and releases drafts when the request ends offscreen', () => {
  const state = session()
  const second = { ...run, id: 'second' }
  state.messages[0].toolRuns!.push(second)
  getAiQuestionDraft(state, run).text.scope = 'answer'
  getAiQuestionDraft(state, second).text.scope = 'pending'
  pruneAiQuestionDrafts(state)
  expect(state.questionDrafts?.size).toBe(2)
  state.messages[0].toolRuns![0].status = 'running'
  pruneAiQuestionDrafts(state)
  expect(state.questionDrafts?.size).toBe(1)
  expect(getAiQuestionDraft(state, second).text.scope).toBe('pending')
  state.loading = false
  pruneAiQuestionDrafts(state)
  expect(state.questionDrafts?.size).toBe(0)
})

it('clears the originating thread without touching another thread draft', () => {
  const state = session()
  getAiQuestionDraft(state, run)
  state.activeThreadId = 'other-thread'
  getAiQuestionDraft(state, run).text.scope = 'keep'
  clearAiQuestionDrafts(state, 'thread')
  expect(state.questionDrafts?.size).toBe(1)
  expect(getAiQuestionDraft(state, run).text.scope).toBe('keep')
})
