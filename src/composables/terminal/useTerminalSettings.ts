import { ref } from 'vue'
import type { ITerminalOptions, Terminal } from '@xterm/xterm'
import type { TerminalPaletteId } from '@/composables/app/useTheme'
import { PASTE_CONFIRM_MAX_CHARS, normalizePasteConfirmMaxChars } from '@/utils/terminal/terminalPaste'
import {
  addAppEventListener,
  removeAppEventListener,
  type AppEvent,
  type AppEventMap,
} from '@/utils/shared/appEvents'

/**
 * Terminal font, palette, scrollback and paste settings shared by every xterm host
 * (SSH tabs and Docker exec terminals). Owns the initial read, the settings-change
 * listeners and writing the values into a live terminal; hosts keep their own
 * resize and theme application through the two callbacks.
 */
export function useTerminalSettings(deps: {
  getTerminal: () => Terminal | null
  /** Cell metrics changed: the host must refit and resize its remote PTY. */
  onFontChange: () => void
  /** Palette changed: the host must rebuild and apply its theme. */
  onPaletteChange: () => void
}) {
  const fontSize = ref(14)
  const fontFamily = ref('Cascadia Code, Fira Code, Consolas, Courier New, monospace')
  const terminalPalette = ref<TerminalPaletteId>('auto')
  const scrollbackLines = ref(5000)
  const pasteConfirmEnabled = ref(true)
  const pasteConfirmMaxChars = ref(PASTE_CONFIRM_MAX_CHARS)
  // A change event that arrives while the initial read is pending wins over the read.
  let fontVersion = 0, paletteVersion = 0, behaviorVersion = 0

  function onFontSettingsChange(e: AppEvent<'terminal-font-settings-change'>) {
    fontVersion++
    const detail: AppEventMap['terminal-font-settings-change'] = e.detail || {}
    const terminal = deps.getTerminal()
    if (typeof detail.fontSize === 'number') {
      fontSize.value = detail.fontSize
      if (terminal) terminal.options.fontSize = detail.fontSize
    }
    if (typeof detail.fontFamily === 'string') {
      fontFamily.value = detail.fontFamily
      if (terminal) terminal.options.fontFamily = detail.fontFamily
    }
    deps.onFontChange()
  }

  function onPaletteSettingsChange(e: AppEvent<'terminal-palette-change'>) {
    const detail: AppEventMap['terminal-palette-change'] = e.detail || {}
    if (typeof detail.palette !== 'string') return
    paletteVersion++
    terminalPalette.value = detail.palette as TerminalPaletteId
    deps.onPaletteChange()
  }

  function onBehaviorSettingsChange(e: AppEvent<'terminal-behavior-settings-change'>) {
    behaviorVersion++
    const detail: AppEventMap['terminal-behavior-settings-change'] = e.detail || {}
    if (typeof detail.scrollback === 'number') {
      scrollbackLines.value = detail.scrollback
      const terminal = deps.getTerminal()
      if (terminal) terminal.options.scrollback = detail.scrollback
    }
    if (typeof detail.pasteConfirmEnabled === 'boolean') pasteConfirmEnabled.value = detail.pasteConfirmEnabled
    if (detail.pasteConfirmMaxChars !== undefined) {
      pasteConfirmMaxChars.value = normalizePasteConfirmMaxChars(detail.pasteConfirmMaxChars)
    }
  }

  function attachSettingsListeners() {
    addAppEventListener('terminal-font-settings-change', onFontSettingsChange)
    addAppEventListener('terminal-palette-change', onPaletteSettingsChange)
    addAppEventListener('terminal-behavior-settings-change', onBehaviorSettingsChange)
  }

  function detachSettingsListeners() {
    removeAppEventListener('terminal-font-settings-change', onFontSettingsChange)
    removeAppEventListener('terminal-palette-change', onPaletteSettingsChange)
    removeAppEventListener('terminal-behavior-settings-change', onBehaviorSettingsChange)
  }

  async function loadTerminalSettings() {
    const versions = { font: fontVersion, palette: paletteVersion, behavior: behaviorVersion }
    try {
      const [size, family, palette, scrollback, pasteConfirm, pasteMaxChars] = await Promise.all([
        window.LiteConnect.getTerminalFontSize(),
        window.LiteConnect.getTerminalFontFamily(),
        window.LiteConnect.getTerminalPalette(),
        window.LiteConnect.getTerminalScrollback(),
        window.LiteConnect.getTerminalPasteConfirmEnabled(),
        window.LiteConnect.getTerminalPasteConfirmMaxChars().catch(() => PASTE_CONFIRM_MAX_CHARS),
      ])
      if (versions.font === fontVersion) { fontSize.value = size; fontFamily.value = family }
      if (versions.palette === paletteVersion) terminalPalette.value = (palette as TerminalPaletteId) || 'auto'
      if (versions.behavior === behaviorVersion) {
        scrollbackLines.value = scrollback
        pasteConfirmEnabled.value = pasteConfirm
        pasteConfirmMaxChars.value = normalizePasteConfirmMaxChars(pasteMaxChars)
      }
    } catch {
      if (versions.font === fontVersion) fontSize.value = 14
    }
  }

  /** Constructor options common to every terminal host; hosts add their own theme. */
  function baseTerminalOptions(): ITerminalOptions {
    return {
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      cursorInactiveStyle: 'bar',
      fontSize: fontSize.value,
      fontFamily: fontFamily.value,
      allowProposedApi: true,
      scrollback: scrollbackLines.value,
    }
  }

  return {
    fontSize,
    fontFamily,
    terminalPalette,
    scrollbackLines,
    pasteConfirmEnabled,
    pasteConfirmMaxChars,
    attachSettingsListeners,
    detachSettingsListeners,
    loadTerminalSettings,
    baseTerminalOptions,
  }
}
