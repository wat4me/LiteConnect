import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useAiSidebarModelMenu } from './useAiSidebarModelMenu'
import type { AiSettings } from '@shared/types/ai'

vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { warning: vi.fn() } }))
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.unstubAllGlobals() })

function fixture(refreshSettings: () => Promise<unknown> = async () => {}) {
  const active = ref(true)
  const settings = ref<AiSettings>({ providers: [], activeProviderId: null, activeModel: '', systemPrompt: '' })
  const applyExternal = vi.fn()
  const scope = effectScope(); scopes.push(scope)
  const api = scope.run(() => useAiSidebarModelMenu({
    settings, loading: () => false, saving: () => false, active: () => active.value,
    refreshSettings, replaceSettings: next => { settings.value = next }, applyExternal,
    closeHistory: () => {}, t: key => key,
  }))!
  return { api, applyExternal, scope, active }
}

it('does not reopen settings when a delayed refresh finishes after close', async () => {
  let finish!: () => void
  const f = fixture(() => new Promise<void>(resolve => { finish = resolve }))
  const pending = f.api.openSettingsPanel()
  f.api.closeSettingsPanel()
  finish()
  await pending
  expect(f.api.showSettings.value).toBe(false)
  expect(f.applyExternal).not.toHaveBeenCalled()
})

it('does not reopen settings when switching away and back during a pending refresh', async () => {
  let finish!: () => void
  const f = fixture(() => new Promise<void>(resolve => { finish = resolve }))
  const opening = f.api.openSettingsPanel()
  f.active.value = false
  await nextTick()
  f.active.value = true
  finish()
  await opening
  expect(f.api.showSettings.value).toBe(false)
  expect(f.applyExternal).not.toHaveBeenCalled()
})

it('serializes model selection while the previous settings write is pending', async () => {
  let finish!: (settings: AiSettings) => void
  const select = vi.fn(() => new Promise<AiSettings>(resolve => { finish = resolve }))
  vi.stubGlobal('window', { LiteConnect: { switchAiModel: select } })
  const f = fixture()
  const switching = f.api.switchModel('provider', 'first')
  await f.api.switchModel('provider', 'second')
  expect(select).toHaveBeenCalledExactlyOnceWith('provider', 'first')
  finish({ providers: [], activeProviderId: 'provider', activeModel: 'first', systemPrompt: '' })
  await switching
  expect(f.applyExternal).toHaveBeenCalledOnce()
})

it('cancels a pending positioning frame on scope disposal', async () => {
  const frames = new Map<number, FrameRequestCallback>()
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id })
  const cancel = vi.fn((frame: number) => { frames.delete(frame) })
  vi.stubGlobal('cancelAnimationFrame', cancel)
  const f = fixture()
  f.api.showModelSwitcher.value = true
  await nextTick()
  await nextTick()
  expect(frames.size).toBe(1)
  f.scope.stop()
  await Promise.resolve()
  expect(cancel).toHaveBeenCalledOnce()
  expect(frames.size).toBe(0)
  expect(f.api.modelSwitcherStyle.value).toEqual({})
})
