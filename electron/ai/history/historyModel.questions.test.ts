import { expect, it } from 'vitest'
import { normalizeAiHistoryRecord, recoverInterruptedAiSessionStore } from './historyModel'
import { validateAiQuestions } from '../../../shared/aiQuestions'

it('preserves question JSON longer than the ordinary SSH argument limit', () => {
  const questions = Array.from({ length: 3 }, (_, index) => ({ id: `question-${index}`, question: '问题'.repeat(400), options: [{ label: '方案一', description: '说明'.repeat(200) }, { label: '方案二', description: '说明'.repeat(200) }] }))
  const args = JSON.stringify({ questions })
  expect(args.length).toBeGreaterThan(4000)
  const record = normalizeAiHistoryRecord({ id: 'reply', role: 'assistant', content: '', createdAt: 1, status: 'running', toolRuns: [{ id: 'ask', name: 'ask_user', args, content: '', status: 'question', isError: false }] })
  expect(record.toolRuns?.[0].status).toBe('question')
  expect(validateAiQuestions(JSON.parse(record.toolRuns![0].args))).toEqual(questions)
  const store = { version: 1 as const, activeThreadId: 'thread', defaultContextFiles: [], threads: [{ id: 'thread', title: '', createdAt: 1, updatedAt: 1, contextFiles: [], messages: [record] }] }
  expect(recoverInterruptedAiSessionStore(store)).toBe(true)
  expect(record.status).toBe('aborted')
  expect(record.toolRuns?.[0].status).toBe('aborted')
  expect(record.toolRuns?.[0].content).toContain('No answer or approval')
  expect(recoverInterruptedAiSessionStore(store)).toBe(false)
})
