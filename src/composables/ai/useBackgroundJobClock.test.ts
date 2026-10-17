import { effectScope, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useBackgroundJobClock } from './useBackgroundJobClock'

afterEach(() => vi.useRealTimers())

it('ticks only while active, catches up on resume, and cleans up when disposed', () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const active = ref(false)
  const scope = effectScope()
  const now = scope.run(() => useBackgroundJobClock(() => active.value))!
  try {
    expect(vi.getTimerCount()).toBe(0)
    active.value = true
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(2000)
    expect(now.value).toBe(3000)
    active.value = false
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(now.value).toBe(3000)
    active.value = true
    expect(now.value).toBe(8000)
    expect(vi.getTimerCount()).toBe(1)
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(now.value).toBe(8000)
  } finally { scope.stop() }
})
