import type { IDecoration, IDisposable, IMarker, Terminal } from '@xterm/xterm'
import {
  findLineOccurrences,
  normalizeSelectionOccurrenceNeedle,
  type SelectionRange,
} from '@/utils/terminal/selectionHighlight'

const MAX_TOTAL_OCCURRENCES = 200
const VIEWPORT_OVERSCAN_ROWS = 4
const SELECTION_DEBOUNCE_MS = 60

/**
 * Highlights all visible occurrences of the user's current single-line terminal selection
 * using native xterm decorations (layer: 'bottom'), similar to VS Code / WindTerm.
 */
export function useTerminalSelectionHighlight(options?: {
  /** Skip highlighting while Ctrl+F search is actively highlighting matches. */
  isSearchActive?: () => boolean
}) {
  let boundTerminal: Terminal | null = null
  let listeners: IDisposable[] = []
  let activeDecorations: IDecoration[] = []
  let activeMarkers: IMarker[] = []
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let scrollRafId: number | null = null
  let currentNeedle: string | null = null

  function clearDecorations() {
    for (const d of activeDecorations) {
      try { d.dispose() } catch {}
    }
    for (const m of activeMarkers) {
      try { m.dispose() } catch {}
    }
    activeDecorations = []
    activeMarkers = []
  }

  function cancelTimers() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId)
      scrollRafId = null
    }
  }

  function getActiveSelectionRange(terminal: Terminal): SelectionRange | null {
    const pos = terminal.getSelectionPosition()
    if (!pos) return null
    return {
      startX: pos.start.x,
      startY: pos.start.y,
      endX: pos.end.x,
      endY: pos.end.y,
    }
  }

  function renderOccurrences() {
    clearDecorations()
    const terminal = boundTerminal
    const needle = currentNeedle
    if (!terminal || !needle) return
    if (options?.isSearchActive?.()) return

    const buffer = terminal.buffer.active
    const cursorAbsRow = buffer.baseY + buffer.cursorY
    const startRow = Math.max(0, buffer.viewportY - VIEWPORT_OVERSCAN_ROWS)
    const endRow = Math.min(buffer.length - 1, buffer.viewportY + terminal.rows + VIEWPORT_OVERSCAN_ROWS)
    const activeSel = getActiveSelectionRange(terminal)

    let total = 0
    for (let row = startRow; row <= endRow && total < MAX_TOTAL_OCCURRENCES; row++) {
      const line = buffer.getLine(row)
      if (!line) continue
      const matches = findLineOccurrences(line, row, needle, activeSel, MAX_TOTAL_OCCURRENCES - total)
      if (matches.length === 0) continue

      const marker = terminal.registerMarker(row - cursorAbsRow)
      if (!marker) continue
      activeMarkers.push(marker)

      for (const match of matches) {
        const decoration = terminal.registerDecoration({
          marker,
          x: match.x,
          width: match.width,
          layer: 'bottom',
        })
        if (!decoration) continue
        decoration.onRender((el) => {
          el.classList.add('terminal-selection-occurrence')
        })
        activeDecorations.push(decoration)
        total++
        if (total >= MAX_TOTAL_OCCURRENCES) break
      }
    }
  }

  function scheduleFromSelection() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    const terminal = boundTerminal
    if (!terminal) return
    const nextNeedle = normalizeSelectionOccurrenceNeedle(terminal.getSelection())
    if (!nextNeedle) {
      currentNeedle = null
      clearDecorations()
      return
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (!boundTerminal) return
      currentNeedle = normalizeSelectionOccurrenceNeedle(boundTerminal.getSelection())
      renderOccurrences()
    }, SELECTION_DEBOUNCE_MS)
  }

  function scheduleViewportRefresh() {
    if (!currentNeedle || scrollRafId !== null) return
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null
      renderOccurrences()
    })
  }

  function bindSelectionHighlight(terminal: Terminal) {
    disposeSelectionHighlight()
    boundTerminal = terminal
    listeners = [
      terminal.onSelectionChange(() => scheduleFromSelection()),
      terminal.onScroll(() => scheduleViewportRefresh()),
      terminal.onResize(() => scheduleViewportRefresh()),
    ]
  }

  function disposeSelectionHighlight() {
    cancelTimers()
    clearDecorations()
    currentNeedle = null
    for (const d of listeners) {
      try { d.dispose() } catch {}
    }
    listeners = []
    boundTerminal = null
  }

  return {
    bindSelectionHighlight,
    disposeSelectionHighlight,
    clearSelectionHighlight: () => {
      currentNeedle = null
      clearDecorations()
    },
  }
}
