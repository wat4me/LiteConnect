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
  /** Bare PageUp/PageDown on the normal buffer. Fired once per app run. */
  onBarePageKey?: () => void
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

    if (isBarePageKey(event) && !isAlternateScreen(terminal) && takePageScrollHint()) {
      deps.onBarePageKey?.()
    }

    return true
  }

  return { handleKey }
}

let pageScrollHintTaken = false

export function resetPageScrollHintForTests(): void {
  pageScrollHintTaken = false
}

function takePageScrollHint(): boolean {
  if (pageScrollHintTaken) return false
  pageScrollHintTaken = true
  return true
}

function isBarePageKey(event: KeyboardEvent): boolean {
  if (event.repeat) return false
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false
  return event.key === 'PageUp' || event.key === 'PageDown'
}

function isAlternateScreen(terminal: Terminal | null): boolean {
  return terminal?.buffer.active.type === 'alternate'
}
