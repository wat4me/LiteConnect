export type TerminalHighlightColor = 'red' | 'yellow' | 'green' | 'cyan' | 'blue' | 'magenta'

export const TERMINAL_HIGHLIGHT_COLORS: readonly TerminalHighlightColor[] = [
  'red',
  'yellow',
  'green',
  'cyan',
  'blue',
  'magenta',
] as const

export interface TerminalHighlightRule {
  id: string
  name: string
  pattern: string
  isRegex: boolean
  caseSensitive: boolean
  color: TerminalHighlightColor
  bold?: boolean
  background?: boolean
  /** When true, highlights even inside text that already carries an ANSI color. */
  overrideColor?: boolean
  enabled: boolean
  builtin?: boolean
}

export const MAX_TERMINAL_HIGHLIGHT_RULES = 50
export const MAX_TERMINAL_HIGHLIGHT_PATTERN_LEN = 200
export const MAX_TERMINAL_HIGHLIGHT_NAME_LEN = 48

export const DEFAULT_TERMINAL_HIGHLIGHT_RULES: readonly TerminalHighlightRule[] = [
  {
    id: 'builtin-error',
    name: 'ERROR / FATAL',
    pattern: '\\b(?:ERROR|FATAL|CRITICAL|PANIC|EXCEPTION|FAILED|FAIL)\\b',
    isRegex: true,
    caseSensitive: false,
    color: 'red',
    bold: true,
    background: false,
    enabled: true,
    builtin: true,
  },
  {
    id: 'builtin-warn',
    name: 'WARN',
    pattern: '\\b(?:WARN|WARNING|DEPRECATED)\\b',
    isRegex: true,
    caseSensitive: false,
    color: 'yellow',
    bold: true,
    background: false,
    enabled: true,
    builtin: true,
  },
  {
    id: 'builtin-success',
    name: 'SUCCESS / OK',
    pattern: '\\b(?:SUCCESS|SUCCEEDED|PASSED|OK|ACTIVE|RUNNING|HEALTHY)\\b',
    isRegex: true,
    caseSensitive: false,
    color: 'green',
    bold: false,
    background: false,
    enabled: true,
    builtin: true,
  },
  {
    id: 'builtin-ip',
    name: 'IPv4',
    pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}(?::\\d{1,5})?\\b',
    isRegex: true,
    caseSensitive: false,
    color: 'cyan',
    bold: false,
    background: false,
    enabled: true,
    builtin: true,
  },
  {
    id: 'builtin-http-error',
    name: 'HTTP 4xx / 5xx',
    pattern: '\\b(?:40[0-9]|429|50[0-9])\\b',
    isRegex: true,
    caseSensitive: false,
    color: 'magenta',
    bold: true,
    background: false,
    enabled: false,
    builtin: true,
  },
]

export function cloneDefaultTerminalHighlightRules(): TerminalHighlightRule[] {
  return DEFAULT_TERMINAL_HIGHLIGHT_RULES.map(rule => ({ ...rule }))
}

export function isTerminalHighlightColor(value: unknown): value is TerminalHighlightColor {
  return typeof value === 'string' && (TERMINAL_HIGHLIGHT_COLORS as readonly string[]).includes(value)
}

export function validateTerminalHighlightPattern(pattern: string, isRegex: boolean): string | null {
  const trimmed = pattern.trim()
  if (!trimmed) return 'empty'
  if (trimmed.length > MAX_TERMINAL_HIGHLIGHT_PATTERN_LEN) return 'tooLong'
  if (isRegex) {
    try {
      new RegExp(trimmed, 'g')
    } catch (err: any) {
      return err?.message || 'invalidRegex'
    }
  }
  return null
}

export function sanitizeTerminalHighlightRules(raw: unknown): TerminalHighlightRule[] {
  if (!Array.isArray(raw)) return cloneDefaultTerminalHighlightRules()
  const seen = new Set<string>()
  const result: TerminalHighlightRule[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    if (result.length >= MAX_TERMINAL_HIGHLIGHT_RULES) break
    const rec = item as Record<string, unknown>
    const rawId = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim().slice(0, 64) : `rule-${result.length + 1}`
    const id = seen.has(rawId) ? `${rawId}-${result.length + 1}` : rawId
    seen.add(id)
    const pattern = typeof rec.pattern === 'string' ? rec.pattern.trim().slice(0, MAX_TERMINAL_HIGHLIGHT_PATTERN_LEN) : ''
    if (!pattern) continue
    const isRegex = !!rec.isRegex
    if (isRegex && validateTerminalHighlightPattern(pattern, true) !== null) continue
    const name = typeof rec.name === 'string' && rec.name.trim()
      ? rec.name.trim().slice(0, MAX_TERMINAL_HIGHLIGHT_NAME_LEN)
      : pattern.slice(0, MAX_TERMINAL_HIGHLIGHT_NAME_LEN)
    result.push({
      id,
      name,
      pattern,
      isRegex,
      caseSensitive: !!rec.caseSensitive,
      color: isTerminalHighlightColor(rec.color) ? rec.color : 'yellow',
      bold: !!rec.bold,
      background: !!rec.background,
      ...(rec.overrideColor ? { overrideColor: true } : {}),
      enabled: rec.enabled !== false,
      ...(rec.builtin ? { builtin: true } : {}),
    })
  }
  return result
}
