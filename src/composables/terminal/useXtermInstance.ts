import { ref, nextTick, type Ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ElMessage } from 'element-plus/es/components/message/index'
import { t } from '../../i18n'
import { getTerminalColors, type TerminalPaletteId } from '@/composables/app/useTheme'
import type { Theme, CustomColors } from '@/composables/app/useTheme'
import {
  PASTE_CONFIRM_MAX_CHARS,
  normalizePasteConfirmMaxChars,
} from '@/utils/terminal/terminalPaste'
import { canMeasureTerminal, planTerminalResize } from '@/utils/terminal/terminalResizePolicy'

export function useXtermInstance(deps: {
  terminalRef: Ref<HTMLDivElement | undefined>
  theme: Ref<Theme>
  customColors: Ref<CustomColors>
  getSessionId: () => string
  getFlushRenderBatch: () => (callback?: () => void) => void
  /** When false, never fit/sshResize (Docker host hidden). Defaults true. */
  isWorkspaceVisible?: () => boolean
}) {
  let terminal: Terminal | null = null
  let fitAddon: FitAddon | null = null
  let searchAddon: SearchAddon | null = null
  let webLinksAddon: WebLinksAddon | null = null
  let resizeObserver: ResizeObserver | null = null
  let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null
  let refreshRafId: number | null = null
  let refreshGeneration = 0
  /** Last cols/rows successfully sent via sshResize (dedupe). */
  let lastSentCols = 0
  let lastSentRows = 0

  const fontSize = ref(14)
  const scrollbackLines = ref(5000)
  const pasteConfirmEnabled = ref(true)
  const pasteConfirmMaxChars = ref(PASTE_CONFIRM_MAX_CHARS)
  const fontFamily = ref('Cascadia Code, Fira Code, Consolas, Courier New, monospace')
  const terminalPalette = ref<TerminalPaletteId>('auto')

  const getTerminal = () => terminal
  const getSearchAddon = () => searchAddon
  const getFitAddon = () => fitAddon

  function workspaceVisible(): boolean {
    return deps.isWorkspaceVisible ? deps.isWorkspaceVisible() : true
  }

  function canFitTerminal(): boolean {
    if (!terminal || !fitAddon || !deps.terminalRef.value) return false
    if (!workspaceVisible()) return false
    // Hidden panes (display:none / 0-size) must not fit — avoids wiping layout mid-split
    return canMeasureTerminal({
      width: deps.terminalRef.value.offsetWidth,
      height: deps.terminalRef.value.offsetHeight,
    })
  }

  /**
   * Propose dims first; only fit/clearSelection when geometry changes.
   * Docker↔terminal with unchanged cols/rows: no fit, no clearSelection, no sshResize
   * (local refresh/focus still runs via scheduleTerminalRefresh).
   */
  function performResize(options?: { forceSshResize?: boolean; skipSshResize?: boolean }) {
    if (!canFitTerminal() || !terminal || !fitAddon) return
    try {
      const proposed = fitAddon.proposeDimensions()
      const lastSent =
        lastSentCols > 0 && lastSentRows > 0
          ? { cols: lastSentCols, rows: lastSentRows }
          : null
      const plan = planTerminalResize({
        proposed: proposed ?? null,
        current: { cols: terminal.cols, rows: terminal.rows },
        lastSent,
        forceSshResize: options?.forceSshResize,
        skipSshResize: options?.skipSshResize,
      })

      if (plan.kind === 'noop') return

      if (plan.kind === 'ssh-only') {
        window.LiteConnect.sshResize(deps.getSessionId(), plan.cols, plan.rows)
        lastSentCols = plan.cols
        lastSentRows = plan.rows
        return
      }

      // kind === 'fit'
      if (terminal.hasSelection()) {
        terminal.clearSelection()
      }
      fitAddon.fit()
      if (plan.sendSsh) {
        window.LiteConnect.sshResize(deps.getSessionId(), plan.cols, plan.rows)
        lastSentCols = plan.cols
        lastSentRows = plan.rows
      }
    } catch {}
  }

  function syncTerminalSize() {
    if (!canFitTerminal()) return
    if (resizeDebounceTimer) {
      clearTimeout(resizeDebounceTimer)
      resizeDebounceTimer = null
    }
    resizeDebounceTimer = setTimeout(() => {
      resizeDebounceTimer = null
      if (!canFitTerminal()) return
      deps.getFlushRenderBatch()(() => performResize())
    }, 80)
  }

  function cancelScheduledTerminalRefresh() {
    refreshGeneration += 1
    if (refreshRafId != null) {
      try {
        cancelAnimationFrame(refreshRafId)
      } catch {}
      refreshRafId = null
    }
  }

  /**
   * Local fit + refresh + optional focus after layout becomes visible.
   * Stale rAF/nextTick cancelled when workspace hides or generation bumps.
   */
  function scheduleTerminalRefresh(shouldFocus = false, options?: { forceSshResize?: boolean }) {
    if (!workspaceVisible()) return
    const gen = ++refreshGeneration
    if (refreshRafId != null) {
      try {
        cancelAnimationFrame(refreshRafId)
      } catch {}
      refreshRafId = null
    }
    const runRaf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => {
            cb(0)
            return 0
          }
    refreshRafId = runRaf(() => {
      refreshRafId = null
      void nextTick(() => {
        if (gen !== refreshGeneration) return
        if (!workspaceVisible()) return
        if (!terminal || !fitAddon || !deps.terminalRef.value) return
        if (resizeDebounceTimer) {
          clearTimeout(resizeDebounceTimer)
          resizeDebounceTimer = null
        }
        const afterWrite = () => {
          if (gen !== refreshGeneration || !workspaceVisible()) return
          performResize({ forceSshResize: options?.forceSshResize })
          try {
            terminal!.refresh(0, terminal!.rows - 1)
          } catch {}
          if (shouldFocus && gen === refreshGeneration && workspaceVisible()) {
            try {
              terminal!.focus()
            } catch {}
          }
        }
        deps.getFlushRenderBatch()(afterWrite)
      })
    })
  }

  function attachResizeObserver() {
    if (!deps.terminalRef.value || resizeObserver) return
    if (!workspaceVisible()) return
    resizeObserver = new ResizeObserver(() => {
      syncTerminalSize()
    })
    resizeObserver.observe(deps.terminalRef.value)
  }

  function detachResizeObserver() {
    resizeObserver?.disconnect()
    resizeObserver = null
    if (resizeDebounceTimer) {
      clearTimeout(resizeDebounceTimer)
      resizeDebounceTimer = null
    }
    cancelScheduledTerminalRefresh()
  }

  function applyTerminalTheme() {
    if (!terminal) return
    const nextTheme = getTerminalColors(deps.theme.value, deps.customColors.value, terminalPalette.value)
    // xterm needs both options.theme assignment and a refresh to repaint existing cells
    terminal.options.theme = nextTheme
    try {
      const rows = terminal.rows
      if (rows > 0) terminal.refresh(0, rows - 1)
    } catch {}
    scheduleTerminalRefresh(false)
  }

  function onTerminalFontSettingsChange(e: Event) {
    const detail = (e as CustomEvent).detail || {}
    if (typeof detail.fontSize === 'number' && terminal) {
      fontSize.value = detail.fontSize
      terminal.options.fontSize = detail.fontSize
    }
    if (typeof detail.fontFamily === 'string' && terminal) {
      fontFamily.value = detail.fontFamily
      terminal.options.fontFamily = detail.fontFamily
    }
    // Font change changes cell size → PTY cols/rows may change; allow resize.
    scheduleTerminalRefresh(true, { forceSshResize: false })
  }

  function onTerminalPaletteChange(e: Event) {
    const detail = (e as CustomEvent).detail || {}
    if (typeof detail.palette === 'string') {
      terminalPalette.value = detail.palette as TerminalPaletteId
      applyTerminalTheme()
    }
  }

  function onTerminalBehaviorChange(e: Event) {
    const detail = (e as CustomEvent).detail || {}
    if (typeof detail.scrollback === 'number' && terminal) {
      scrollbackLines.value = detail.scrollback
      terminal.options.scrollback = detail.scrollback
    }
    if (typeof detail.pasteConfirmEnabled === 'boolean') {
      pasteConfirmEnabled.value = detail.pasteConfirmEnabled
    }
    if (detail.pasteConfirmMaxChars !== undefined) {
      pasteConfirmMaxChars.value = normalizePasteConfirmMaxChars(detail.pasteConfirmMaxChars)
    }
  }

  function attachSettingsListeners() {
    window.addEventListener('terminal-font-settings-change', onTerminalFontSettingsChange)
    window.addEventListener('terminal-palette-change', onTerminalPaletteChange)
    window.addEventListener('terminal-behavior-settings-change', onTerminalBehaviorChange)
  }

  function detachSettingsListeners() {
    window.removeEventListener('terminal-font-settings-change', onTerminalFontSettingsChange)
    window.removeEventListener('terminal-palette-change', onTerminalPaletteChange)
    window.removeEventListener('terminal-behavior-settings-change', onTerminalBehaviorChange)
  }

  async function loadTerminalSettings() {
    try {
      const [size, family, palette, scrollback, pasteConfirm, pasteMaxChars] = await Promise.all([
        window.LiteConnect.getTerminalFontSize(),
        window.LiteConnect.getTerminalFontFamily(),
        window.LiteConnect.getTerminalPalette(),
        window.LiteConnect.getTerminalScrollback(),
        window.LiteConnect.getTerminalPasteConfirmEnabled(),
        window.LiteConnect.getTerminalPasteConfirmMaxChars().catch(() => PASTE_CONFIRM_MAX_CHARS),
      ])
      fontSize.value = size
      fontFamily.value = family
      terminalPalette.value = (palette as TerminalPaletteId) || 'auto'
      scrollbackLines.value = scrollback
      pasteConfirmEnabled.value = pasteConfirm
      pasteConfirmMaxChars.value = normalizePasteConfirmMaxChars(pasteMaxChars)
    } catch {
      fontSize.value = 14
    }
  }

  function createTerminal(connectionName: string) {
    if (!deps.terminalRef.value) return null

    terminal = new Terminal({
      cursorBlink: true,
      fontSize: fontSize.value,
      fontFamily: fontFamily.value,
      theme: getTerminalColors(deps.theme.value, deps.customColors.value, terminalPalette.value),
      allowProposedApi: true,
      scrollback: scrollbackLines.value,
    })

    fitAddon = new FitAddon()
    searchAddon = new SearchAddon()
    webLinksAddon = new WebLinksAddon((_event, uri) => {
      void window.LiteConnect.openExternal(uri).catch(() => {
        ElMessage.error(t('terminal.openLinkFailed'))
      })
    })
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)
    terminal.loadAddon(webLinksAddon)

    terminal.open(deps.terminalRef.value)
    terminal.writeln(`\x1b[1;34mConnecting to ${connectionName}...\x1b[0m\r\n`)

    terminal.onScroll((newPosition: number) => {
      const bufferLength = terminal!.buffer.active.length
      if (newPosition < bufferLength - terminal!.rows && terminal!.hasSelection()) {
        terminal!.clearSelection()
      }
    })

    return terminal
  }

  function disposeTerminal() {
    if (resizeDebounceTimer) {
      clearTimeout(resizeDebounceTimer)
      resizeDebounceTimer = null
    }
    cancelScheduledTerminalRefresh()
    detachResizeObserver()
    detachSettingsListeners()
    terminal?.dispose()
    webLinksAddon = null
    searchAddon = null
    fitAddon = null
    terminal = null
    lastSentCols = 0
    lastSentRows = 0
  }

  function setFontSize(size: number) {
    fontSize.value = size
    if (terminal) terminal.options.fontSize = size
  }

  /** Test helper: last dimensions sent to remote. */
  function getLastSentDimensions() {
    return lastSentCols > 0 && lastSentRows > 0
      ? { cols: lastSentCols, rows: lastSentRows }
      : null
  }

  return {
    getTerminal,
    getSearchAddon,
    getFitAddon,
    fontSize,
    scrollbackLines,
    pasteConfirmEnabled,
    pasteConfirmMaxChars,
    fontFamily,
    terminalPalette,
    canFitTerminal,
    performResize,
    syncTerminalSize,
    scheduleTerminalRefresh,
    cancelScheduledTerminalRefresh,
    attachResizeObserver,
    detachResizeObserver,
    applyTerminalTheme,
    attachSettingsListeners,
    detachSettingsListeners,
    loadTerminalSettings,
    createTerminal,
    disposeTerminal,
    setFontSize,
    getLastSentDimensions,
  }
}
