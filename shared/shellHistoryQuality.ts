/**
 * Structural check for a line before it becomes (or stays) a history suggestion.
 * Runs on every write and when stored history is loaded, so lines captured by
 * older builds (prompt prefixes, continuation fragments, half-quoted wraps) are
 * removed. It cannot judge whether a command succeeded — that is decided from
 * the terminal output before the line is pushed.
 */
export function isPlausibleShellCommand(command: string): boolean {
  const text = String(command || '').trim()
  if (!text) return false
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(text)) return false
  // A fragment of a pipeline, list or redirection (e.g. captured after "> ").
  if (/^(?:\||&|;|\)|\}|>|<|=)/.test(text)) return false
  // Incomplete: the shell would have waited for a continuation line.
  if (/(?:\|\||&&|\||\\)$/.test(text)) return false
  // A shell prompt captured together with the command ("ops@host:~$ ls").
  if (/^[^\s@]+@[^\s:]+[:\s][^\s]*[$#%]\s/.test(text) || /^\[[^\]]+@[^\]]+\][$#%]\s/.test(text)) return false
  if (!quotesBalanced(text)) return false
  return true
}

/** Unterminated quotes mean only part of a wrapped or multi-line command was read. */
function quotesBalanced(text: string): boolean {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote === "'") { if (ch === "'") quote = null; continue }
    if (ch === '\\') { i++; continue }
    if (quote === '"') { if (ch === '"') quote = null; continue }
    if (ch === '"' || ch === "'") quote = ch
  }
  return quote === null
}
