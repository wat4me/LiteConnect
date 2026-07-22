import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTxDurationTimer, formatTxDuration } from './txDurationTimer'

describe('formatTxDuration', () => {
  it('formats under one hour as m:ss', () => {
    expect(formatTxDuration(0)).toBe('0:00')
    expect(formatTxDuration(1000)).toBe('0:01')
    expect(formatTxDuration(65_000)).toBe('1:05')
  })

  it('formats over one hour as h:mm:ss', () => {
    expect(formatTxDuration(3_661_000)).toBe('1:01:01')
  })
})

describe('createTxDurationTimer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks elapsed and releases interval on stop', () => {
    vi.useFakeTimers()
    const now = vi.fn(() => 1_000_000)
    const onTick = vi.fn()
    const timer = createTxDurationTimer({ now, onTick, intervalMs: 1000 })

    timer.start(1_000_000)
    expect(timer.isRunning()).toBe(true)
    expect(onTick).toHaveBeenCalledWith(0)

    now.mockReturnValue(1_003_000)
    vi.advanceTimersByTime(1000)
    expect(onTick).toHaveBeenLastCalledWith(3000)
    expect(timer.elapsedMs()).toBe(3000)
    expect(timer.format()).toBe('0:03')

    timer.stop()
    expect(timer.isRunning()).toBe(false)
    expect(timer.getStartedAt()).toBeNull()
    expect(timer.elapsedMs()).toBe(0)

    const calls = onTick.mock.calls.length
    vi.advanceTimersByTime(5000)
    expect(onTick.mock.calls.length).toBe(calls)
  })

  it('restart replaces previous interval without leak', () => {
    vi.useFakeTimers()
    let t = 0
    const now = () => t
    const onTick = vi.fn()
    const timer = createTxDurationTimer({ now, onTick, intervalMs: 1000 })

    timer.start(0)
    t = 2000
    vi.advanceTimersByTime(1000)
    expect(onTick).toHaveBeenLastCalledWith(2000)

    t = 10_000
    timer.start(10_000)
    expect(onTick).toHaveBeenLastCalledWith(0)
    t = 10_500
    vi.advanceTimersByTime(1000)
    expect(onTick).toHaveBeenLastCalledWith(500)

    timer.stop()
    expect(timer.isRunning()).toBe(false)
  })
})
