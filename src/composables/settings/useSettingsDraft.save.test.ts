import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppSettingsAll, AppSettingsAllPatch, AppSettingsChange } from '@shared/types/settings'

const mocks = vi.hoisted(() => ({ setTheme: vi.fn(), setColors: vi.fn(), db: vi.fn(), background: vi.fn(), error: vi.fn(), success: vi.fn(),
  mount: [] as Array<() => void>, unmount: [] as Array<() => void>, unsubscribe: vi.fn() }))
vi.mock('vue', async importOriginal => ({ ...await importOriginal<typeof import('vue')>(), onMounted: (fn: () => void) => mocks.mount.push(fn), onBeforeUnmount: (fn: () => void) => mocks.unmount.push(fn) }))
vi.mock('@/i18n', () => ({ getStoredLocale: () => 'zh-CN', t: (key: string) => key }))
vi.mock('@/composables/app/useAppDialog', () => ({ appConfirm: async () => {} }))
vi.mock('@/composables/app/useTheme', () => ({
  pickInstalledFontFamily: (value?: string) => value || 'monospace',
  useTheme: () => ({ theme: { value: 'dark' }, customColors: { value: { bgColor: '#0d1117', fontColor: '#e6edf3' } }, setTheme: mocks.setTheme, setCustomColors: mocks.setColors }),
}))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { info: vi.fn(), success: mocks.success, error: mocks.error } }))
vi.mock('@/composables/database/useDbSettings', () => ({ dispatchDbSettingsChange: mocks.db }))
vi.mock('@/composables/app/useAppBackground', () => ({
  emptyAppBackgroundState: () => ({ fileName: '', imageUrl: '', fit: 'cover', overlay: 55, token: '', cleared: false }),
  applyAppBackground: mocks.background, clampBackgroundOverlay: (value: number) => value, sanitizeAppBackgroundFit: (value: string) => value,
}))
import { createEmptyDraft, useSettingsDraft } from './useSettingsDraft'
import { buildSettingsDraftPatch } from './settingsDraftPatch'

let stored: AppSettingsAll
const save = vi.fn(), recent = vi.fn()
let changeListener: (change: AppSettingsChange) => void
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.mount.length = 0; mocks.unmount.length = 0
  const defaults = createEmptyDraft()
  stored = {
    ...defaults, configuredDownloadPath: '', defaultDownloadPath: 'Downloads', downloadPath: 'Downloads',
    customColors: null, terminalCommandHistoryExcludePatterns: [], latencyIntervalMs: 10000, monitorIntervalMs: 5000,
    connectionSortMode: 'manual', localeConfigured: true, recentDownloadPaths: [],
    appBackground: { fileName: 'wallpaper.png', imageUrl: 'background://wallpaper', fit: 'cover', overlay: 55 },
  } as AppSettingsAll
  save.mockImplementation(async (patch: AppSettingsAllPatch) => {
    const { appBackground, ...fields } = patch
    Object.assign(stored, fields)
    if (appBackground) stored.appBackground = { ...stored.appBackground, ...appBackground }
    if (patch.downloadPath !== undefined) {
      stored.configuredDownloadPath = patch.downloadPath
      stored.downloadPath = patch.downloadPath || stored.defaultDownloadPath
    }
    return structuredClone(stored)
  })
  recent.mockResolvedValue(undefined)
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    LiteConnect: { getAllSettings: async () => structuredClone(stored), setManySettings: save, addRecentDownloadPath: recent, getRecentDownloadPaths: async () => ['NewDownloads'],
      onSettingsChanged: (callback: typeof changeListener) => { changeListener = callback; return mocks.unsubscribe } },
  })
})

it('merges independent changes from two stale settings pages without re-saving their other fields', async () => {
  const first = useSettingsDraft(), second = useSettingsDraft()
  await first.loadSettings(); await second.loadSettings()
  first.draft.value.x11AutoStartEnabled = false
  first.draft.value.theme = 'light'
  await first.handleSave()
  second.draft.value.terminalFontSize = 18
  await second.handleSave()
  expect(save.mock.calls[1][0]).toEqual({ terminalFontSize: 18 })
  expect(stored.x11AutoStartEnabled).toBe(false)
  expect(stored.theme).toBe('light')
  expect(stored.appBackground.fileName).toBe('wallpaper.png')
  expect(second.draft.value.x11AutoStartEnabled).toBe(false)
  expect(second.draft.value.theme).toBe('light')
  expect(second.isDirty.value).toBe(false)
})

it('keeps nested wallpaper edits limited to the changed properties', () => {
  const baseline = createEmptyDraft(), edited = structuredClone(baseline)
  baseline.appBackground = { fileName: 'old.png', imageUrl: 'background://old', fit: 'cover', overlay: 55 }
  edited.appBackground = { ...baseline.appBackground, overlay: 70 }
  expect(buildSettingsDraftPatch(edited, baseline)).toEqual({ appBackground: { overlay: 70 } })
  edited.appBackground = { ...baseline.appBackground, token: 'picked-image', imageUrl: 'preview://picked' }
  expect(buildSettingsDraftPatch(edited, baseline)).toEqual({ appBackground: { token: 'picked-image' } })
  edited.appBackground = { ...baseline.appBackground, token: '', imageUrl: '', cleared: true }
  expect(buildSettingsDraftPatch(edited, baseline)).toEqual({ appBackground: { clear: true } })
})

it('applies normalized server values instead of the raw submitted draft', async () => {
  const state = useSettingsDraft()
  await state.loadSettings()
  state.draft.value.terminalFontSize = 999
  save.mockResolvedValueOnce({ ...structuredClone(stored), terminalFontSize: 24 })
  await state.handleSave()
  expect(state.draft.value.terminalFontSize).toBe(24)
  const dispatch = vi.mocked(window.dispatchEvent)
  const event = dispatch.mock.calls.map(([event]) => event as CustomEvent).find(event => event.type === 'terminal-font-settings-change')!
  expect(event.detail.fontSize).toBe(24)
  expect(state.isDirty.value).toBe(false)
})

it('retains the dirty draft and does not apply a new theme when saving fails', async () => {
  const state = useSettingsDraft()
  await state.loadSettings()
  state.draft.value.theme = 'custom'
  state.draft.value.fontColor = '#123456'
  save.mockRejectedValueOnce(new Error('storage failed'))
  await state.handleSave()
  expect(mocks.setTheme).not.toHaveBeenCalled()
  expect(mocks.setColors).not.toHaveBeenCalled()
  expect(state.isDirty.value).toBe(true)
  expect(state.draft.value.fontColor).toBe('#123456')
  expect(state.saved.value.theme).toBe('dark')
  expect(mocks.error).toHaveBeenCalledWith('storage failed')
})

it('does not resubmit while saving and finishes a committed save when recent-path bookkeeping fails', async () => {
  const state = useSettingsDraft()
  await state.loadSettings()
  state.draft.value.downloadPath = 'NewDownloads'
  state.draft.value.useSystemDownloadPath = false
  recent.mockRejectedValueOnce(new Error('recent list unavailable'))
  const pending = state.handleSave()
  expect(state.saving.value).toBe(true)
  await state.handleSave()
  await pending
  expect(save).toHaveBeenCalledOnce()
  expect(state.isDirty.value).toBe(false)
  expect(stored.downloadPath).toBe('NewDownloads')
  expect(mocks.error).not.toHaveBeenCalled()
})

it('preserves the explicitly confirmed full reset even when another page changed default-valued fields', async () => {
  const state = useSettingsDraft()
  await state.loadSettings()
  stored.x11AutoStartEnabled = false
  stored.terminalFontSize = 18
  await state.restoreSystemDefaults()
  await state.handleSave()
  expect(stored.x11AutoStartEnabled).toBe(true)
  expect(stored.terminalFontSize).toBe(14)
  expect(save.mock.calls[0][0].appBackground.clear).toBe(true)
})

it('blocks saving and reset after a failed read, and can retry without showing default values as loaded configuration', async () => {
  const state = useSettingsDraft()
  const read = vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(structuredClone(stored))
  window.LiteConnect.getAllSettings = read
  await state.loadSettings()
  expect(state.loading.value).toBe(false)
  expect(state.loadError.value).toBe('database unavailable')
  state.draft.value.terminalFontSize = 18
  await state.handleSave(); await state.restoreSystemDefaults()
  expect(save).not.toHaveBeenCalled()
  await state.loadSettings()
  expect(state.loadError.value).toBe('')
  expect(state.draft.value.terminalFontSize).toBe(stored.terminalFontSize)
  state.draft.value.terminalFontSize = 18
  await state.handleSave()
  expect(save).toHaveBeenCalledOnce()
})

it('rebases a mounted dirty settings page after a remote commit and releases its listener on close', async () => {
  const state = useSettingsDraft()
  mocks.mount.forEach(fn => fn())
  await vi.waitFor(() => expect(state.loading.value).toBe(false))
  state.draft.value.x11AutoStartEnabled = false
  state.draft.value.appBackground.overlay = 70
  stored.terminalFontSize = 18
  stored.appBackground = { fileName: 'remote.png', imageUrl: 'remote-url', fit: 'cover', overlay: 20 }
  changeListener({ settings: structuredClone(stored), changed: ['terminalFontSize', 'appBackground'] })
  expect(state.draft.value.terminalFontSize).toBe(18)
  expect(state.draft.value.appBackground).toMatchObject({ imageUrl: 'remote-url', overlay: 70 })
  expect(state.draft.value.x11AutoStartEnabled).toBe(false)
  expect(state.isDirty.value).toBe(true)
  await state.handleSave()
  expect(save.mock.calls[0][0]).toEqual({ x11AutoStartEnabled: false, appBackground: { overlay: 70 } })
  mocks.unmount.forEach(fn => fn())
  expect(mocks.unsubscribe).toHaveBeenCalledOnce()
})

it('uses a newer committed snapshot received while the initial read was in flight', async () => {
  let finish!: (value: AppSettingsAll) => void
  window.LiteConnect.getAllSettings = () => new Promise(resolve => { finish = resolve })
  const state = useSettingsDraft(), original = structuredClone(stored)
  mocks.mount.forEach(fn => fn())
  stored.terminalFontSize = 18
  changeListener({ settings: structuredClone(stored), changed: ['terminalFontSize'] })
  finish(original)
  await vi.waitFor(() => expect(state.loading.value).toBe(false))
  expect(state.draft.value.terminalFontSize).toBe(18)
})
