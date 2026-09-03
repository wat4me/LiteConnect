import type { Terminal } from '@xterm/xterm'
import {
  isTerminalFontZoomInKey,
  isTerminalFontZoomOutKey,
  stepTerminalFontSize,
} from '@/utils/terminal/terminalFontZoom'

export function useTerminalKeyHandler(deps: {
  getTerminal: () => Terminal | null
  getFontSize: () => number
  setFontSize: (size: number) => void
  toggleSearch: () => void
  /** Paste with optional multi-line confirm */
  pasteText?: (text: string) => void | Promise<void>
}) {
  function handleKey(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return true
    const terminal = deps.getTerminal()
    const ctrlOrCmd = event.ctrlKey || event.metaKey

    if (isTerminalFontZoomInKey(event)) {
      event.preventDefault()
      const next = stepTerminalFontSize(deps.getFontSize(), 1)
      if (next !== deps.getFontSize()) deps.setFontSize(next)
      return false
    }

    if (isTerminalFontZoomOutKey(event)) {
      event.preventDefault()
      const next = stepTerminalFontSize(deps.getFontSize(), -1)
      if (next !== deps.getFontSize()) deps.setFontSize(next)
      return false
    }

    if (ctrlOrCmd && event.key === 'f') {
      event.preventDefault()
      deps.toggleSearch()
      return false
    }

    if (ctrlOrCmd && event.key === 'v') {
      event.preventDefault()
      window.LiteConnect
        .clipboardReadText()
        .then((text: string) => {
          if (!text || !terminal) return
          if (deps.pasteText) {
            void deps.pasteText(text)
          } else {
            terminal.paste(text)
          }
        })
        .catch(() => {})
      return false
    }

    if (event.ctrlKey && !event.metaKey && event.key === 'c') {
      if (terminal && terminal.hasSelection()) {
        event.preventDefault()
        const text = terminal.getSelection()
        window.LiteConnect.clipboardWriteText(text).catch(() => {})
        return false
      }
      return true
    }

    if (event.metaKey && !event.ctrlKey && event.key === 'c') {
      if (terminal && terminal.hasSelection()) {
        event.preventDefault()
        const text = terminal.getSelection()
        window.LiteConnect.clipboardWriteText(text).catch(() => {})
      }
      return false
    }

    return true
  }

  return { handleKey }
}
