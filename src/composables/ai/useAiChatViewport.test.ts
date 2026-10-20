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
  const rows = messages.value.map((message, index) => ({ dataset: { messageId: message.id }, offsetTop: index * 100 }))
  let top = 0
  const element = {
    scrollHeight: 20000, clientHeight: 500,
    get scrollTop() { return top }, set scrollTop(value: number) { top = Math.max(0, Math.min(value, 19500)) },
    querySelectorAll: () => rows,
  }
  const scope = effectScope(); scopes.push(scope)
  const api = scope.run(() => useAiChatViewport({ messages: () => messages.value, loading: () => true, layoutSignature: () => '' }))!
  api.listRef.value = element as unknown as HTMLElement
  const flush = async () => {
    await nextTick(); await nextTick()
    for (let round = 0; round < 3 && frames.size; round++) {
      const pending = [...frames.values()]; frames.clear()
      pending.forEach(callback => callback(0))
    }
  }
  await flush()
  return { api, scope, messages, element, frames, flush }
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
