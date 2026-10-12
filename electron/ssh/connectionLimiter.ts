import { SSH_CONNECTION_CANCELLED } from '../../shared/sshConnectionProgress'

/** Limit concurrent handshakes per endpoint without sharing terminal sessions. */
export class ConnectionLimiter {
  private active = new Map<string, number>()
  private waiting = new Map<string, Set<() => void>>()
  constructor(private limit = 2) {}

  async run<T>(key: string, signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    while ((this.active.get(key) || 0) >= this.limit) {
      await new Promise<void>((resolve, reject) => {
        const queue = this.waiting.get(key) || new Set<() => void>()
        const finish = (cancelled = false) => {
          queue.delete(wake)
          if (!queue.size) this.waiting.delete(key)
          signal?.removeEventListener('abort', abort)
          if (cancelled) reject(new Error(SSH_CONNECTION_CANCELLED))
          else resolve()
        }
        const wake = () => finish()
        const abort = () => finish(true)
        queue.add(wake)
        this.waiting.set(key, queue)
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
      })
    }
    if (signal?.aborted) throw new Error(SSH_CONNECTION_CANCELLED)
    this.active.set(key, (this.active.get(key) || 0) + 1)
    try { return await task() }
    finally {
      const count = (this.active.get(key) || 1) - 1
      if (count) this.active.set(key, count)
      else this.active.delete(key)
      // Wake queued callers, which recheck the limit before taking a slot.
      for (const wake of [...this.waiting.get(key) || []]) wake()
    }
  }
}
