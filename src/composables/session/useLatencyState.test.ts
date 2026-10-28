import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import type { ConnectionGroup } from '@/domain/session/types'
import { useLatencyState } from './useLatencyState'

const lifecycle = vi.hoisted(() => ({ mount: () => {}, unmount: () => {} }))
vi.mock('vue', async original => ({
  ...await original<typeof import('vue')>(),
  onMounted: (callback: () => void) => { lifecycle.mount = callback },
  onBeforeUnmount: (callback: () => void) => { lifecycle.unmount = callback },
}))

let hidden = false
let visibility: () => void
let scope: EffectScope
const probe = vi.fn<(id: string) => Promise<number>>()
function setup(count = 1) {
  const groups = ref<ConnectionGroup[]>(Array.from({ length: count }, (_, index) => ({
    connectionId: String(index), connectionName: String(index), activeSessionId: 'session-' + index, nextTabNumber: 2,
    sessions: [{ id: 'session-' + index, connectionId: String(index), connectionName: String(index), tabNumber: 1 }],
  })))
  scope = effectScope()
  const state = scope.run(() => useLatencyState({ groups }))!
  lifecycle.mount()
  return { groups, ...state }
}
const advance = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => {
  vi.useFakeTimers()
  hidden = false
  probe.mockReset().mockResolvedValue(12)
  vi.stubGlobal('window', { LiteConnect: { sshMeasureLatency: probe } })
  vi.stubGlobal('document', {
    get hidden() { return hidden },
    addEventListener: (_: string, callback: () => void) => { visibility = callback },
    removeEventListener: vi.fn(),
  })
})
afterEach(() => { lifecycle.unmount(); scope?.stop(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('latency polling lifecycle', () => {
  it('limits concurrent probes to four and schedules the next round after completion', async () => {
    const pending: Array<(ms: number) => void> = []
    probe.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
    setup(7)
    await advance()
    expect(probe).toHaveBeenCalledTimes(4)
    await advance(30_000)
    expect(probe).toHaveBeenCalledTimes(4)
    pending.splice(0).forEach(resolve => resolve(10))
    await advance()
    expect(probe).toHaveBeenCalledTimes(7)
    pending.splice(0).forEach(resolve => resolve(10))
    await advance(9999)
    expect(probe).toHaveBeenCalledTimes(7)
    await advance(1)
    expect(probe).toHaveBeenCalledTimes(11)
  })

  it('uses a 60 second background interval and refreshes when visible again', async () => {
    setup()
    await advance()
    expect(probe).toHaveBeenCalledTimes(1)
    hidden = true
    visibility()
    await advance(59_999)
    expect(probe).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(probe).toHaveBeenCalledTimes(2)
    hidden = false
    visibility()
    await advance()
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('discards stale results and cancels queued probes when disabled', async () => {
    const pending: Array<(ms: number) => void> = []
    probe.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
    const state = setup(9)
    await advance()
    state.latencyEnabled.value = false
    await nextTick()
    pending.splice(0).forEach(resolve => resolve(22))
    await advance(90_000)
    expect(state.latencyMap.value).toEqual({})
    expect(probe).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits for in-flight probes before refreshing on visibility changes', async () => {
    const pending: Array<(ms: number) => void> = []
    probe.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
    const state = setup(6)
    await advance()
    hidden = true
    visibility()
    await advance(60_000)
    expect(probe).toHaveBeenCalledTimes(4)
    hidden = false
    visibility()
    await advance()
    expect(probe).toHaveBeenCalledTimes(4)
    pending.splice(0).forEach(resolve => resolve(99))
    await advance()
    expect(probe).toHaveBeenCalledTimes(8)
    expect(state.latencyMap.value).toEqual({})
    pending.splice(0).forEach(resolve => resolve(12))
    await advance()
    expect(probe).toHaveBeenCalledTimes(10)
    pending.splice(0).forEach(resolve => resolve(12))
    await advance()
    expect(Object.values(state.latencyMap.value)).toEqual(Array(6).fill(12))
  })

  it('rejects results from a replaced SSH session and probes the new session', async () => {
    let resolve!: (ms: number) => void
    probe.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const state = setup()
    await advance()
    state.groups.value[0].sessions[0].id = 'replacement'
    state.groups.value[0].activeSessionId = 'replacement'
    await nextTick()
    resolve(99)
    await advance()
    expect(probe).toHaveBeenLastCalledWith('replacement')
    expect(state.latencyMap.value).toEqual({ '0': 12 })
  })

  it('cleans removed connections and leaves no timers without sessions', async () => {
    const state = setup()
    await advance()
    expect(state.latencyMap.value).toEqual({ '0': 12 })
    state.groups.value = []
    await nextTick()
    expect(state.latencyMap.value).toEqual({})
    expect(vi.getTimerCount()).toBe(0)
    await advance(90_000)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('ignores in-flight results after unmount and removes visibility listeners', async () => {
    let resolve!: (value: number) => void
    probe.mockImplementation(() => new Promise(done => { resolve = done }))
    const state = setup()
    await advance()
    lifecycle.unmount()
    resolve(33)
    await advance(90_000)
    expect(state.latencyMap.value).toEqual({})
    expect(vi.getTimerCount()).toBe(0)
    expect(document.removeEventListener).toHaveBeenCalledWith('visibilitychange', visibility)
  })
})
