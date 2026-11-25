import type { TerminalHighlightColor, TerminalHighlightRule } from '@shared/terminalHighlight'

const MAX_HIGHLIGHT_CHUNK_CHARS = 64 * 1024

const FG_SGR: Record<TerminalHighlightColor, string> = {
  red: '31',
  green: '32',
  yellow: '33',
  blue: '34',
  magenta: '35',
  cyan: '36',
}

// Pair each ANSI background with a high-contrast foreground so chips stay legible on light & dark themes.
const BG_SGR: Record<TerminalHighlightColor, string> = {
  red: '41;97',
  green: '42;30',
  yellow: '43;30',
  blue: '44;97',
  magenta: '45;97',
  cyan: '46;30',
}

interface CompiledRule {
  regex: RegExp
  openSeq: string
  overrideColor: boolean
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildOpenSeq(rule: TerminalHighlightRule): string {
  const parts: string[] = []
  if (rule.bold) parts.push('1')
  parts.push(rule.background ? BG_SGR[rule.color] : FG_SGR[rule.color])
  return `\x1b[${parts.join(';')}m`
}

function compileRules(rules: readonly TerminalHighlightRule[]): CompiledRule[] {
  const compiled: CompiledRule[] = []
  for (const rule of rules) {
    if (!rule.enabled) continue
    const raw = rule.pattern.trim()
    if (!raw) continue
    const source = rule.isRegex ? raw : escapeRegExp(raw)
    try {
      const regex = new RegExp(source, rule.caseSensitive ? 'g' : 'gi')
      compiled.push({ regex, openSeq: buildOpenSeq(rule), overrideColor: !!rule.overrideColor })
    } catch {
      // Skip invalid user regex gracefully
    }
  }
  return compiled
}

// Matches complete CSI, OSC, or 2-byte ESC sequences.
const ANSI_TOKEN_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

export interface TerminalHighlighter {
  setEnabled: (enabled: boolean) => void
  setRules: (rules: readonly TerminalHighlightRule[]) => void
  reset: () => void
  transform: (data: string, skip?: boolean) => string
}

/**
 * Stateful, ANSI-aware stream highlighter for xterm.js output.
 * - Never rewrites inside ANSI escape sequences.
 * - Never overrides text that already carries an explicit foreground or background color.
 * - Leaves full-screen TUI apps untouched when `skip` (e.g. alternate buffer) is true.
 */
export function createTerminalHighlighter(
  initialEnabled = true,
  initialRules: readonly TerminalHighlightRule[] = [],
): TerminalHighlighter {
  let enabled = initialEnabled
  let compiled = compileRules(initialRules)
  let activeFgParam: string | null = null
  let activeBgParam: string | null = null
  let hasBold = false

  function applySgrSequence(seq: string) {
    // Only CSI ... m sequences modify SGR attributes
    if (!seq.startsWith('\x1b[') || !seq.endsWith('m')) return
    const body = seq.slice(2, -1)
    if (body === '' || body === '0') {
      activeFgParam = null
      activeBgParam = null
      hasBold = false
      return
    }
    const params = body.split(';')
    for (let i = 0; i < params.length; i++) {
      const code = Number(params[i] || '0')
      if (Number.isNaN(code)) continue
      if (code === 0) {
        activeFgParam = null
        activeBgParam = null
        hasBold = false
      } else if (code === 1) {
        hasBold = true
      } else if (code === 22) {
        hasBold = false
      } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
        activeFgParam = String(code)
      } else if (code === 39) {
        activeFgParam = null
      } else if (code === 38) {
        const mode = Number(params[i + 1])
        if (mode === 5 && params[i + 2] !== undefined) {
          activeFgParam = `38;5;${params[i + 2]}`
          i += 2
        } else if (mode === 2 && params[i + 4] !== undefined) {
          activeFgParam = `38;2;${params[i + 2]};${params[i + 3]};${params[i + 4]}`
          i += 4
        } else {
          activeFgParam = '38'
        }
      } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
        activeBgParam = String(code)
      } else if (code === 49) {
        activeBgParam = null
      } else if (code === 48) {
        const mode = Number(params[i + 1])
        if (mode === 5 && params[i + 2] !== undefined) {
          activeBgParam = `48;5;${params[i + 2]}`
          i += 2
        } else if (mode === 2 && params[i + 4] !== undefined) {
          activeBgParam = `48;2;${params[i + 2]};${params[i + 3]};${params[i + 4]}`
          i += 4
        } else {
          activeBgParam = '48'
        }
      }
    }
  }

  function buildRestoreSeq(): string {
    const parts: string[] = []
    parts.push(activeFgParam ?? '39')
    parts.push(activeBgParam ?? '49')
    if (!hasBold) parts.push('22')
    return `\x1b[${parts.join(';')}m`
  }

  function highlightPlainText(text: string): string {
    if (!text || compiled.length === 0) return text
    const colored = activeFgParam !== null || activeBgParam !== null

    // Collect non-overlapping matches; earlier rules win on ties at the same start offset.
    type Span = { start: number; end: number; openSeq: string; priority: number }
    const spans: Span[] = []
    for (let priority = 0; priority < compiled.length; priority++) {
      const rule = compiled[priority]
      if (colored && !rule.overrideColor) continue
      rule.regex.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = rule.regex.exec(text)) !== null) {
        const value = match[0]
        if (value.length === 0) {
          rule.regex.lastIndex++
          continue
        }
        spans.push({
          start: match.index,
          end: match.index + value.length,
          openSeq: rule.openSeq,
          priority,
        })
      }
    }
    if (spans.length === 0) return text

    spans.sort((a, b) => a.start - b.start || a.priority - b.priority || b.end - a.end)
    const closeSeq = buildRestoreSeq()
    let out = ''
    let cursor = 0
    for (const span of spans) {
      if (span.start < cursor) continue
      if (span.start > cursor) out += text.slice(cursor, span.start)
      out += span.openSeq + text.slice(span.start, span.end) + closeSeq
      cursor = span.end
    }
    if (cursor < text.length) out += text.slice(cursor)
    return out
  }

  function transform(data: string, skip = false): string {
    if (!data) return data
    if (!enabled || compiled.length === 0 || skip || data.length > MAX_HIGHLIGHT_CHUNK_CHARS) {
      // Keep tracking SGR state across skipped chunks when small so color state stays accurate.
      if (data.length <= MAX_HIGHLIGHT_CHUNK_CHARS && data.includes('\x1b')) {
        ANSI_TOKEN_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = ANSI_TOKEN_RE.exec(data)) !== null) applySgrSequence(m[0])
      } else if (skip) {
        activeFgParam = null
        activeBgParam = null
        hasBold = false
      }
      return data
    }

    // Fast path: no escape sequences in this chunk
    if (!data.includes('\x1b')) {
      return highlightPlainText(data)
    }

    ANSI_TOKEN_RE.lastIndex = 0
    let out = ''
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = ANSI_TOKEN_RE.exec(data)) !== null) {
      if (match.index > lastIndex) {
        out += highlightPlainText(data.slice(lastIndex, match.index))
      }
      const seq = match[0]
      out += seq
      applySgrSequence(seq)
      lastIndex = match.index + seq.length
    }
    if (lastIndex < data.length) {
      const tail = data.slice(lastIndex)
      // If tail contains an incomplete escape sequence (split across packets), pass through untouched.
      out += tail.includes('\x1b') ? tail : highlightPlainText(tail)
    }
    return out
  }

  return {
    setEnabled(next: boolean) {
      enabled = next
    },
    setRules(rules: readonly TerminalHighlightRule[]) {
      compiled = compileRules(rules)
    },
    reset() {
      activeFgParam = null
      activeBgParam = null
      hasBold = false
    },
    transform,
  }
}

/** Convenience one-shot helper for previews and static samples. */
export function highlightTerminalText(
  text: string,
  rules: readonly TerminalHighlightRule[],
  enabled = true,
): string {
  return createTerminalHighlighter(enabled, rules).transform(text)
}
