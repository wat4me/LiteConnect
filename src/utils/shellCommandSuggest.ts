import { SHELL_COMMAND_CATALOG } from './shellCommandCatalog'
import { getFlagsForCommand } from './shellCommandFlags'

export type ShellSuggestSource = 'history' | 'builtin' | 'flag'

export type ShellSuggestItem = {
  id: string
  source: ShellSuggestSource
  /** Text written into the terminal line (full segment replacement) */
  command: string
  /** Primary label (history: full cmd; builtin: name; flag: flag only) */
  title: string
  /** Secondary: description / example */
  subtitle?: string
  descKey?: string
  example?: string
}

export type ShellHistoryEntry = {
  command: string
  at: number
}

/** Latest matching history entries */
export const HISTORY_SUGGEST_LIMIT = 5
/** Builtin / flag rows always reserved (floor), independent of history */
export const SYSTEM_SUGGEST_LIMIT = 3

/** First token of the current input line (no leading pipe/and chains). */
export function extractSuggestPrefix(input: string): string {
  const line = (input || '').replace(/^\s+/, '')
  if (!line) return ''
  // Suggest against the last segment after | ; && ||
  const parts = line.split(/(?:&&|\|\||[;|])/)
  const last = (parts[parts.length - 1] || '').replace(/^\s+/, '')
  return last
}

export type ParsedSuggestSegment = {
  /** Segment without leading whitespace */
  raw: string
  tokens: string[]
  /** True when user finished a token with trailing space (ready for next arg/flag) */
  endsWithSpace: boolean
}

/** Tokenize current pipeline segment for command vs flag mode. */
export function parseSuggestSegment(segment: string): ParsedSuggestSegment {
  const raw = (segment || '').replace(/^\s+/, '')
  if (!raw) return { raw: '', tokens: [], endsWithSpace: false }
  const endsWithSpace = /\s$/.test(raw)
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  return { raw, tokens, endsWithSpace }
}

/**
 * Flag/option mode: known command already typed, and either trailing space
 * or additional tokens (partial flag / more args).
 */
export function isFlagSuggestMode(segment: string): boolean {
  const { tokens, endsWithSpace } = parseSuggestSegment(segment)
  if (tokens.length === 0) return false
  const cmd = tokens[0].toLowerCase()
  if (getFlagsForCommand(cmd).length === 0) return false
  if (tokens.length === 1) return endsWithSpace
  return true
}

function scoreHistory(cmd: string, q: string): number {
  const c = cmd.toLowerCase()
  if (c === q) return 300
  if (c.startsWith(q)) return 200 + Math.max(0, 40 - (c.length - q.length))
  const token = c.split(/\s+/)[0] || ''
  if (token.startsWith(q)) return 150
  if (c.includes(q)) return 80
  return 0
}

function scoreBuiltin(name: string, q: string): number {
  const n = name.toLowerCase()
  if (n === q) return 100
  if (n.startsWith(q)) return 90 + Math.max(0, 20 - (n.length - q.length))
  if (n.includes(q)) return 40
  return 0
}

function scoreFlag(flag: string, q: string): number {
  if (!q) return 50
  const f = flag.toLowerCase()
  const qq = q.toLowerCase()
  if (f === qq) return 100
  if (f.startsWith(qq)) return 90 + Math.max(0, 20 - (f.length - qq.length))
  if (f.includes(qq)) return 40
  return 0
}

/**
 * Build full segment after accepting a flag.
 * - Subcommands (`ps`, `ps -a`, `status`): replace all args after command with flag
 * - Dash options (`-a`, `-lah`): append or replace incomplete last token (stackable)
 */
export function applyFlagToSegment(segment: string, flag: string): string {
  const { tokens, endsWithSpace } = parseSuggestSegment(segment)
  if (tokens.length === 0) return flag
  const leadingWs = (segment || '').match(/^\s*/)?.[0] || ''
  const cmd = tokens[0]
  const isDashOpt = flag.startsWith('-') && !flag.includes(' ')
  if (!isDashOpt) {
    return `${leadingWs}${cmd} ${flag}`
  }
  if (tokens.length === 1) {
    return `${leadingWs}${cmd} ${flag}`
  }
  if (endsWithSpace) {
    return `${leadingWs}${tokens.join(' ')} ${flag}`
  }
  const head = tokens.slice(0, -1).join(' ')
  return `${leadingWs}${head} ${flag}`
}

function buildHistoryItems(
  query: string,
  history: ShellHistoryEntry[],
  limit: number,
): ShellSuggestItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const histItems: Array<ShellSuggestItem & { score: number; at: number }> = []
  const seenHist = new Set<string>()

  for (const h of history) {
    const cmd = (h.command || '').trim()
    if (!cmd || seenHist.has(cmd)) continue
    const score = scoreHistory(cmd, q)
    if (score <= 0) continue
    seenHist.add(cmd)
    histItems.push({
      id: `h:${cmd}`,
      source: 'history',
      command: cmd,
      title: cmd,
      subtitle: undefined,
      score,
      at: h.at || 0,
    })
  }

  histItems.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.at - a.at
  })

  const out: ShellSuggestItem[] = []
  for (const h of histItems) {
    if (out.length >= limit) break
    const { score: _s, at: _a, ...item } = h
    out.push(item)
  }
  return out
}

/**
 * Whether catalog flag should appear for current args after the command.
 * - Only true extensions / incomplete prefixes of the typed args
 * - Exact complete match (e.g. already typed `docker ps`) → hide that flag
 * - Sibling subcommands (e.g. `exec -it` while on `ps`) never appear
 */
export function flagMatchesTypedArgs(
  flag: string,
  typedArgs: string,
  endsWithSpace: boolean,
): boolean {
  const fl = flag.toLowerCase()
  const typed = typedArgs.toLowerCase()
  if (!typed) {
    // `cmd ` → all flags
    return true
  }
  if (endsWithSpace) {
    // `docker ps ` → only longer paths like `ps -a`, not `exec -it`
    return fl.startsWith(`${typed} `)
  }
  // `docker ps` exact → hide; `docker p` / `docker ps -` → prefix match longer or equal-in-progress
  if (fl === typed) return false
  return fl.startsWith(typed)
}

function buildFlagItems(
  segment: string,
  limit: number,
  describe?: (descKey: string) => string,
): ShellSuggestItem[] {
  const { tokens, endsWithSpace } = parseSuggestSegment(segment)
  if (tokens.length === 0) return []
  const cmd = tokens[0].toLowerCase()
  const flags = getFlagsForCommand(cmd)
  if (flags.length === 0) return []

  const typedArgs = tokens.slice(1).join(' ')
  // Completed dash-tokens (exclude in-progress last token) — avoid re-suggesting -a after `ls -a -`
  const completedDash = new Set(
    (endsWithSpace ? tokens.slice(1) : tokens.slice(1, -1))
      .filter((t) => t.startsWith('-'))
      .map((t) => t.toLowerCase()),
  )

  const scored: Array<ShellSuggestItem & { score: number }> = []
  for (const f of flags) {
    if (!flagMatchesTypedArgs(f.flag, typedArgs, endsWithSpace)) continue
    // Stacked short options: if catalog entry is a single dash token already used, skip
    if (f.flag.startsWith('-') && !f.flag.includes(' ') && completedDash.has(f.flag.toLowerCase())) {
      continue
    }
    const partial = endsWithSpace ? '' : tokens.length >= 2 ? tokens[tokens.length - 1] : ''
    const score = scoreFlag(f.flag, partial || typedArgs)
    const full = applyFlagToSegment(segment, f.flag)
    const desc = describe?.(f.descKey)
    scored.push({
      id: `f:${cmd}:${f.flag}`,
      source: 'flag',
      command: full,
      title: f.flag,
      subtitle: desc,
      descKey: f.descKey,
      score,
    })
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.title.localeCompare(b.title)
  })

  return scored.slice(0, limit).map(({ score: _s, ...item }) => item)
}

function buildBuiltinItems(
  q: string,
  limit: number,
  describe?: (descKey: string) => string,
): ShellSuggestItem[] {
  const builtins: Array<ShellSuggestItem & { score: number }> = []
  for (const c of SHELL_COMMAND_CATALOG) {
    const score = scoreBuiltin(c.name, q)
    if (score <= 0) continue
    const desc = describe?.(c.descKey)
    builtins.push({
      id: `b:${c.name}`,
      source: 'builtin',
      command: c.name,
      title: c.name,
      subtitle: desc || c.example,
      descKey: c.descKey,
      example: c.example,
      score,
    })
  }
  builtins.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.title.localeCompare(b.title)
  })
  return builtins.slice(0, limit).map(({ score: _s, ...item }) => item)
}

/**
 * History (up to 5, latest relevant) first, then system builtin/flag (up to 3).
 * With both: max 8 rows. System slots are reserved, not squeezed out by history.
 */
export function buildShellSuggestions(opts: {
  query: string
  history: ShellHistoryEntry[]
  historyLimit?: number
  systemLimit?: number
  /** @deprecated use historyLimit + systemLimit */
  limit?: number
  /** Resolve builtin/flag description (i18n). Optional for pure ranking tests. */
  describe?: (descKey: string) => string
}): ShellSuggestItem[] {
  const raw = extractSuggestPrefix(opts.query)
  const q = raw.trim().toLowerCase()
  if (!q) return []

  const histLimit = opts.historyLimit ?? HISTORY_SUGGEST_LIMIT
  const sysLimit = opts.systemLimit ?? SYSTEM_SUGGEST_LIMIT

  if (isFlagSuggestMode(raw)) {
    const histItems = buildHistoryItems(raw, opts.history, histLimit)
    const out: ShellSuggestItem[] = [...histItems]
    for (const f of buildFlagItems(raw, sysLimit, opts.describe)) {
      if (out.filter((x) => x.source === 'flag').length >= sysLimit) break
      if (out.some((x) => x.command === f.command)) continue
      out.push(f)
    }
    return out
  }

  const histItems = buildHistoryItems(q, opts.history, histLimit)
  const builtins = buildBuiltinItems(q, sysLimit, opts.describe)
  return [...histItems, ...builtins]
}

/**
 * How to apply a suggestion onto the current buffer segment.
 * Returns the full line that should appear after accept (including pipe prefixes).
 */
export function applySuggestionToLine(fullLine: string, suggestionCommand: string): string {
  const line = fullLine ?? ''
  const re = /^(.*(?:&&|\|\||[;|])\s*)?(.*)$/s
  const m = line.match(re)
  if (!m) return suggestionCommand
  const prefix = m[1] || ''
  const segment = m[2] || ''
  const leadingWs = segment.match(/^\s*/)?.[0] || ''
  return `${prefix}${leadingWs}${suggestionCommand}`
}

/** Characters to type after clearing current segment (suffix complete). */
export function suggestCompletionSuffix(currentSegment: string, suggestionCommand: string): {
  clearCount: number
  write: string
} {
  const seg = currentSegment.replace(/^\s+/, '')
  if (suggestionCommand.startsWith(seg)) {
    return { clearCount: 0, write: suggestionCommand.slice(seg.length) }
  }
  return { clearCount: seg.length, write: suggestionCommand }
}
