import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
vi.mock('@xterm/xterm', () => ({ Terminal: class {} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@/composables/app/useTheme', () => ({ getTerminalColors: () => ({}), getTerminalMinimumContrastRatio: () => 1 }))
vi.mock('@/composables/app/useAppBackground', () => ({ withWallpaperTerminalTheme: (value: unknown) => value }))
vi.mock('../../i18n', () => ({ t: (value: string) => value }))
import { useXtermInstance } from './useXtermInstance'
afterEach(() => vi.unstubAllGlobals())

it('retains newer remote font, palette and paste settings when the initial read completes late', async () => {
  let finish!: (value: number) => void
  const target = new EventTarget()
  const api = {
    getTerminalFontSize: () => new Promise<number>(resolve => { finish = resolve }), getTerminalFontFamily: async () => 'old font',
    getTerminalPalette: async () => 'dark', getTerminalScrollback: async () => 5000,
    getTerminalPasteConfirmEnabled: async () => true, getTerminalPasteConfirmMaxChars: async () => 500,
  }
  vi.stubGlobal('window', Object.assign(target, { LiteConnect: api }))
  const terminal = useXtermInstance({ terminalRef: ref(), theme: ref('dark'), customColors: ref({ fontColor: '#fff', bgColor: '#000' }),
    getSessionId: () => 'test', getFlushRenderBatch: () => () => {} })
  terminal.attachSettingsListeners()
  const pending = terminal.loadTerminalSettings()
  target.dispatchEvent(new CustomEvent('terminal-font-settings-change', { detail: { fontSize: 18, fontFamily: 'new font' } }))
  target.dispatchEvent(new CustomEvent('terminal-palette-change', { detail: { palette: 'light' } }))
  target.dispatchEvent(new CustomEvent('terminal-behavior-settings-change', { detail: { scrollback: 10000, pasteConfirmEnabled: false } }))
  finish(14); await pending
  expect(terminal.fontSize.value).toBe(18)
  expect(terminal.fontFamily.value).toBe('new font')
  expect(terminal.terminalPalette.value).toBe('light')
  expect(terminal.scrollbackLines.value).toBe(10000)
  expect(terminal.pasteConfirmEnabled.value).toBe(false)
  terminal.detachSettingsListeners()
})
