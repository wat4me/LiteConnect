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
}

const MAX_BUFFERED_CHUNKS = 2000

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
      st = { stream: null, queue: [], failed: false }
      this.sessions.set(sessionId, st)
      void this.openStream(sessionId, meta, st)
    }
    if (st.failed) return
    if (st.stream) {
      st.stream.write(data)
      return
    }
    if (st.queue.length < MAX_BUFFERED_CHUNKS) st.queue.push(data)
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
      const stream = createWriteStream(abs, { flags: 'a', encoding: 'utf8' })
      st.stream = stream
      for (const chunk of st.queue) stream.write(chunk)
      st.queue = []
    } catch {
      // Logging must never break SSH sessions; give up for this session.
      st.queue = []
      st.failed = true
    }
  }

  endSession(sessionId: string): void {
    const st = this.sessions.get(sessionId)
    if (!st) return
    st.stream?.end()
    this.sessions.delete(sessionId)
  }

  endAll(): void {
    for (const [, st] of this.sessions) st.stream?.end()
    this.sessions.clear()
  }
}
