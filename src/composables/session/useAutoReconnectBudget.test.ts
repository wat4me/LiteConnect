import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAutoReconnectAttempts,
  getAutoReconnectAttempt,
  noteAutoReconnectAttempt,
} from '../session/'

describe('useAutoReconnectBudget', () => {
  const id = 'conn-budget-test'

  beforeEach(() => {
    clearAutoReconnectAttempts(id)
  })

  afterEach(() => {
    clearAutoReconnectAttempts(id)
  })

  it('allows up to maxRetries attempts then rejects', () => {
    expect(noteAutoReconnectAttempt(id, 3)).toEqual({ ok: true, attempt: 1 })
    expect(noteAutoReconnectAttempt(id, 3)).toEqual({ ok: true, attempt: 2 })
    expect(noteAutoReconnectAttempt(id, 3)).toEqual({ ok: true, attempt: 3 })
    expect(noteAutoReconnectAttempt(id, 3)).toEqual({ ok: false, attempt: 3 })
    expect(getAutoReconnectAttempt(id)).toBe(3)
  })

  it('rejects when maxRetries is 0', () => {
    expect(noteAutoReconnectAttempt(id, 0)).toEqual({ ok: false, attempt: 0 })
  })

  it('clears attempts for manual reconnect', () => {
    noteAutoReconnectAttempt(id, 5)
    noteAutoReconnectAttempt(id, 5)
    clearAutoReconnectAttempts(id)
    expect(getAutoReconnectAttempt(id)).toBe(0)
    expect(noteAutoReconnectAttempt(id, 5)).toEqual({ ok: true, attempt: 1 })
  })
})

/** Mirrors TerminalTab schedule delay: 1s → 2s → 4s … cap 15s */
function reconnectDelayMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), 15000)
}

describe('auto-reconnect backoff (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('schedules exponential backoff until exhausted', () => {
    const id = 'conn-backoff'
    clearAutoReconnectAttempts(id)
    const fires: number[] = []
    let cancelled = false
    let reconnecting = false
    let exhausted = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    const schedule = (max: number) => {
      if (cancelled) return
      const { ok, attempt } = noteAutoReconnectAttempt(id, max)
      if (!ok) {
        reconnecting = false
        exhausted = true
        return
      }
      reconnecting = true
      const delay = reconnectDelayMs(attempt)
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        if (cancelled) return
        fires.push(attempt)
        // simulate reconnect failure → reschedule
        reconnecting = false
        schedule(max)
      }, delay)
    }

    schedule(3)
    expect(reconnecting).toBe(true)
    expect(fires).toEqual([])

    vi.advanceTimersByTime(999)
    expect(fires).toEqual([])
    vi.advanceTimersByTime(1)
    expect(fires).toEqual([1])

    vi.advanceTimersByTime(2000)
    expect(fires).toEqual([1, 2])

    vi.advanceTimersByTime(4000)
    expect(fires).toEqual([1, 2, 3])
    expect(exhausted).toBe(true)
    expect(reconnecting).toBe(false)

    clearAutoReconnectAttempts(id)
  })

  it('cancel stops pending timer and further retries', () => {
    const id = 'conn-cancel'
    clearAutoReconnectAttempts(id)
    let cancelled = false
    let reconnecting = true
    let timer: ReturnType<typeof setTimeout> | null = null
    let fires = 0

    const { ok, attempt } = noteAutoReconnectAttempt(id, 5)
    expect(ok).toBe(true)
    timer = setTimeout(() => {
      fires++
    }, reconnectDelayMs(attempt))

    // user cancel
    cancelled = true
    if (timer) clearTimeout(timer)
    timer = null
    reconnecting = false

    vi.advanceTimersByTime(20000)
    expect(fires).toBe(0)
    expect(reconnecting).toBe(false)
    expect(cancelled).toBe(true)
    clearAutoReconnectAttempts(id)
  })
})
