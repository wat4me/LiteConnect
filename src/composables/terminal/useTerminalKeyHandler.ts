import type { Terminal } from '@xterm/xterm'

export function useTerminalKeyHandler(deps: {
  getTerminal: () => Terminal | null
  getFontSize: () => number
  setFontSize: (size: number) => void
  toggleSearch: () => void
  /** Paste with optional multi-line confirm */
  pasteText?: (text: string) => void | Promise<void>
}) {
  const MIN_FONT_SIZE = 10
  const MAX_FONT_SIZE = 24

  function handleKey(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return true
    const terminal = deps.getTerminal()
    const ctrlOrCmd = event.ctrlKey || event.metaKey

    if (ctrlOrCmd && event.key === '=') {
      event.preventDefault()
      const currentSize = deps.getFontSize()
      if (currentSize < MAX_FONT_SIZE) {
        deps.setFontSize(currentSize + 1)
      }
      return false
    }

    if (ctrlOrCmd && event.key === '-') {
      event.preventDefault()
      const currentSize = deps.getFontSize()
      if (currentSize > MIN_FONT_SIZE) {
        deps.setFontSize(currentSize - 1)
      }
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
