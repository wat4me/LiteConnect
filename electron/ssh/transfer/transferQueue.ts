export type QueuedTransfer = {
  sessionId: string
  transferId: string
  /** Must not reject; callers report success / failure through IPC themselves. */
  run: () => Promise<void>
  /** Called when the entry is dropped before it ran (cancel / session teardown). */
  onDropped: () => void
}

/**
 * Per-session admission control for renderer-started transfers.
 * Entries are announced (transferStart already emitted) as soon as they are queued,
 * but only `limit()` of them are in flight per session.
 */
export class TransferQueue {
  private waiting = new Map<string, QueuedTransfer[]>()
  private running = new Map<string, number>()

  constructor(private limit: () => number) {}

  enqueue(entry: QueuedTransfer): void {
    const list = this.waiting.get(entry.sessionId) ?? []
    list.push(entry)
    this.waiting.set(entry.sessionId, list)
    this.pump(entry.sessionId)
  }

  /** Drop a transfer that has not started yet. False when it is already running or unknown. */
  cancel(transferId: string): boolean {
    for (const [sessionId, list] of this.waiting) {
      const index = list.findIndex((entry) => entry.transferId === transferId)
      if (index < 0) continue
      const [entry] = list.splice(index, 1)
      if (list.length === 0) this.waiting.delete(sessionId)
      entry.onDropped()
      return true
    }
    return false
  }

  /** Drop everything still waiting for a session that is going away. */
  cancelSession(sessionId: string): void {
    const list = this.waiting.get(sessionId)
    if (!list) return
    this.waiting.delete(sessionId)
    for (const entry of list) entry.onDropped()
  }

  waitingCount(sessionId: string): number {
    return this.waiting.get(sessionId)?.length ?? 0
  }

  runningCount(sessionId: string): number {
    return this.running.get(sessionId) ?? 0
  }

  private pump(sessionId: string): void {
    const list = this.waiting.get(sessionId)
    if (!list) return
    const max = Math.max(1, this.limit())
    while (list.length > 0 && this.runningCount(sessionId) < max) {
      const entry = list.shift()!
      this.running.set(sessionId, this.runningCount(sessionId) + 1)
      void Promise.resolve()
        .then(() => entry.run())
        .catch(() => {})
        .finally(() => {
          const next = this.runningCount(sessionId) - 1
          if (next <= 0) this.running.delete(sessionId)
          else this.running.set(sessionId, next)
          this.pump(sessionId)
        })
    }
    if (list.length === 0) this.waiting.delete(sessionId)
  }
}
