import {
  MCP_GLOB_MAX_RESULTS,
  MCP_GREP_MAX_CONTEXT_LINES,
  MCP_GREP_MAX_LINE_CHARS,
  MCP_GREP_MAX_MATCHES,
  MCP_GREP_MAX_OUTPUT_LINES,
  MCP_GREP_MAX_TAIL_BYTES,
  MCP_GREP_TAIL_MAX_FILES,
  MCP_SEARCH_PATTERN_MAX,
  MCP_SEARCH_TIMEOUT_MS,
} from '../../../shared/mcp/limits'
import type { SshMcpToolResult } from '../../../shared/mcp/types'
import { shellQuote } from '../../ssh/shellQuote'
import { requireRemotePath } from '../args'
import { mapThrown, toolError } from '../errors'
import type { McpRuntimeHost } from '../runtimeHost'

const INCLUDE_RE = /^[\w.*?{}[\]!,@+=/-]+$/

export type GrepMatch = {
  path: string
  line: number
  text: string
  /** True for `grep -C` context rows, which are not pattern hits. */
  context?: boolean
}

export function sanitizeSearchPattern(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw toolError('INVALID_ARGUMENTS', 'pattern is required')
  }
  const pattern = raw.trim()
  if (pattern.includes('\0') || /[\r\n]/.test(pattern)) {
    throw toolError('INVALID_ARGUMENTS', 'pattern must be a single line')
  }
  if (pattern.length > MCP_SEARCH_PATTERN_MAX) {
    throw toolError('INVALID_ARGUMENTS', `pattern exceeds ${MCP_SEARCH_PATTERN_MAX} characters`)
  }
  return pattern
}

export function sanitizeIncludeGlob(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined
  if (typeof raw !== 'string' || !INCLUDE_RE.test(raw) || raw.length > 64) {
    throw toolError('INVALID_ARGUMENTS', 'include must be a simple glob such as *.conf or *.log')
  }
  return raw
}

export function sanitizeContextLines(raw: unknown): number {
  if (raw == null || raw === '' || raw === false) return 0
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    throw toolError('INVALID_ARGUMENTS', `contextLines must be 0-${MCP_GREP_MAX_CONTEXT_LINES}`)
  }
  return Math.min(Math.floor(n), MCP_GREP_MAX_CONTEXT_LINES)
}

export function sanitizeTailBytes(raw: unknown): number {
  if (raw == null || raw === '' || raw === false) return 0
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    throw toolError('INVALID_ARGUMENTS', `tailBytes must be 0 or 1-${MCP_GREP_MAX_TAIL_BYTES}`)
  }
  return n < 1 ? 0 : Math.min(Math.floor(n), MCP_GREP_MAX_TAIL_BYTES)
}

/** ` -C n` for rg/grep; both use the same flag for symmetric context. */
function contextFlag(contextLines?: number): string {
  if (!contextLines || contextLines < 1) return ''
  return ` -C ${Math.min(Math.floor(contextLines), MCP_GREP_MAX_CONTEXT_LINES)}`
}

/** `*.log` out of `**​/*.log` — find -name only matches the basename. */
export function includeBasename(glob: string): string {
  const slash = glob.lastIndexOf('/')
  return slash >= 0 ? glob.slice(slash + 1) : glob
}

export function buildFindFilesCommand(opts: { path: string; include?: string }): string {
  const name = opts.include ? ` -name ${shellQuote(includeBasename(opts.include))}` : ''
  return `find ${shellQuote(opts.path)} -type f${name} | head -n ${MCP_GREP_TAIL_MAX_FILES}`
}

/**
 * Search only the last `tailBytes` of each file, then shift grep's relative
 * line numbers back onto real ones: `off = totalLines - windowLines`, computed
 * per file. Always grep-based — rg has no byte-window option.
 *
 * `grep -c ''` rather than `wc -l` for the total: wc counts newline bytes, so a
 * file whose last line has no trailing newline (rotated/truncated logs often
 * do) would be undercounted by one and every reported line number would shift
 * down by one. `grep -c ''` counts the final partial line too.
 */
export function buildTailGrepCommand(opts: {
  files: string[]
  pattern: string
  tailBytes: number
  contextLines?: number
}): string {
  const pattern = shellQuote(opts.pattern)
  const files = opts.files.map((file) => shellQuote(file)).join(' ')
  const ctx = contextFlag(opts.contextLines)
  const bytes = Math.max(1, Math.floor(opts.tailBytes))
  // awk rewrites `12:text` -> `file:112:text` and `12-text` -> `file:112-text`.
  // Statements are separated with explicit `;` — joined only by spaces the
  // program is a syntax error, so never rely on the join to add separators.
  const awk = [
    // grep's group separator must stay bare `--` or the parser cannot drop it.
    '/^--$/ { print "--"; next }',
    '{ i = index($1, "-");',
    ' if (i > 0) { $1 = f ":" (substr($1, 1, i - 1) + o) "-" substr($1, i + 1) }',
    ' else if ($1 ~ /^[0-9]+$/) { $1 = f ":" ($1 + o) }',
    ' else { $1 = f ":" $1 } }',
    '1',
  ].join(' ')
  return (
    `for f in ${files}; do ` +
    `t=$(tail -c ${bytes} "$f" 2>/dev/null); ` +
    `[ -z "$t" ] && continue; ` +
    `n=$(printf '%s\\n' "$t" | wc -l); ` +
    `total=$(grep -c '' "$f"); ` +
    `off=$((total - n)); [ "$off" -lt 0 ] && off=0; ` +
    `printf '%s\\n' "$t" | grep -n${ctx} -- ${pattern} | ` +
    `awk -F: -v f="$f" -v o="$off" '${awk}' OFS=:; ` +
    `done`
  )
}

export function buildGrepCommand(opts: {
  engine: 'rg' | 'grep'
  pattern: string
  path: string
  include?: string
  contextLines?: number
}): string {
  const pattern = shellQuote(opts.pattern)
  const path = shellQuote(opts.path)
  const ctx = contextFlag(opts.contextLines)
  if (opts.engine === 'rg') {
    const glob = opts.include ? ` -g ${shellQuote(opts.include)}` : ''
    return `rg -n -H --no-heading --color=never${ctx} --max-count=${MCP_GREP_MAX_MATCHES} --max-filesize 1048576${glob} -- ${pattern} ${path}`
  }
  const include = opts.include ? ` --include=${shellQuote(opts.include)}` : ''
  return `grep -R -n -H -I${ctx}${include} -- ${pattern} ${path}`
}

export function buildGlobCommand(opts: { engine: 'rg' | 'find'; path: string; pattern: string }): string {
  const path = shellQuote(opts.path)
  const pattern = shellQuote(opts.pattern)
  if (opts.engine === 'rg') {
    return `rg --files --color=never -g ${pattern} -- ${path}`
  }
  return `find ${path} -name ${pattern}`
}

/**
 * Parse `path:line:text` (hit) and `path:line-text` (context) from rg -H / grep -H -C.
 * A bare `--` is the group separator both tools emit between context blocks.
 */
export function parseGrepLine(raw: string): GrepMatch | null {
  const m = raw.match(/^(.*):(\d+)([:\-])(.*)$/)
  if (!m) return null
  const line = Number(m[2])
  if (!Number.isFinite(line) || line < 1) return null
  let text = m[4]
  if (text.length > MCP_GREP_MAX_LINE_CHARS) text = `${text.slice(0, MCP_GREP_MAX_LINE_CHARS - 1)}…`
  return m[3] === '-' ? { path: m[1], line, text, context: true } : { path: m[1], line, text }
}

export function isGrepGroupSeparator(row: string): boolean {
  return row.trim() === '--'
}

export function parseGrepOutput(stdout: string): GrepMatch[] {
  const out: GrepMatch[] = []
  let hits = 0
  for (const row of stdout.split(/\r?\n/)) {
    if (!row.trim() || isGrepGroupSeparator(row)) continue
    const match = parseGrepLine(row)
    if (!match) continue
    if (!match.context) {
      // Stop once the hit budget is spent; trailing context of the last hit is kept.
      if (hits >= MCP_GREP_MAX_MATCHES) break
      hits += 1
    }
    out.push(match)
    if (out.length >= MCP_GREP_MAX_OUTPUT_LINES) break
  }
  return out
}

export function countGrepHits(matches: GrepMatch[]): number {
  let hits = 0
  for (const match of matches) if (!match.context) hits += 1
  return hits
}

function commandMissing(exitCode: number | null, stderr: string): boolean {
  if (exitCode === 127) return true
  return /not found|no such file/i.test(stderr)
}

async function runRemote(
  host: McpRuntimeHost,
  session: { sessionId: string; generation: number },
  command: string,
) {
  host.assertGeneration(session.sessionId, session.generation)
  return host.ssh.executeSessionExec(session.sessionId, command, session.generation, MCP_SEARCH_TIMEOUT_MS)
}

export async function grepTool(host: McpRuntimeHost, input: Record<string, unknown>): Promise<SshMcpToolResult> {
  const session = host.requireSession(input.sessionId)
  let pattern: string
  let include: string | undefined
  let path: string
  let contextLines: number
  let tailBytes: number
  try {
    pattern = sanitizeSearchPattern(input.pattern)
    include = sanitizeIncludeGlob(input.include)
    path = requireRemotePath(input.path ?? input.file)
    contextLines = sanitizeContextLines(input.contextLines)
    tailBytes = sanitizeTailBytes(input.tailBytes)
  } catch (err) {
    const mapped = mapThrown(err)
    const message = err instanceof Error ? err.message : String(err)
    return host.error(mapped?.code || 'INVALID_ARGUMENTS', mapped?.message || message)
  }

  let used = 'rg'
  let raw: { stdout: string; stderr: string; exitCode: number | null; truncated?: boolean }

  if (tailBytes > 0) {
    used = 'grep'
    const listing = await runRemote(host, session, buildFindFilesCommand({ path, include }))
    const files = listing.stdout
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter(Boolean)
      .slice(0, MCP_GREP_TAIL_MAX_FILES)
    if (files.length === 0) {
      host.touch(session.sessionId)
      return host.ok({
        path,
        pattern,
        include: include || undefined,
        engine: used,
        contextLines: contextLines || undefined,
        tailBytes,
        matches: [],
        count: 0,
        truncated: false,
      })
    }
    raw = await runRemote(
      host,
      session,
      buildTailGrepCommand({ files, pattern, tailBytes, contextLines }),
    )
  } else {
    const tryRg = await runRemote(
      host,
      session,
      buildGrepCommand({ engine: 'rg', pattern, path, include, contextLines }),
    )
    raw = tryRg
    if (commandMissing(tryRg.exitCode, tryRg.stderr)) {
      used = 'grep'
      raw = await runRemote(
        host,
        session,
        buildGrepCommand({ engine: 'grep', pattern, path, include, contextLines }),
      )
    }
  }

  if (raw.exitCode && raw.exitCode !== 1) {
    const detail = (raw.stderr || raw.stdout || 'search failed').replace(/\s+/g, ' ').slice(0, 300)
    return host.error('TOOL_FAILED', `${used} failed: ${detail}`)
  }

  const matches = parseGrepOutput(raw.stdout)
  const hits = countGrepHits(matches)
  const truncated =
    hits >= MCP_GREP_MAX_MATCHES ||
    matches.length >= MCP_GREP_MAX_OUTPUT_LINES ||
    raw.truncated === true
  host.touch(session.sessionId)
  return host.ok({
    path,
    pattern,
    include: include || undefined,
    engine: used,
    contextLines: contextLines || undefined,
    tailBytes: tailBytes || undefined,
    matches,
    count: hits,
    returnedLines: matches.length,
    truncated,
  })
}

export async function globTool(host: McpRuntimeHost, input: Record<string, unknown>): Promise<SshMcpToolResult> {
  const session = host.requireSession(input.sessionId)
  let pattern: string
  let path: string
  try {
    pattern = sanitizeIncludeGlob(input.pattern) || ''
    if (!pattern) {
      throw toolError('INVALID_ARGUMENTS', 'pattern is required (e.g. *.log)')
    }
    path = requireRemotePath(input.path)
  } catch (err) {
    const mapped = mapThrown(err)
    const message = err instanceof Error ? err.message : String(err)
    return host.error(mapped?.code || 'INVALID_ARGUMENTS', mapped?.message || message)
  }

  const tryRg = await runRemote(host, session, buildGlobCommand({ engine: 'rg', path, pattern }))
  let used = 'rg'
  let raw = tryRg
  if (commandMissing(tryRg.exitCode, tryRg.stderr)) {
    used = 'find'
    raw = await runRemote(host, session, buildGlobCommand({ engine: 'find', path, pattern }))
  }

  if (raw.exitCode && raw.exitCode !== 1) {
    const detail = (raw.stderr || raw.stdout || 'glob failed').replace(/\s+/g, ' ').slice(0, 300)
    return host.error('TOOL_FAILED', `${used} failed: ${detail}`)
  }

  const files = raw.stdout
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .slice(0, MCP_GLOB_MAX_RESULTS)
  host.touch(session.sessionId)
  return host.ok({
    path,
    pattern,
    engine: used,
    files,
    count: files.length,
    truncated: files.length >= MCP_GLOB_MAX_RESULTS || raw.truncated,
  })
}
