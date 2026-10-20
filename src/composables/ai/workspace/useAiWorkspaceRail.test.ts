import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useAiWorkspaceRail } from './useAiWorkspaceRail'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.unstubAllGlobals() })
function setup(saved: string | null = null) {
  let resize!: ResizeObserverCallback
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback }
    observe() {}
    disconnect = disconnect
  })
  const setItem = vi.fn()
  vi.stubGlobal('localStorage', { getItem: () => saved, setItem })
  const chat = ref(false)
  const scope = effectScope(); scopes.push(scope)
  const api = scope.run(() => useAiWorkspaceRail(() => chat.value))!
  api.workspaceElement.value = { getBoundingClientRect: () => ({ width: 680 }) } as HTMLElement
  const resizeTo = (width: number) => resize([{ contentRect: { width } }] as ResizeObserverEntry[], {} as ResizeObserver)
  return { api, chat, scope, resizeTo, disconnect, setItem }
}
it('collapses narrow chats and expands browsing until the user makes an explicit choice', async () => {
  const f = setup()
  await nextTick()
  expect(f.api.railCollapsed.value).toBe(false)
  f.chat.value = true
  expect(f.api.railCollapsed.value).toBe(true)
  f.resizeTo(1050)
  expect(f.api.railCollapsed.value).toBe(false)
  f.api.railCollapsed.value = false
  f.resizeTo(520)
  expect(f.api.railCollapsed.value).toBe(false)
  expect(f.setItem).toHaveBeenCalledWith('LiteConnect.aiWorkspace.railCollapsed', 'false')
  f.scope.stop()
  expect(f.disconnect).toHaveBeenCalledOnce()
})
it.each(['true', 'false'])('restores the explicit %s preference before measuring the layout', async saved => {
  const f = setup(saved)
  f.chat.value = true
  await nextTick()
  f.resizeTo(saved === 'true' ? 1050 : 520)
  expect(f.api.railCollapsed.value).toBe(saved === 'true')
})
