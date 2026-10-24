import { afterEach, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { ChatItem } from '@/domain/ai/chat'
import { reasoningDisclosureKey, toolDisclosureKey, useAiDisclosureState } from './useAiDisclosureState'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => scopes.splice(0).forEach(scope => scope.stop()))
function fixture() {
  const messages = ref<ChatItem[]>([{
    id: 'reply', role: 'assistant', content: '', createdAt: 1, reasoningContent: 'thinking',
    toolRuns: [{ id: 'exec', name: 'exec', args: '{}', content: 'ok', isError: false }],
  }])
  const conversationKey = ref('thread')
  const scope = effectScope(); scopes.push(scope)
  const state = scope.run(() => useAiDisclosureState({ messages: () => messages.value, conversationKey: () => conversationKey.value }))!
  state.toolOpenState.set(toolDisclosureKey('reply', 'exec'), true)
  state.reasoningOpenState.set(reasoningDisclosureKey('reply', 0), true)
  return { ...state, messages, conversationKey }
}

it('keeps expansion choices while streaming, replacing snapshots and paging the same history', async () => {
  const f = fixture()
  f.messages.value[0].reasoningContent += ' more'
  f.messages.value = [...f.messages.value]
  await nextTick()
  expect(f.toolOpenState.size).toBe(1)
  expect(f.reasoningOpenState.size).toBe(1)
})

it('removes deleted tools and reasoning segments independently', async () => {
  const f = fixture()
  f.messages.value[0].toolRuns = []
  await nextTick()
  expect(f.toolOpenState.size).toBe(0)
  expect(f.reasoningOpenState.size).toBe(1)
  f.messages.value[0].reasoningContent = ''
  await nextTick()
  expect(f.reasoningOpenState.size).toBe(0)
})

it('clears both caches when messages are deleted or a thread reuses message ids', async () => {
  const f = fixture()
  f.conversationKey.value = 'different-thread'
  await nextTick()
  expect(f.toolOpenState.size + f.reasoningOpenState.size).toBe(0)
  f.toolOpenState.set(toolDisclosureKey('reply', 'exec'), true)
  f.reasoningOpenState.set(reasoningDisclosureKey('reply', 0), true)
  f.messages.value = []
  await nextTick()
  expect(f.toolOpenState.size + f.reasoningOpenState.size).toBe(0)
})

it('tracks recorded reasoning indices and does not allocate entries for unopened tools', async () => {
  const f = fixture()
  f.messages.value[0].segments = [{ kind: 'content', text: 'first' }, { kind: 'reasoning', text: 'thought' }]
  f.reasoningOpenState.set(reasoningDisclosureKey('reply', 1), true)
  f.messages.value[0].toolRuns!.push(...Array.from({ length: 1000 }, (_, index) => ({
    id: `extra-${index}`, name: 'exec', args: '{}', content: '', isError: false,
  })))
  await nextTick()
  expect([...f.reasoningOpenState.keys()]).toEqual([reasoningDisclosureKey('reply', 1)])
  expect(f.toolOpenState.size).toBe(1)
})
