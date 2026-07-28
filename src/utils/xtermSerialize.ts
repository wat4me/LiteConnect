import type { Terminal } from '@xterm/xterm'

/**
 * Serialize the last N lines of the active xterm buffer (scrollback + viewport).
 * Strips trailing empty lines; caps total characters for AI prompts.
 */
export function serializeTerminalTail(
  terminal: Terminal | null | undefined,
  opts?: { maxLines?: number; maxChars?: number },
): string {
  if (!terminal) return ''
  const maxLines = Math.max(1, Math.min(opts?.maxLines ?? 80, 400))
  const maxChars = Math.max(200, Math.min(opts?.maxChars ?? 8000, 24000))
  const buffer = terminal.buffer.active
  const total = buffer.length
  if (total <= 0) return ''

  const start = Math.max(0, total - maxLines)
  const lines: string[] = []
  for (let i = start; i < total; i++) {
    const line = buffer.getLine(i)
    if (!line) {
      lines.push('')
      continue
    }
    // translateToString(true) trims right; keep full width for error context
    lines.push(line.translateToString(true))
  }

  // Drop trailing blank lines
  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop()
  }

  let text = lines.join('\n')
  if (text.length > maxChars) {
    text = text.slice(text.length - maxChars)
    const nl = text.indexOf('\n')
    if (nl > 0 && nl < 80) text = text.slice(nl + 1)
    text = `…\n${text}`
  }
  return text
}

/** Prefer selection when present; otherwise terminal tail. */
export function getTerminalContextText(
  terminal: Terminal | null | undefined,
  opts?: { maxLines?: number; maxChars?: number },
): { text: string; source: 'selection' | 'scrollback' | 'empty' } {
  const selection = terminal?.getSelection()?.trim() || ''
  if (selection) {
    const maxChars = opts?.maxChars ?? 8000
    return {
      text: selection.length > maxChars ? selection.slice(0, maxChars) + '…' : selection,
      source: 'selection',
    }
  }
  const text = serializeTerminalTail(terminal, opts)
  if (!text.trim()) return { text: '', source: 'empty' }
  return { text, source: 'scrollback' }
}
