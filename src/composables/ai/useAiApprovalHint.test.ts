import { afterEach, expect, it } from 'vitest'
import { computed } from 'vue'
import type { ChatItem } from '@/domain/ai/chat'
import { getAiPendingAction } from '@/utils/ai/pendingAction'
import { syncAiApprovalPending, useAiApprovalHint } from './useAiApprovalHint'

const hint = useAiApprovalHint()
afterEach(() => {
  for (const id of [...hint.pendingApprovalSessions]) syncAiApprovalPending(id, false)
})
const message = (statuses: string[], streaming = true): ChatItem => ({
  id: 'reply', role: 'assistant', content: '', createdAt: 1, streaming,
  toolRuns: statuses.map((status, index) => ({ id: String(index), name: 'exec', args: '{}', content: '', isError: false, status: status as NonNullable<ChatItem['toolRuns']>[number]['status'] })),
})

it.each([['ask', 'approval'], ['question', 'question']] as const)('shares %s pending state between the SSH hint and AI rail', (status, action) => {
  const pending = computed(() => hint.getPendingAction('session'))
  expect(pending.value).toBeNull()
  syncAiApprovalPending('session', getAiPendingAction({ loading: true, messages: [message([status])] }))
  expect(hint.hasPending('session')).toBe(true)
  expect(pending.value).toBe(action)
  syncAiApprovalPending('session', false)
  expect(pending.value).toBeNull()
  expect(hint.hasPending('session')).toBe(false)
})

it('keeps the remaining question pending after approving one of several actions', () => {
  const state = { loading: true, messages: [message(['ask', 'question'])] }
  syncAiApprovalPending('session', getAiPendingAction(state))
  expect(hint.getPendingAction('session')).toBe('mixed')
  state.messages[0].toolRuns![0].status = 'running'
  syncAiApprovalPending('session', getAiPendingAction(state))
  expect(hint.getPendingAction('session')).toBe('question')
  state.messages[0].toolRuns![1].status = 'running'
  syncAiApprovalPending('session', getAiPendingAction(state))
  expect(hint.hasPending('session')).toBe(false)
})

it('never turns historical or stopped requests into pending work', () => {
  expect(getAiPendingAction({ loading: true, messages: [message(['ask', 'question'], false), message(['running', 'denied', 'done'])] })).toBeNull()
  expect(getAiPendingAction({ loading: false, messages: [message(['ask', 'question'])] })).toBeNull()
  syncAiApprovalPending('live', 'question')
  syncAiApprovalPending('other', 'approval')
  syncAiApprovalPending('live', null)
  expect(hint.getPendingAction('live')).toBeNull()
  expect(hint.getPendingAction('other')).toBe('approval')
})
