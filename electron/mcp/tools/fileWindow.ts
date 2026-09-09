import {
  MCP_READ_CHUNK_BYTES,
  MCP_READ_DEFAULT_LINES,
  MCP_READ_MAX_BYTES,
  MCP_READ_MAX_LINE_CHARS,
  MCP_READ_MAX_LINES,
} from '../../../shared/mcp/limits'

export type FileLineWindow = {
  startLine: number
  limit: number
  maxBytes: number
  maxLineChars: number
}

export type FileLineWindowResult = {
  lines: string[]
  startLine: number
  nextLine: number
  bytes: number
  clippedLine: boolean
  hitByteCap: boolean
  hitLineCap: boolean
}

function clipLine(line: string, maxChars: number): { text: string; clipped: boolean } {
  if (line.length <= maxChars) return { text: line, clipped: false }
  return { text: `${line.slice(0, Math.max(0, maxChars - 1))}…`, clipped: true }
}

function normalizeNl(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/** Split a chunk into complete lines; keep the unfinished tail in `carry`. */
export function takeCompleteLines(carry: string, chunk: string, eof: boolean): { lines: string[]; carry: string } {
  const text = carry + chunk
  if (!eof) {
    const idx = text.lastIndexOf('\n')
    if (idx < 0) return { lines: [], carry: text }
    const complete = text.slice(0, idx)
    return {
      lines: complete.split('\n').map(normalizeNl),
      carry: text.slice(idx + 1),
    }
  }
  if (!text) return { lines: [], carry: '' }
  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text
  if (!trimmed) return { lines: [], carry: '' }
  return { lines: trimmed.split('\n').map(normalizeNl), carry: '' }
}

export function defaultLineWindow(over: Partial<FileLineWindow> = {}): FileLineWindow {
  return {
    startLine: 1,
    limit: MCP_READ_DEFAULT_LINES,
    maxBytes: MCP_READ_MAX_BYTES,
    maxLineChars: MCP_READ_MAX_LINE_CHARS,
    ...over,
  }
}

export function clampReadStartLine(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1
  return Math.min(10_000_000, Math.max(1, Math.floor(raw)))
}

export function clampReadLimit(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MCP_READ_DEFAULT_LINES
  return Math.min(MCP_READ_MAX_LINES, Math.max(1, Math.floor(raw)))
}

/**
 * Collect a line window from streamed chunks. Does not keep the rest of the file.
 * `startLine` is 1-based. Stops at `limit` lines or `maxBytes`, whichever first.
 */
export function createLineCollector(window: FileLineWindow) {
  const startLine = Math.max(1, window.startLine)
  const limit = Math.max(1, window.limit)
  let currentLine = 1
  const lines: string[] = []
  let bytes = 0
  let clippedLine = false
  let hitByteCap = false
  let carry = ''
  let stopped = false

  const consider = (raw: string) => {
    if (stopped) return
    if (currentLine < startLine) {
      currentLine += 1
      return
    }
    if (lines.length >= limit) {
      stopped = true
      return
    }
    const clipped = clipLine(raw, window.maxLineChars)
    if (clipped.clipped) clippedLine = true
    const extra = clipped.text.length + (lines.length > 0 ? 1 : 0)
    if (bytes + extra > window.maxBytes) {
      hitByteCap = true
      stopped = true
      if (lines.length === 0 && window.maxBytes > 0) {
        const room = Math.max(1, window.maxBytes)
        const text = clipped.text.length > room ? `${clipped.text.slice(0, room - 1)}…` : clipped.text
        lines.push(text)
        bytes = text.length
        clippedLine = true
      }
      return
    }
    lines.push(clipped.text)
    bytes += extra
    currentLine += 1
    if (lines.length >= limit) stopped = true
  }

  const push = (chunk: string, eof: boolean) => {
    if (stopped && !eof) return
    const next = takeCompleteLines(carry, chunk, eof)
    carry = next.carry
    for (const line of next.lines) {
      consider(line)
      if (stopped) break
    }
    if (!eof && !stopped && carry.length >= window.maxBytes) {
      consider(carry)
      carry = ''
      hitByteCap = true
      stopped = true
    }
  }

  const result = (): FileLineWindowResult => ({
    lines,
    startLine,
    nextLine: startLine + lines.length,
    bytes,
    clippedLine,
    hitByteCap,
    hitLineCap: lines.length >= limit,
  })

  return {
    push,
    result,
    get stopped() {
      return stopped
    },
  }
}

export const READ_CHUNK_BYTES = MCP_READ_CHUNK_BYTES
