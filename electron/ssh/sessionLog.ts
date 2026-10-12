import { app } from 'electron'
import { createWriteStream, type WriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { dirname, join } from 'path'

/** Sanitize a host/port pair into a safe relative log path (<day>/<file>). */
export function sessionLogRelativePath(
  sessionId: string,
  host: string,
  port: number,
  now = new Date(),
): string {
  const safeHost =
    String(host)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 64) || 'unknown'
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return join(day, `${sessionId}-${safeHost}-${port}.log`)
}

interface SessionLogState {
  stream: WriteStream | null
  queue: string[]
  failed: boolean
  ended: boolean
  queuedBytes: number
  blocked: boolean
}

const MAX_BUFFERED_CHUNKS = 2000
const MAX_BUFFERED_BYTES = 1024 * 1024

/**
 * Appends remote shell output to per-session log files under
 * userData/session-logs/<day>/. Only remote output is recorded — user input
 * is never written (it may contain passwords).
 */
export class SessionLogManager {
  private sessions = new Map<string, SessionLogState>()
  private dir: string

  constructor(dir?: string) {
    this.dir = dir || join(app.getPath('userData'), 'session-logs')
  }

  getLogDir(): string {
    return this.dir
  }

  /** Lazily opens the stream for this session and appends one output chunk. */
  append(sessionId: string, meta: { host: string; port: number }, data: string): void {
    if (!data) return
    let st = this.sessions.get(sessionId)
    if (!st) {
      st = { stream: null, queue: [], failed: false, ended: false, queuedBytes: 0, blocked: false }
      this.sessions.set(sessionId, st)
      void this.openStream(sessionId, meta, st)
    }
    if (st.failed || st.ended) return
    const bytes = Buffer.byteLength(data)
    if (st.queue.length >= MAX_BUFFERED_CHUNKS || st.queuedBytes + bytes > MAX_BUFFERED_BYTES) {
      this.fail(st)
      return
    }
    st.queue.push(data)
    st.queuedBytes += bytes
    this.flush(st)
  }

  private fail(st: SessionLogState): void {
    st.failed = true
    st.queue = []
    st.queuedBytes = 0
    st.stream?.destroy()
  }

  private flush(st: SessionLogState): void {
    if (!st.stream || st.blocked || st.failed) return
    try {
      while (st.queue.length) {
        const chunk = st.queue.shift()!
        st.queuedBytes -= Buffer.byteLength(chunk)
        if (!st.stream.write(chunk)) {
          st.blocked = true
          return
        }
      }
      if (st.ended) st.stream.end()
    } catch {
      this.fail(st)
    }
  }

  private async openStream(
    sessionId: string,
    meta: { host: string; port: number },
    st: SessionLogState,
  ): Promise<void> {
    try {
      const rel = sessionLogRelativePath(sessionId, meta.host, meta.port)
      const abs = join(this.dir, rel)
      await mkdir(dirname(abs), { recursive: true })
      // A quick disconnect must not create an orphan stream after teardown.
      if (st.ended || st.failed) { st.queue = []; st.queuedBytes = 0; return }
      const stream = createWriteStream(abs, { flags: 'a', encoding: 'utf8' })
      stream.on('error', () => this.fail(st))
      stream.on('drain', () => { st.blocked = false; this.flush(st) })
      st.stream = stream
      this.flush(st)
    } catch {
      // Logging must never break SSH sessions; give up for this session.
      this.fail(st)
    }
  }

  endSession(sessionId: string): void {
    const st = this.sessions.get(sessionId)
    if (!st) return
    st.ended = true
    this.flush(st)
    this.sessions.delete(sessionId)
  }

  endAll(): void {
    for (const id of this.sessions.keys()) this.endSession(id)
    this.sessions.clear()
  }
}
