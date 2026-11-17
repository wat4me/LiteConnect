import { nextTick, type Ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ElMessage } from 'element-plus/es/components/message/index'
import { t } from '../../i18n'
import { getTerminalColors, getTerminalMinimumContrastRatio } from '@/composables/app/useTheme'
import { withWallpaperTerminalTheme } from '@/composables/app/useAppBackground'
import type { Theme, CustomColors } from '@/composables/app/useTheme'
import { canMeasureTerminal, planTerminalResize } from '@/utils/terminal/terminalResizePolicy'
import { addAppEventListener, removeAppEventListener } from '@/utils/shared/appEvents'
import { useTerminalSettings } from './useTerminalSettings'

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

  const getTerminal = () => terminal
  const settings = useTerminalSettings({
    getTerminal,
    // Font change changes cell size → PTY cols/rows may change; allow resize.
    onFontChange: () => scheduleTerminalRefresh(true, { forceSshResize: false }),
    onPaletteChange: () => applyTerminalTheme(),
  })
  const {
    fontSize,
    scrollbackLines,
    pasteConfirmEnabled,
    pasteConfirmMaxChars,
    fontFamily,
    terminalPalette,
    loadTerminalSettings,
  } = settings
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

  /** Full local repaint (cross-monitor DPI / sub-row shrink without cols change). */
  function refreshTerminalPaint() {
    if (!terminal) return
    try {
      const rows = terminal.rows
      if (rows > 0) terminal.refresh(0, rows - 1)
    } catch {}
  }

  /**
   * Propose dims first; only fit/clearSelection when geometry changes.
   * Docker↔terminal with unchanged cols/rows: no fit, no clearSelection, no sshResize
   * (local refresh still runs so canvas stays sharp after display moves).
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

      if (plan.kind === 'noop') {
        // Same cols/rows: still repaint (window may have moved across DPI scales).
        refreshTerminalPaint()
        return
      }

      if (plan.kind === 'ssh-only') {
        window.LiteConnect.sshResize(deps.getSessionId(), plan.cols, plan.rows)
        lastSentCols = plan.cols
        lastSentRows = plan.rows
        refreshTerminalPaint()
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
      // ResizeObserver / window resize (incl. multi-monitor move): fit + paint.
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
          // performResize already paints on noop/ssh-only; fit path needs an extra refresh.
          refreshTerminalPaint()
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

  function onWindowGeometryChange() {
    // Multi-monitor drag: element size may be unchanged while DPR / work area shifts.
    syncTerminalSize()
  }

  function attachResizeObserver() {
    if (!deps.terminalRef.value || resizeObserver) return
    if (!workspaceVisible()) return
    resizeObserver = new ResizeObserver(() => {
      syncTerminalSize()
    })
    resizeObserver.observe(deps.terminalRef.value)
    window.addEventListener('resize', onWindowGeometryChange)
  }

  function detachResizeObserver() {
    resizeObserver?.disconnect()
    resizeObserver = null
    window.removeEventListener('resize', onWindowGeometryChange)
    if (resizeDebounceTimer) {
      clearTimeout(resizeDebounceTimer)
      resizeDebounceTimer = null
    }
    cancelScheduledTerminalRefresh()
  }

  function resolveTerminalTheme() {
    const base = getTerminalColors(
      deps.theme.value,
      deps.customColors.value,
      terminalPalette.value,
    )
    // Wallpaper on → semi-transparent terminal bg so the image shows in session area
    const resolved = withWallpaperTerminalTheme(base)
    // The wrapper's padding is painted with the same color as the xterm canvas.
    deps.terminalRef.value?.parentElement?.style.setProperty('--terminal-bg', resolved.background || 'transparent')
    return resolved
  }

  function applyTerminalTheme() {
    if (!terminal) return
    const nextTheme = resolveTerminalTheme()
    // xterm needs both options.theme assignment and a refresh to repaint existing cells
    terminal.options.theme = nextTheme
    terminal.options.minimumContrastRatio = getTerminalMinimumContrastRatio(deps.theme.value, deps.customColors.value, terminalPalette.value)
    try {
      const rows = terminal.rows
      if (rows > 0) terminal.refresh(0, rows - 1)
    } catch {}
    scheduleTerminalRefresh(false)
  }

  function onAppBackgroundChange() {
    applyTerminalTheme()
  }

  function attachSettingsListeners() {
    settings.attachSettingsListeners()
    addAppEventListener('app-background-settings-change', onAppBackgroundChange)
  }

  function detachSettingsListeners() {
    settings.detachSettingsListeners()
    removeAppEventListener('app-background-settings-change', onAppBackgroundChange)
  }

  function createTerminal(connectionName: string) {
    if (!deps.terminalRef.value) return null

    terminal = new Terminal({
      ...settings.baseTerminalOptions(),
      theme: resolveTerminalTheme(),
      minimumContrastRatio: getTerminalMinimumContrastRatio(deps.theme.value, deps.customColors.value, terminalPalette.value),
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
    // Cell metrics change without a container resize; FitAddon + PTY must
    // follow or the canvas overflows the SSH pane (clipped rows / wrapping).
    scheduleTerminalRefresh(false, { forceSshResize: false })
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
