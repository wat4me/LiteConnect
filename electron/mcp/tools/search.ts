import {
  MCP_GLOB_MAX_RESULTS,
  MCP_GREP_MAX_LINE_CHARS,
  MCP_GREP_MAX_MATCHES,
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

export function buildGrepCommand(opts: {
  engine: 'rg' | 'grep'
  pattern: string
  path: string
  include?: string
}): string {
  const pattern = shellQuote(opts.pattern)
  const path = shellQuote(opts.path)
  if (opts.engine === 'rg') {
    const glob = opts.include ? ` -g ${shellQuote(opts.include)}` : ''
    return `rg -n -H --no-heading --color=never --max-count=${MCP_GREP_MAX_MATCHES} --max-filesize 1048576${glob} -- ${pattern} ${path}`
  }
  const include = opts.include ? ` --include=${shellQuote(opts.include)}` : ''
  return `grep -R -n -H -I${include} -- ${pattern} ${path}`
}

export function buildGlobCommand(opts: { engine: 'rg' | 'find'; path: string; pattern: string }): string {
  const path = shellQuote(opts.path)
  const pattern = shellQuote(opts.pattern)
  if (opts.engine === 'rg') {
    return `rg --files --color=never -g ${pattern} -- ${path}`
  }
  return `find ${path} -name ${pattern}`
}

/** Parse `path:line:text` from rg -H / grep -H. */
export function parseGrepLine(raw: string): GrepMatch | null {
  const m = raw.match(/^(.*):(\d+):(.*)$/)
  if (!m) return null
  const line = Number(m[2])
  if (!Number.isFinite(line) || line < 1) return null
  let text = m[3]
  if (text.length > MCP_GREP_MAX_LINE_CHARS) text = `${text.slice(0, MCP_GREP_MAX_LINE_CHARS - 1)}…`
  return { path: m[1], line, text }
}

export function parseGrepOutput(stdout: string): GrepMatch[] {
  const out: GrepMatch[] = []
  for (const row of stdout.split(/\r?\n/)) {
    if (!row.trim()) continue
    const match = parseGrepLine(row)
    if (!match) continue
    out.push(match)
    if (out.length >= MCP_GREP_MAX_MATCHES) break
  }
  return out
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
  try {
    pattern = sanitizeSearchPattern(input.pattern)
    include = sanitizeIncludeGlob(input.include)
    path = requireRemotePath(input.path ?? input.file)
  } catch (err) {
    const mapped = mapThrown(err)
    const message = err instanceof Error ? err.message : String(err)
    return host.error(mapped?.code || 'INVALID_ARGUMENTS', mapped?.message || message)
  }

  const tryRg = await runRemote(host, session, buildGrepCommand({ engine: 'rg', pattern, path, include }))
  let used = 'rg'
  let raw = tryRg
  if (commandMissing(tryRg.exitCode, tryRg.stderr)) {
    used = 'grep'
    raw = await runRemote(host, session, buildGrepCommand({ engine: 'grep', pattern, path, include }))
  }

  if (raw.exitCode && raw.exitCode !== 1) {
    const detail = (raw.stderr || raw.stdout || 'search failed').replace(/\s+/g, ' ').slice(0, 300)
    return host.error('TOOL_FAILED', `${used} failed: ${detail}`)
  }

  const matches = parseGrepOutput(raw.stdout)
  const truncated = matches.length >= MCP_GREP_MAX_MATCHES || raw.truncated
  host.touch(session.sessionId)
  return host.ok({
    path,
    pattern,
    include: include || undefined,
    engine: used,
    matches,
    count: matches.length,
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
