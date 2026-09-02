export const AI_TOOL_RUN_CONTENT_MAX = 20_000
export const AI_TOOL_RUN_ARGS_MAX = 4_000

export type ToolRunSummary =
  | { kind: 'ok' }
  | { kind: 'text'; text: string }
  | { kind: 'exit'; code: number; truncated?: boolean; host?: string }
  | { kind: 'sessions'; count: number }
  | { kind: 'connections'; count: number }
  | { kind: 'groups'; count: number }
  | { kind: 'jobs'; count: number }
  | { kind: 'entries'; count: number }
  | { kind: 'ptys'; count: number }

export type ToolRunDisplay = {
  summary: ToolRunSummary
  hint: string
  body: string
}

const HINT_KEYS = [
  'command',
  'path',
  'remotePath',
  'localPath',
  'unit',
  'action',
  'ptyId',
  'jobId',
  'group',
] as const

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function parseJsonValue(text: string): unknown | undefined {
  const raw = text.trim()
  if (!raw) return undefined
  if (raw[0] !== '{' && raw[0] !== '[') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function unescapeJsonFragment(escaped: string): string {
  return escaped.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, seq: string) => {
    if (seq[0] === 'u' && seq.length === 5) {
      const code = Number.parseInt(seq.slice(1), 16)
      return Number.isFinite(code) ? String.fromCharCode(code) : seq
    }
    const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }
    return map[seq] ?? seq
  })
}

/** Recover a JSON string field from truncated pretty/compact JSON. */
export function extractJsonStringField(source: string, field: string): string | undefined {
  const needle = `"${field}"`
  const idx = source.indexOf(needle)
  if (idx < 0) return undefined
  const colon = source.indexOf(':', idx + needle.length)
  if (colon < 0) return undefined
  let i = colon + 1
  while (i < source.length && /\s/.test(source[i])) i++
  if (source[i] !== '"') return undefined
  i++
  let out = ''
  for (; i < source.length; i++) {
    const c = source[i]
    if (c === '\\') {
      const next = source[i + 1]
      if (next === undefined) break
      if (next === 'u' && source.length >= i + 6) {
        out += unescapeJsonFragment(`\\${source.slice(i + 1, i + 6)}`)
        i += 5
        continue
      }
      out += unescapeJsonFragment(`\\${next}`)
      i++
      continue
    }
    if (c === '"') return out
    out += c
  }
  return out || undefined
}

function hintFromArgs(args: string, argsObj: Record<string, unknown> | null): string {
  if (argsObj) {
    const parts: string[] = []
    const command = str(argsObj.command).trim()
    if (command) parts.push(command)
    const unit = str(argsObj.unit).trim()
    const action = str(argsObj.action).trim()
    if (unit) parts.push(action ? `${action} ${unit}` : unit)
    for (const key of HINT_KEYS) {
      if (key === 'command' || key === 'unit' || key === 'action') continue
      const value = str(argsObj[key]).trim()
      if (value) parts.push(value)
    }
    if (parts.length) return parts.join(' · ')
    return ''
  }
  const trimmed = args.trim()
  if (!trimmed || trimmed === '{}' || trimmed === '[]') return ''
  return trimmed
}

function joinOutput(stdout: string, stderr: string): string {
  const out = stdout.replace(/\s+$/, '')
  const err = stderr.replace(/\s+$/, '')
  if (out && err) return `${out}\n\n[stderr]\n${err}`
  return out || (err ? `[stderr]\n${err}` : '')
}

function hostLabel(row: Record<string, unknown>): string {
  const name = str(row.connectionName || row.name).trim()
  const user = str(row.username).trim()
  const host = str(row.host).trim()
  const port = num(row.port)
  let where = user && host ? `${user}@${host}` : host
  if (where && port && port !== 22) where = `${where}:${port}`
  if (name && where && name !== host && name !== where) return `${name} · ${where}`
  return where || name || str(row.sessionId).slice(0, 8)
}

function formatRows(rows: unknown, pick: (row: Record<string, unknown>) => string): string {
  if (!Array.isArray(rows)) return ''
  return rows
    .map((item) => asRecord(item))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map(pick)
    .filter(Boolean)
    .join('\n')
}

function formatExecPayload(row: Record<string, unknown>, content: string): ToolRunDisplay {
  const stdout = str(row.stdout) || extractJsonStringField(content, 'stdout') || ''
  const stderr = str(row.stderr) || extractJsonStringField(content, 'stderr') || ''
  const code = num(row.exitCode)
  const host = str(row.connectionName).trim() || str(row.host).trim()
  return {
    summary:
      code == null
        ? { kind: 'ok' }
        : { kind: 'exit', code, truncated: row.truncated === true, host: host || undefined },
    hint: str(row.command).trim(),
    body: joinOutput(stdout, stderr),
  }
}

function formatFromObject(name: string, obj: Record<string, unknown>, content: string): ToolRunDisplay | null {
  if (typeof obj.stdout === 'string' || typeof obj.stderr === 'string' || typeof obj.exitCode === 'number') {
    return formatExecPayload(obj, content)
  }
  if (Array.isArray(obj.results)) {
    const bodies = obj.results
      .map((item) => asRecord(item))
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .map((row) => {
        const label = hostLabel(row)
        const inner = formatExecPayload(row, content)
        const head = label ? `# ${label}\n` : ''
        return `${head}${inner.body}`.trim()
      })
    return {
      summary: { kind: 'ok' },
      hint: '',
      body: bodies.join('\n\n'),
    }
  }
  if (Array.isArray(obj.sessions)) {
    return {
      summary: { kind: 'sessions', count: obj.sessions.length },
      hint: '',
      body: formatRows(obj.sessions, (row) => {
        const health = row.healthy === false ? 'down' : 'ok'
        return `${hostLabel(row)}  ${health}`
      }),
    }
  }
  if (Array.isArray(obj.connections)) {
    return {
      summary: { kind: 'connections', count: obj.connections.length },
      hint: '',
      body: formatRows(obj.connections, (row) => {
        const open = row.hasOpenSession === true ? 'open' : ''
        return `${hostLabel(row)}${open ? `  ${open}` : ''}`
      }),
    }
  }
  if (Array.isArray(obj.groups)) {
    return {
      summary: { kind: 'groups', count: obj.groups.length },
      hint: '',
      body: formatRows(obj.groups, (row) => str(row.name) || str(row.id)),
    }
  }
  if (Array.isArray(obj.jobs)) {
    return {
      summary: { kind: 'jobs', count: obj.jobs.length },
      hint: '',
      body: formatRows(obj.jobs, (row) => {
        const id = str(row.jobId) || str(row.id)
        const status = str(row.status)
        const command = str(row.command)
        return [id, status, command].filter(Boolean).join('  ')
      }),
    }
  }
  if (Array.isArray(obj.ptys)) {
    return {
      summary: { kind: 'ptys', count: obj.ptys.length },
      hint: '',
      body: formatRows(obj.ptys, (row) => {
        const id = str(row.ptyId)
        const session = str(row.sessionId).slice(0, 8)
        return [id, session].filter(Boolean).join('  ')
      }),
    }
  }
  if (Array.isArray(obj.entries)) {
    return {
      summary: { kind: 'entries', count: obj.entries.length },
      hint: str(obj.path),
      body: formatRows(obj.entries, (row) => {
        const entryName = str(row.name) || str(row.filename)
        const dir = row.longname ? str(row.longname) : row.type === 'd' || row.isDirectory === true ? `${entryName}/` : entryName
        return dir || entryName
      }),
    }
  }
  if (name === 'read_file' || name === 'tail_file' || typeof obj.content === 'string') {
    const text = str(obj.content) || str(obj.text)
    if (text) {
      return {
        summary: { kind: 'ok' },
        hint: str(obj.path) || str(obj.remotePath),
        body: text,
      }
    }
  }
  if (name === 'pty_read') {
    const screen = str(obj.screen) || str(obj.text) || str(obj.data) || str(obj.output)
    if (screen) {
      return {
        summary: { kind: 'ok' },
        hint: str(obj.ptyId),
        body: screen,
      }
    }
  }
  if (name === 'connect' || name === 'disconnect') {
    const host = hostLabel(obj)
    return {
      summary: { kind: 'text', text: obj.reused === true ? 'reused' : obj.closed === true ? 'closed' : 'ok' },
      hint: host,
      body: '',
    }
  }
  return null
}

function fallbackBody(content: string): string {
  const stdout = extractJsonStringField(content, 'stdout')
  const stderr = extractJsonStringField(content, 'stderr')
  if (stdout || stderr) return joinOutput(stdout || '', stderr || '')
  return content.trim()
}

export function formatToolRunDisplay(input: {
  name: string
  args?: string
  content?: string
  isError?: boolean
  structured?: unknown
}): ToolRunDisplay {
  const args = input.args || ''
  const content = input.content || ''
  const argsObj = asRecord(parseJsonValue(args))
  const hint = hintFromArgs(args, argsObj)

  if (input.isError) {
    const message = content.trim() || 'error'
    return {
      summary: { kind: 'text', text: message },
      hint,
      body: message,
    }
  }

  const structured = input.structured ?? parseJsonValue(content)
  const obj = asRecord(structured)
  if (obj) {
    const formatted = formatFromObject(input.name, obj, content)
    if (formatted) {
      return {
        summary: formatted.summary,
        hint: formatted.hint || hint,
        body: formatted.body,
      }
    }
    try {
      return {
        summary: { kind: 'ok' },
        hint,
        body: JSON.stringify(structured, null, 2),
      }
    } catch {
      /* fall through */
    }
  }

  if (Array.isArray(structured)) {
    return {
      summary: { kind: 'ok' },
      hint,
      body: JSON.stringify(structured, null, 2),
    }
  }

  const body = fallbackBody(content)
  return {
    summary: fallbackSummary(input.name, body),
    hint,
    body,
  }
}

function fallbackSummary(name: string, body: string): ToolRunSummary {
  const count = body.split(/\r?\n/).filter((line) => line.trim()).length
  switch (name) {
    case 'list_sessions':
      return { kind: 'sessions', count }
    case 'list_connections':
      return { kind: 'connections', count }
    case 'list_groups':
      return { kind: 'groups', count }
    case 'list_jobs':
      return { kind: 'jobs', count }
    case 'list_dir':
      return { kind: 'entries', count }
    case 'pty_list':
      return { kind: 'ptys', count }
    default:
      return { kind: 'ok' }
  }
}

export function serializeToolRunForHistory(input: {
  name: string
  args: string
  content: string
  isError: boolean
  structured?: unknown
}): { args: string; content: string } {
  const view = formatToolRunDisplay(input)
  const args = view.hint.slice(0, AI_TOOL_RUN_ARGS_MAX)
  if (input.isError) {
    return { args, content: (view.body || input.content).slice(0, AI_TOOL_RUN_CONTENT_MAX) }
  }

  const structured = input.structured ?? parseJsonValue(input.content)
  const obj = asRecord(structured)
  if (obj && (typeof obj.stdout === 'string' || typeof obj.stderr === 'string' || typeof obj.exitCode === 'number')) {
    const stderrMarker = '\n\n[stderr]\n'
    const split = view.body.indexOf(stderrMarker)
    const stdout = (split >= 0 ? view.body.slice(0, split) : view.body).slice(0, AI_TOOL_RUN_CONTENT_MAX - 240)
    const stderr = (split >= 0 ? view.body.slice(split + stderrMarker.length) : str(obj.stderr)).slice(0, 2_000)
    const payload: Record<string, unknown> = {
      exitCode: num(obj.exitCode),
      stdout,
    }
    if (stderr) payload.stderr = stderr
    const host = str(obj.connectionName).trim()
    if (host) payload.connectionName = host
    if (obj.truncated === true) payload.truncated = true
    return { args, content: JSON.stringify(payload).slice(0, AI_TOOL_RUN_CONTENT_MAX) }
  }

  return {
    args,
    content: (view.body || input.content).slice(0, AI_TOOL_RUN_CONTENT_MAX),
  }
}

/**
 * Tool cards render as compact one-liners and stay collapsed by default —
 * the user expands a run only when they want its output. Approval UX lives
 * in the composer bar, so 'ask' no longer forces the card open.
 */
export function toolRunDefaultOpen(): boolean {
  return false
}
