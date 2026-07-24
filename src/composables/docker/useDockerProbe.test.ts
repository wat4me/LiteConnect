import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { canApplyProbeResult, useDockerProbe } from './useDockerProbe'
import type { DockerAvailability } from '../env.d'

function mockliteConnect(probeImpl: (sessionId: string) => Promise<DockerAvailability>) {
  const g = globalThis as typeof globalThis & {
    window: { LiteConnect: { dockerProbe: typeof probeImpl } }
  }
  g.window = g.window || ({} as typeof g.window)
  g.window.LiteConnect = { dockerProbe: probeImpl }
}

describe('canApplyProbeResult', () => {
  it('rejects disposed, stale generation, owner mismatch, and inactive session', () => {
    expect(
      canApplyProbeResult({
        disposed: true,
        resultGen: 1,
        currentGen: 1,
        ownerSessionId: 'a',
        resultSessionId: 'a',
        activeSessionId: 'a',
      }),
    ).toBe(false)

    expect(
      canApplyProbeResult({
        disposed: false,
        resultGen: 1,
        currentGen: 2,
        ownerSessionId: 'a',
        resultSessionId: 'a',
        activeSessionId: 'a',
      }),
    ).toBe(false)

    expect(
      canApplyProbeResult({
        disposed: false,
        resultGen: 2,
        currentGen: 2,
        ownerSessionId: 'b',
        resultSessionId: 'a',
        activeSessionId: 'a',
      }),
    ).toBe(false)

    expect(
      canApplyProbeResult({
        disposed: false,
        resultGen: 2,
        currentGen: 2,
        ownerSessionId: 'a',
        resultSessionId: 'a',
        activeSessionId: 'b',
      }),
    ).toBe(false)
  })

  it('accepts matching live result', () => {
    expect(
      canApplyProbeResult({
        disposed: false,
        resultGen: 3,
        currentGen: 3,
        ownerSessionId: 's1',
        resultSessionId: 's1',
        activeSessionId: 's1',
      }),
    ).toBe(true)
  })
})

describe('useDockerProbe stale-result guard', () => {
  let scope: ReturnType<typeof effectScope>

  beforeEach(() => {
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
  })

  it('does not apply late probe from previous session', async () => {
    let resolveA: (v: DockerAvailability) => void
    const probeA = new Promise<DockerAvailability>((r) => {
      resolveA = r
    })
    const probeB: DockerAvailability = {
      status: 'available',
      engineVersion: '27.0',
      apiVersion: '1.46',
    }

    const calls: string[] = []
    mockliteConnect(async (sessionId) => {
      calls.push(sessionId)
      if (sessionId === 'sess-a') return probeA
      return probeB
    })

    const sessionId = ref<string | null>('sess-a')
    const api = scope.run(() => useDockerProbe(sessionId))!
    await nextTick()
    expect(calls).toContain('sess-a')
    expect(api.ui.value.kind).toBe('loading')

    sessionId.value = 'sess-b'
    await nextTick()
    // allow sess-b probe to settle
    await Promise.resolve()
    await nextTick()
    expect(api.availability.value).toEqual(probeB)

    // late sess-a must not overwrite
    resolveA!({ status: 'not-installed' })
    await Promise.resolve()
    await nextTick()
    expect(api.availability.value).toEqual(probeB)
    expect(api.availability.value?.status).not.toBe('not-installed')
  })

  it('does not apply late probe after refresh generation bump', async () => {
    let resolveFirst: (v: DockerAvailability) => void
    const first = new Promise<DockerAvailability>((r) => {
      resolveFirst = r
    })
    let call = 0
    mockliteConnect(async () => {
      call += 1
      if (call === 1) return first
      return {
        status: 'available',
        engineVersion: '28.0',
        apiVersion: '1.47',
      }
    })

    const sessionId = ref<string | null>('s1')
    const api = scope.run(() => useDockerProbe(sessionId))!
    await nextTick()
    expect(api.ui.value.kind).toBe('loading')

    // second probe (refresh) starts new generation
    void api.probe()
    await Promise.resolve()
    await nextTick()
    await Promise.resolve()
    await nextTick()
    expect(api.availability.value).toEqual({
      status: 'available',
      engineVersion: '28.0',
      apiVersion: '1.47',
    })

    resolveFirst!({ status: 'permission-denied', message: 'x' })
    await Promise.resolve()
    await nextTick()
    expect(api.availability.value?.status).toBe('available')
  })

  it('ignores results after dispose', async () => {
    let resolveP: (v: DockerAvailability) => void
    const pending = new Promise<DockerAvailability>((r) => {
      resolveP = r
    })
    mockliteConnect(async () => pending)

    const sessionId = ref<string | null>('s1')
    const api = scope.run(() => useDockerProbe(sessionId))!
    await nextTick()
    expect(api.ui.value.kind).toBe('loading')
    api.dispose()
    resolveP!({ status: 'not-installed' })
    await Promise.resolve()
    await nextTick()
    expect(api.ui.value.kind).not.toBe('result')
  })
})
