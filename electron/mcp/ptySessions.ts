import { randomUUID } from 'crypto'
import { Terminal } from '@xterm/headless'
import {
  MCP_PTY_BUFFER_CHARS,
  MCP_PTY_DEFAULT_COLS,
  MCP_PTY_DEFAULT_ROWS,
  MCP_PTY_IDLE_MS,
  MCP_PTY_MAX_COLS,
  MCP_PTY_MAX_PER_SESSION,
  MCP_PTY_MAX_ROWS,
  MCP_PTY_READ_TIMEOUT_MS,
  MCP_PTY_WAIT_IDLE_MAX_MS,
  MCP_PTY_WRITE_MAX_CHARS,
} from '../../shared/mcp/limits'
import type { McpShellChannel } from '../ssh/manager'

export type PtyOpenOpts = {
  sessionId: string
  generation: number
  cols?: number
  rows?: number
}

export type PtyReadMode = 'streaming' | 'snapshot' | 'screen'

export type PtyReadResult = {
  ptyId: string
  mode: PtyReadMode
  output: string
  truncated: boolean
  closed: boolean
  cols: number
  rows: number
  cursor?: { x: number; y: number }
}

type PtyRecord = {
  ptyId: string
  sessionId: string
  generation: number
  cols: number
  rows: number
  openedAt: number
  lastDataAt: number
  lastWriteAt: number
  closed: boolean
  buffer: string
  unreadAt: number
  truncated: boolean
  channel: McpShellChannel
  term: Terminal
}

export type PtyOpener = (
  sessionId: string,
  generation: number,
  opts: { term: string; cols: number; rows: number },
) => Promise<McpShellChannel>

export class PtySessionStore {
  private readonly ptys = new Map<string, PtyRecord>()
  private idleTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly openChannel: PtyOpener) {}

  async open(opts: PtyOpenOpts): Promise<{ ptyId: string; cols: number; rows: number }> {
    const cols = clampDim(opts.cols, MCP_PTY_DEFAULT_COLS, MCP_PTY_MAX_COLS)
    const rows = clampDim(opts.rows, MCP_PTY_DEFAULT_ROWS, MCP_PTY_MAX_ROWS)
    let owned = 0
    for (const p of this.ptys.values()) {
      if (!p.closed && p.sessionId === opts.sessionId) owned += 1
    }
    if (owned >= MCP_PTY_MAX_PER_SESSION) {
      throw Object.assign(new Error(`At most ${MCP_PTY_MAX_PER_SESSION} agent PTYs per SSH session`), {
        code: 'PTY_LIMIT',
      })
    }
    const channel = await this.openChannel(opts.sessionId, opts.generation, {
      term: 'xterm-256color',
      cols,
      rows,
    })
    const term = new Terminal({
      cols,
      rows,
      allowProposedApi: true,
      scrollback: Math.max(rows, 80),
    })
    const rec: PtyRecord = {
      ptyId: randomUUID(),
      sessionId: opts.sessionId,
      generation: opts.generation,
      cols,
      rows,
      openedAt: Date.now(),
      lastDataAt: Date.now(),
      lastWriteAt: Date.now(),
      closed: false,
      buffer: '',
      unreadAt: 0,
      truncated: false,
      channel,
      term,
    }
    const onData = (chunk: Buffer | string) => {
      if (rec.closed) return
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      rec.lastDataAt = Date.now()
      rec.buffer += text
      if (rec.buffer.length > MCP_PTY_BUFFER_CHARS) {
        const drop = rec.buffer.length - MCP_PTY_BUFFER_CHARS
        rec.buffer = rec.buffer.slice(drop)
        rec.unreadAt = Math.max(0, rec.unreadAt - drop)
        rec.truncated = true
      }
      try {
        rec.term.write(text)
      } catch {}
    }
    const onClose = () => this.finalize(rec)
    channel.on('data', onData)
    channel.on('close', onClose)
    channel.on('error', onClose)
    this.ptys.set(rec.ptyId, rec)
    this.ensureIdleTimer()
    return { ptyId: rec.ptyId, cols, rows }
  }

  write(ptyId: string, data: string, raw: boolean): void {
    const rec = this.requireOpen(ptyId)
    if (data.length > MCP_PTY_WRITE_MAX_CHARS) {
      throw Object.assign(new Error(`PTY write exceeds ${MCP_PTY_WRITE_MAX_CHARS} characters`), {
        code: 'INVALID_ARGUMENTS',
      })
    }
    let payload = data
    if (!raw && !payload.endsWith('\r') && !payload.endsWith('\n')) payload += '\r'
    rec.lastWriteAt = Date.now()
    rec.channel.write(payload)
  }

  async read(
    ptyId: string,
    opts: { mode?: PtyReadMode; waitForIdleMs?: number; maxBytes?: number },
  ): Promise<PtyReadResult> {
    const rec = this.require(ptyId)
    const mode: PtyReadMode =
      opts.mode === 'snapshot' || opts.mode === 'screen' ? opts.mode : 'streaming'
    const idle = clamp(opts.waitForIdleMs ?? 0, 0, MCP_PTY_WAIT_IDLE_MAX_MS)
    if (idle > 0 && !rec.closed) {
      const deadline = Date.now() + MCP_PTY_READ_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (Date.now() - rec.lastDataAt >= idle) break
        await sleep(40)
      }
    }
    const maxBytes = clamp(opts.maxBytes ?? 65_536, 1, MCP_PTY_BUFFER_CHARS)
    if (mode === 'streaming') {
      const raw = rec.buffer.slice(rec.unreadAt)
      rec.unreadAt = rec.buffer.length
      const output = raw.length > maxBytes ? raw.slice(-maxBytes) : raw
      return {
        ptyId,
        mode,
        output,
        truncated: rec.truncated || raw.length > maxBytes,
        closed: rec.closed,
        cols: rec.cols,
        rows: rec.rows,
      }
    }
    if (mode === 'snapshot') {
      const raw = rec.buffer.slice(-maxBytes)
      return {
        ptyId,
        mode,
        output: raw,
        truncated: rec.truncated || rec.buffer.length > maxBytes,
        closed: rec.closed,
        cols: rec.cols,
        rows: rec.rows,
      }
    }
    const screen = renderScreen(rec.term)
    return {
      ptyId,
      mode: 'screen',
      output: screen.text,
      truncated: rec.truncated,
      closed: rec.closed,
      cols: rec.cols,
      rows: rec.rows,
      cursor: screen.cursor,
    }
  }

  resize(ptyId: string, cols: number, rows: number): { cols: number; rows: number } {
    const rec = this.requireOpen(ptyId)
    const nextCols = clampDim(cols, MCP_PTY_DEFAULT_COLS, MCP_PTY_MAX_COLS)
    const nextRows = clampDim(rows, MCP_PTY_DEFAULT_ROWS, MCP_PTY_MAX_ROWS)
    rec.cols = nextCols
    rec.rows = nextRows
    try {
      rec.channel.setWindow?.(nextRows, nextCols, 0, 0)
    } catch {}
    try {
      rec.term.resize(nextCols, nextRows)
    } catch {}
    return { cols: nextCols, rows: nextRows }
  }

  close(ptyId: string): boolean {
    const rec = this.ptys.get(ptyId)
    if (!rec) return false
    this.finalize(rec)
    this.ptys.delete(ptyId)
    return true
  }

  closeForSession(sessionId: string) {
    for (const rec of [...this.ptys.values()]) {
      if (rec.sessionId === sessionId) this.close(rec.ptyId)
    }
  }

  list(): Array<{
    ptyId: string
    sessionId: string
    cols: number
    rows: number
    idleMs: number
    closed: boolean
  }> {
    const now = Date.now()
    return [...this.ptys.values()].map((p) => ({
      ptyId: p.ptyId,
      sessionId: p.sessionId,
      cols: p.cols,
      rows: p.rows,
      idleMs: now - Math.max(p.lastDataAt, p.lastWriteAt),
      closed: p.closed,
    }))
  }

  dispose() {
    for (const id of [...this.ptys.keys()]) this.close(id)
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
  }

  private require(ptyId: string): PtyRecord {
    const rec = this.ptys.get(ptyId)
    if (!rec) {
      throw Object.assign(new Error('No agent PTY with that id'), { code: 'PTY_NOT_FOUND' })
    }
    return rec
  }

  private requireOpen(ptyId: string): PtyRecord {
    const rec = this.require(ptyId)
    if (rec.closed) {
      throw Object.assign(new Error('Agent PTY is closed'), { code: 'PTY_CLOSED' })
    }
    return rec
  }

  private finalize(rec: PtyRecord) {
    if (rec.closed) return
    rec.closed = true
    try {
      rec.channel.removeAllListeners?.()
    } catch {}
    try {
      rec.channel.destroy?.()
    } catch {}
    try {
      rec.channel.close?.()
    } catch {}
    try {
      rec.term.dispose()
    } catch {}
  }

  private ensureIdleTimer() {
    if (this.idleTimer) return
    this.idleTimer = setInterval(() => {
      const now = Date.now()
      for (const rec of [...this.ptys.values()]) {
        const last = Math.max(rec.lastDataAt, rec.lastWriteAt)
        if (now - last >= MCP_PTY_IDLE_MS) this.close(rec.ptyId)
      }
      if (this.ptys.size === 0 && this.idleTimer) {
        clearInterval(this.idleTimer)
        this.idleTimer = null
      }
    }, 30_000)
    if (typeof this.idleTimer === 'object' && this.idleTimer && 'unref' in this.idleTimer) {
      this.idleTimer.unref()
    }
  }
}

function renderScreen(term: Terminal): { text: string; cursor: { x: number; y: number } } {
  const buf = term.buffer.active
  const lines: string[] = []
  const top = buf.viewportY
  for (let y = 0; y < term.rows; y++) {
    const line = buf.getLine(top + y)
    lines.push(line ? line.translateToString(true) : '')
  }
  while (lines.length > 1 && lines[lines.length - 1].trim() === '') lines.pop()
  return {
    text: lines.join('\n'),
    cursor: { x: buf.cursorX, y: buf.cursorY },
  }
}

function clampDim(raw: unknown, fallback: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(1, Math.floor(raw)))
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
