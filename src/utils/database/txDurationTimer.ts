/** Injectable transaction duration timer (no Vue dependency). */

export type TxDurationTimerOptions = {
  /** Clock: returns ms epoch */
  now?: () => number
  /** setInterval implementation */
  setIntervalFn?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>
  /** clearInterval implementation */
  clearIntervalFn?: (id: ReturnType<typeof setInterval>) => void
  /** Tick interval ms (default 1000) */
  intervalMs?: number
  /** Called every tick with elapsed ms */
  onTick?: (elapsedMs: number) => void
}

export type TxDurationTimer = {
  /** Start (or restart) from startedAt; replaces previous interval */
  start: (startedAt: number) => void
  /** Stop interval and clear startedAt */
  stop: () => void
  /** Whether an interval is currently running */
  isRunning: () => boolean
  /** Elapsed ms since start, or 0 if stopped */
  elapsedMs: () => number
  /** Format elapsed as H:MM:SS or M:SS */
  format: (elapsedMs?: number) => string
  /** Current startedAt or null */
  getStartedAt: () => number | null
}

export function formatTxDuration(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

export function createTxDurationTimer(opts: TxDurationTimerOptions = {}): TxDurationTimer {
  const now = opts.now ?? (() => Date.now())
  const setIntervalFn = opts.setIntervalFn ?? setInterval
  const clearIntervalFn = opts.clearIntervalFn ?? clearInterval
  const intervalMs = opts.intervalMs ?? 1000

  let startedAt: number | null = null
  let timerId: ReturnType<typeof setInterval> | null = null

  const clear = () => {
    if (timerId != null) {
      clearIntervalFn(timerId)
      timerId = null
    }
  }

  const tick = () => {
    if (startedAt == null) return
    opts.onTick?.(Math.max(0, now() - startedAt))
  }

  return {
    start(at: number) {
      clear()
      startedAt = at
      tick()
      timerId = setIntervalFn(tick, intervalMs)
    },
    stop() {
      clear()
      startedAt = null
    },
    isRunning() {
      return timerId != null
    },
    elapsedMs() {
      if (startedAt == null) return 0
      return Math.max(0, now() - startedAt)
    },
    format(elapsed?: number) {
      return formatTxDuration(elapsed ?? this.elapsedMs())
    },
    getStartedAt() {
      return startedAt
    },
  }
}
