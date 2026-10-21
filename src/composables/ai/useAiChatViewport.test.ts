import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, onActivated, onDeactivated, ref } from 'vue'
import type { ChatItem } from '@/domain/ai/chat'
import { useAiChatViewport } from './useAiChatViewport'

vi.mock('vue', async original => ({ ...await original<typeof import('vue')>(), onActivated: vi.fn(), onDeactivated: vi.fn() }))
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.unstubAllGlobals(); vi.clearAllMocks() })
async function setup() {
  const frames = new Map<number, FrameRequestCallback>()
  let next = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  const messages = ref<ChatItem[]>(Array.from({ length: 200 }, (_, index) => ({
    id: `turn-${index}`, role: 'user', content: `question ${index}`, createdAt: index,
  })))
  let top = 0
  const conversationKey = ref('thread-1')
  let api: ReturnType<typeof useAiChatViewport>
  const firstIndex = () => messages.value.findIndex(message => message.id === api.visibleMessages.value[0]?.id)
  const rows = messages.value.map((message, index) => ({
    dataset: { messageId: message.id },
    get offsetTop() { return (index - firstIndex()) * 100 },
    getBoundingClientRect() { return { top: this.offsetTop - top } },
  }))
  const visibleRows = () => rows.filter(row => api.visibleMessages.value.some(message => message.id === row.dataset.messageId))
  const element = {
    scrollHeight: 20000, clientHeight: 500,
    get scrollTop() { return top }, set scrollTop(value: number) { top = Math.max(0, Math.min(value, 19500)) },
    querySelectorAll: visibleRows,
    querySelector: (selector: string) => selector === '[data-message-id]' ? visibleRows()[0] : visibleRows().find(row => selector.includes(`"${row.dataset.messageId}"`)),
    contains: (row: typeof rows[number]) => visibleRows().includes(row),
    scrollTo: ({ top: value }: { top: number }) => { element.scrollTop = value },
  }
  const scope = effectScope(); scopes.push(scope)
  api = scope.run(() => useAiChatViewport({ messages: () => messages.value, loading: () => true, layoutSignature: () => '', conversationKey: () => conversationKey.value }))!
  api.listRef.value = element as unknown as HTMLElement
  const flush = async () => {
    await nextTick(); await nextTick()
    for (let round = 0; round < 3 && frames.size; round++) {
      const pending = [...frames.values()]; frames.clear()
      pending.forEach(callback => callback(0))
    }
  }
  await flush()
  return { api, scope, messages, element, frames, flush, conversationKey }
}

it('preserves the reader position across stream updates and follows only after returning to the bottom', async () => {
  const f = await setup()
  expect(f.element.scrollTop).toBe(19500)
  f.element.scrollTop = 120
  f.api.onListScroll()
  expect(f.api.followLatest.value).toBe(false)
  f.messages.value[199].content += ' streamed response'
  await f.flush()
  expect(f.element.scrollTop).toBe(120)
  f.element.scrollTop = 19500
  f.api.onListScroll()
  expect(f.api.followLatest.value).toBe(true)
})

it('restores a saved reading position after KeepAlive reattachment', async () => {
  const f = await setup()
  f.element.scrollTop = 240
  f.api.onListScroll()
  const deactivate = vi.mocked(onDeactivated).mock.calls.at(-1)![0] as () => void
  const activate = vi.mocked(onActivated).mock.calls.at(-1)![0] as () => void
  deactivate()
  f.element.scrollTop = 0
  activate()
  await f.flush()
  expect(f.element.scrollTop).toBe(240)
  expect(f.api.followLatest.value).toBe(false)
})

it('bounds the overview while allowing access to all 200 timeline turns', async () => {
  const f = await setup()
  expect(f.api.visibleTimelineTurns.value.length).toBeLessThanOrEqual(12)
  expect(f.api.visibleTimelineTurns.value[0].id).toBe('turn-0')
  expect(f.api.visibleTimelineTurns.value.at(-1)?.id).toBe('turn-199')
  f.api.setTimelineHovered(true)
  expect(f.api.visibleTimelineTurns.value).toHaveLength(200)
  f.api.setTimelineHovered(false)
  expect(f.api.visibleTimelineTurns.value.length).toBeLessThanOrEqual(12)
})

it('cancels pending viewport work on disposal, including callbacks awaiting nextTick', async () => {
  const f = await setup()
  f.api.handleViewportInsetChange()
  expect(f.frames.size).toBeGreaterThan(0)
  f.messages.value[0].content += ' changed'
  f.scope.stop()
  await nextTick(); await nextTick()
  expect(f.frames.size).toBe(0)
})

it('mounts five complete turns and retains assistant/tool content in each turn', async () => {
  const f = await setup()
  f.messages.value = Array.from({ length: 12 }, (_, index) => [
    { id: `user-${index}`, role: 'user' as const, content: `question ${index}`, createdAt: index },
    { id: `reply-${index}`, role: 'assistant' as const, content: `reply ${index}`, createdAt: index,
      segments: [{ kind: 'content' as const, text: '**结果**' }, { kind: 'tool' as const, runId: `tool-${index}` }] },
  ]).flat()
  await f.flush()
  expect(f.api.visibleMessages.value).toHaveLength(10)
  expect(f.api.visibleMessages.value[0].id).toBe('user-7')
  expect(f.api.visibleMessages.value.at(-1)?.segments).toHaveLength(2)
  expect(f.api.hiddenTurnCount.value).toBe(7)
  expect(f.messages.value).toHaveLength(24)
})

it('loads five earlier turns on demand while preserving the previous content position', async () => {
  const f = await setup()
  f.element.scrollTop = 100
  f.api.onListScroll()
  const anchor = f.element.querySelector('[data-message-id]')!
  const anchorTop = anchor.getBoundingClientRect().top
  const loading = f.api.loadEarlierMessages()
  expect(f.api.loadingEarlier.value).toBe(true)
  await loading
  await f.flush()
  expect(f.api.visibleMessages.value[0].id).toBe('turn-190')
  expect(f.api.visibleMessages.value).toHaveLength(10)
  expect(anchor.getBoundingClientRect().top).toBe(anchorTop)
  expect(f.api.followLatest.value).toBe(false)
  f.messages.value[199].content += ' ongoing stream'
  await f.flush()
  expect(f.element.scrollTop).toBe(600)
})

it('follows the latest five turns as new turns arrive and collapses expanded history on return', async () => {
  const f = await setup()
  f.messages.value.push({ id: 'turn-200', role: 'user', content: 'new', createdAt: 200 })
  await f.flush()
  expect(f.api.visibleMessages.value[0].id).toBe('turn-196')
  await f.api.loadEarlierMessages()
  expect(f.api.visibleMessages.value).toHaveLength(10)
  f.api.toggleFollowLatest()
  await f.flush()
  expect(f.api.visibleMessages.value).toHaveLength(5)
  expect(f.api.visibleMessages.value[0].id).toBe('turn-196')
})

it('loads only the target page for an unloaded timeline turn', async () => {
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  const f = await setup()
  await f.api.jumpToTurn('turn-20')
  expect(f.api.visibleMessages.value.map(message => message.id)).toEqual(['turn-20', 'turn-21', 'turn-22', 'turn-23', 'turn-24'])
  expect(f.api.followLatest.value).toBe(false)
  f.element.scrollTop = 19500
  f.api.onListScroll()
  expect(f.api.followLatest.value).toBe(false)
  f.api.toggleFollowLatest()
  await f.flush()
  expect(f.api.visibleMessages.value[0].id).toBe('turn-195')
})

it('resets the window on thread switches and ignores an in-flight history prepend', async () => {
  const f = await setup()
  const loading = f.api.loadEarlierMessages()
  f.conversationKey.value = 'thread-2'
  await loading
  await f.flush()
  expect(f.api.visibleMessages.value).toHaveLength(5)
  expect(f.api.followLatest.value).toBe(true)
  expect(f.api.loadingEarlier.value).toBe(false)
})
