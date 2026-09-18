/**
 * UTF-8 line assembly, Docker timestamps, and safe ANSI stripping for log UI.
 */

import { StringDecoder } from 'string_decoder'
import type { DockerLogEntry, DockerLogStreamKind } from './types'

/** RFC3339Nano-like prefix from Docker timestamps=1. */
const TS_PREFIX_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s(.*)$/s

/**
 * Strip CSI / OSC and common control sequences for safe plain-text display.
 * Does not interpret as HTML; removes escape sequences only.
 */
export function stripAnsi(input: string): string {
  if (!input) return input
  // ESC[ ... letter  |  ESC] ... BEL/ST  |  other ESC + final byte
  return input
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    .replace(/\r/g, '')
}

export function parseDockerLogTimestampLine(line: string): {
  timestamp: string | null
  text: string
} {
  const m = TS_PREFIX_RE.exec(line)
  if (!m) {
    return { timestamp: null, text: line }
  }
  return { timestamp: m[1], text: m[2] }
}

/**
 * Per-stream UTF-8 decoder + incomplete line buffer.
 * One frame is not assumed to be one line.
 */
export class DockerLogLineAssembler {
  private readonly decoder = new StringDecoder('utf8')
  private pending = ''
  private sequence = 0

  constructor(private readonly stream: DockerLogStreamKind) {}

  /** Feed decoded payload bytes for this stream only. */
  push(payload: Buffer): DockerLogEntry[] {
    if (!payload.length) return []
    const chunk = this.decoder.write(payload)
    return this.consumeText(chunk, false)
  }

  /** Flush incomplete UTF-8 + trailing partial line (EOF). */
  flush(): DockerLogEntry[] {
    const tail = this.decoder.end()
    return this.consumeText(tail, true)
  }

  private consumeText(text: string, flushPartial: boolean): DockerLogEntry[] {
    if (!text && !flushPartial) return []
    this.pending += text
    const out: DockerLogEntry[] = []
    let start = 0
    for (let i = 0; i < this.pending.length; i++) {
      if (this.pending.charCodeAt(i) === 10 /* \n */) {
        let line = this.pending.slice(start, i)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        out.push(this.toEntry(line))
        start = i + 1
      }
    }
    this.pending = this.pending.slice(start)
    if (flushPartial && this.pending.length) {
      out.push(this.toEntry(this.pending))
      this.pending = ''
    }
    return out
  }

  private toEntry(rawLine: string): DockerLogEntry {
    const cleaned = stripAnsi(rawLine)
    const { timestamp, text } = parseDockerLogTimestampLine(cleaned)
    this.sequence += 1
    return {
      sequence: this.sequence,
      stream: this.stream,
      timestamp,
      text,
    }
  }

  /** Override next sequence base (service assigns global sequence). */
  setNextSequence(n: number): void {
    this.sequence = n - 1
  }

  getLastSequence(): number {
    return this.sequence
  }
}

/**
 * Dual-stream assembler: stdout/stderr keep separate decoders and line buffers.
 * Global monotonic sequence assigned by the caller via resequence, or use CombinedLogAssembler.
 */
export class DualStreamLogAssembler {
  private stdout = new DockerLogLineAssembler('stdout')
  private stderr = new DockerLogLineAssembler('stderr')
  private nextSeq = 1

  push(stream: DockerLogStreamKind, payload: Buffer): DockerLogEntry[] {
    const asm = stream === 'stdout' ? this.stdout : this.stderr
    const partial = asm.push(payload)
    return this.renumber(partial)
  }

  flush(): DockerLogEntry[] {
    const a = this.renumber(this.stdout.flush())
    const b = this.renumber(this.stderr.flush())
    return a.concat(b)
  }

  private renumber(entries: DockerLogEntry[]): DockerLogEntry[] {
    return entries.map((e) => {
      const sequence = this.nextSeq++
      return { ...e, sequence }
    })
  }
}
