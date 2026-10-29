import { afterEach, expect, it, vi } from 'vitest'
import type { AppSettingsAll } from '@shared/types/settings'
import type { SettingsDraft } from './useSettingsDraft'
const mocks = vi.hoisted(() => ({ theme: vi.fn(), colors: vi.fn(), background: vi.fn(), db: vi.fn() }))
vi.mock('@/composables/app/useTheme', () => ({ useTheme: () => ({ setTheme: mocks.theme, setCustomColors: mocks.colors }) }))
vi.mock('@/composables/app/useAppBackground', () => ({ applyAppBackground: mocks.background }))
vi.mock('@/composables/database/useDbSettings', () => ({ dispatchDbSettingsChange: mocks.db }))
import { applyAppSettings } from './applyAppSettings'
import { rebaseSettingsDraft } from './rebaseSettingsDraft'
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

it('updates remote terminal, file and SQL displays without rewriting or resetting unrelated appearance', () => {
  const dispatch = vi.fn()
  vi.stubGlobal('window', { dispatchEvent: dispatch })
  applyAppSettings({ terminalFontSize: 18, terminalFontFamily: 'monospace', terminalPalette: 'light', sftpFontSize: 16,
    dbFontFamily: 'monospace', dbFontSize: 17, dbPageSize: 100, dbConfirmDangerousSql: true,
    dbDefaultMaxRows: 1000, dbDefaultQueryTimeoutSec: 120, dbDefaultRunScope: 'smart' } as AppSettingsAll,
  ['terminalFontSize', 'terminalPalette', 'sftpFontSize', 'dbFontSize'])
  expect(dispatch.mock.calls.map(([event]) => (event as Event).type)).toEqual(['sftp-font-settings-change', 'terminal-font-settings-change', 'terminal-palette-change'])
  expect(mocks.db).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 17 }))
  expect(mocks.theme).not.toHaveBeenCalled()
  expect(mocks.background).not.toHaveBeenCalled()
})

it('preserves local unsaved fields while adopting a new committed wallpaper and untouched settings', () => {
  const baseline = { theme: 'dark', terminalFontSize: 14, x11AutoStartEnabled: true,
    appBackground: { fileName: 'old.png', imageUrl: 'old-url', fit: 'cover', overlay: 55, token: '', cleared: false } } as SettingsDraft
  const draft = structuredClone(baseline)
  draft.x11AutoStartEnabled = false
  draft.appBackground.overlay = 70
  const incoming = { ...structuredClone(baseline), terminalFontSize: 18, appBackground: { ...baseline.appBackground, fileName: 'new.png', imageUrl: 'new-url', overlay: 20 } }
  const result = rebaseSettingsDraft(draft, baseline, incoming)
  expect(result.terminalFontSize).toBe(18)
  expect(result.x11AutoStartEnabled).toBe(false)
  expect(result.appBackground).toMatchObject({ fileName: 'new.png', imageUrl: 'new-url', overlay: 70 })
  expect(incoming.appBackground.overlay).toBe(20)
})
