import type { DockerLogEntry } from '../env.d'

/** Renderer ring buffer hard limits (entries + total characters). */
export const DOCKER_LOG_UI_MAX_ENTRIES = 10_000
export const DOCKER_LOG_UI_MAX_CHARS = 2_000_000

export type DockerLogRingBuffer = {
  entries: DockerLogEntry[]
  totalChars: number
  droppedCount: number
}

export function createDockerLogRingBuffer(): DockerLogRingBuffer {
  return { entries: [], totalChars: 0, droppedCount: 0 }
}

function entryChars(e: DockerLogEntry): number {
  return e.text.length + (e.timestamp?.length || 0)
}

/**
 * Append entries to a bounded ring buffer; drop oldest when over either limit.
 * Does not keep a second unbounded history array.
 */
export function appendDockerLogEntries(
  buf: DockerLogRingBuffer,
  incoming: DockerLogEntry[],
  maxEntries: number = DOCKER_LOG_UI_MAX_ENTRIES,
  maxChars: number = DOCKER_LOG_UI_MAX_CHARS,
): DockerLogRingBuffer {
  if (!incoming.length) return buf
  const entries = buf.entries.slice()
  let totalChars = buf.totalChars
  let droppedCount = buf.droppedCount

  for (const e of incoming) {
    entries.push(e)
    totalChars += entryChars(e)
  }

  while (entries.length > maxEntries || totalChars > maxChars) {
    if (!entries.length) break
    const old = entries.shift()!
    totalChars -= entryChars(old)
    if (totalChars < 0) totalChars = 0
    droppedCount += 1
  }

  return { entries, totalChars, droppedCount }
}

export function clearDockerLogRingBuffer(buf: DockerLogRingBuffer): DockerLogRingBuffer {
  return { entries: [], totalChars: 0, droppedCount: 0 }
}
