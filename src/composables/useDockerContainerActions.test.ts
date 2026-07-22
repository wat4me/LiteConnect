import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useDockerContainerActions } from './useDockerContainerActions'

const dockerContainerAction = vi.fn()

beforeAllPolyfill()

function beforeAllPolyfill() {
  ;(globalThis as any).window = {
    LiteConnect: {
      dockerContainerAction: (...args: unknown[]) => dockerContainerAction(...args),
    },
  }
}

afterEach(() => {
  dockerContainerAction.mockReset()
})

describe('useDockerContainerActions', () => {
  it('dedupes rapid clicks on same container to one IPC', async () => {
    let resolve!: (v: unknown) => void
    dockerContainerAction.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerActions(sessionId)

    const p1 = api.runAction('cid-a', 'stop')
    const p2 = api.runAction('cid-a', 'stop')
    expect(dockerContainerAction).toHaveBeenCalledTimes(1)
    expect(api.isBusy('cid-a')).toBe(true)
    expect(api.getBusyAction('cid-a')).toBe('stop')

    resolve({ ok: true, result: { action: 'stop', containerId: 'cid-a', outcome: 'completed' } })
    await p1
    await p2
    expect(api.isBusy('cid-a')).toBe(false)
    expect(api.feedback.value?.kind).toBe('completed')
    api.dispose()
  })

  it('disables all actions for busy container only (A busy, B free)', async () => {
    let resolveA!: (v: unknown) => void
    dockerContainerAction.mockImplementation((sid: string, cid: string) => {
      if (cid === 'a') {
        return new Promise((r) => {
          resolveA = r
        })
      }
      return Promise.resolve({
        ok: true,
        result: { action: 'start', containerId: cid, outcome: 'completed' },
      })
    })
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerActions(sessionId)

    const pA = api.runAction('a', 'stop')
    expect(api.isBusy('a')).toBe(true)
    expect(api.isBusy('b')).toBe(false)

    const pB = api.runAction('b', 'start')
    expect(dockerContainerAction).toHaveBeenCalledTimes(2)
    await pB
    expect(api.isBusy('b')).toBe(false)
    expect(api.isBusy('a')).toBe(true)

    resolveA({ ok: true, result: { action: 'stop', containerId: 'a', outcome: 'completed' } })
    await pA
    expect(api.isBusy('a')).toBe(false)
    api.dispose()
  })

  it('clears busy on failure', async () => {
    dockerContainerAction.mockResolvedValue({ ok: false, code: 'action-conflict' })
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerActions(sessionId)
    await api.runAction('c1', 'start')
    expect(api.isBusy('c1')).toBe(false)
    expect(api.feedback.value?.kind).toBe('action-conflict')
    api.dispose()
  })

  it('session switch clears busy and ignores late success', async () => {
    let resolve!: (v: unknown) => void
    dockerContainerAction.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerActions(sessionId)
    const refresh = vi.fn(async () => {})

    const p = api.runAction('c1', 'restart', { onSuccessRefresh: refresh })
    expect(api.isBusy('c1')).toBe(true)

    sessionId.value = 'sess-2'
    await nextTick()
    expect(api.isBusy('c1')).toBe(false)

    resolve({
      ok: true,
      result: { action: 'restart', containerId: 'c1', outcome: 'completed' },
    })
    await p
    expect(api.feedback.value).toBeNull()
    expect(refresh).not.toHaveBeenCalled()
    api.dispose()
  })

  it('dispose ignores late result (no success feedback)', async () => {
    let resolve!: (v: unknown) => void
    dockerContainerAction.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerActions(sessionId)
    const refresh = vi.fn(async () => {})
    const p = api.runAction('c1', 'start', { onSuccessRefresh: refresh })
    api.dispose()
    resolve({
      ok: true,
      result: { action: 'start', containerId: 'c1', outcome: 'completed' },
    })
    await p
    expect(refresh).not.toHaveBeenCalled()
    expect(api.feedback.value).toBeNull()
  })

  it('stale/disconnected does not show completed feedback', async () => {
    dockerContainerAction.mockResolvedValue({ ok: false, code: 'generation-stale' })
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerActions(sessionId)
    const refresh = vi.fn(async () => {})
    await api.runAction('c1', 'stop', { onSuccessRefresh: refresh })
    expect(api.feedback.value?.kind).toBe('generation-stale')
    expect(refresh).not.toHaveBeenCalled()
    api.dispose()
  })

  it('success triggers one refresh callback', async () => {
    dockerContainerAction.mockResolvedValue({
      ok: true,
      result: { action: 'start', containerId: 'c1', outcome: 'completed' },
    })
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerActions(sessionId)
    const refresh = vi.fn(async () => {})
    await api.runAction('c1', 'start', { onSuccessRefresh: refresh })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(api.feedback.value?.kind).toBe('completed')
    api.dispose()
  })

  it('already-in-state is not completed', async () => {
    dockerContainerAction.mockResolvedValue({
      ok: true,
      result: { action: 'start', containerId: 'c1', outcome: 'already-in-state' },
    })
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerActions(sessionId)
    await api.runAction('c1', 'start')
    expect(api.feedback.value?.kind).toBe('already-in-state')
    api.dispose()
  })

  it('keeps busy true until success refresh completes', async () => {
    let resolveRefresh!: () => void
    dockerContainerAction.mockResolvedValue({
      ok: true,
      result: { action: 'stop', containerId: 'c1', outcome: 'completed' },
    })
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerActions(sessionId)
    const refresh = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveRefresh = r
        }),
    )
    const p = api.runAction('c1', 'stop', { onSuccessRefresh: refresh })
    // Allow IPC to settle and refresh to start
    await Promise.resolve()
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(api.isBusy('c1')).toBe(true)
    expect(api.feedback.value?.kind).toBe('completed')
    // Second click while refreshing: no second IPC
    void api.runAction('c1', 'stop', { onSuccessRefresh: refresh })
    expect(dockerContainerAction).toHaveBeenCalledTimes(1)
    resolveRefresh()
    await p
    expect(api.isBusy('c1')).toBe(false)
    api.dispose()
  })

  it('clears busy when refresh throws', async () => {
    dockerContainerAction.mockResolvedValue({
      ok: true,
      result: { action: 'start', containerId: 'c1', outcome: 'completed' },
    })
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerActions(sessionId)
    const refresh = vi.fn(async () => {
      throw new Error('refresh failed')
    })
    await api.runAction('c1', 'start', { onSuccessRefresh: refresh })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(api.isBusy('c1')).toBe(false)
    expect(api.feedback.value?.kind).toBe('completed')
    api.dispose()
  })

  it('B remains operable while A is busy through refresh', async () => {
    let resolveRefreshA!: () => void
    dockerContainerAction.mockImplementation((_sid: string, cid: string, action: string) => {
      if (cid === 'a') {
        return Promise.resolve({
          ok: true,
          result: { action, containerId: 'a', outcome: 'completed' },
        })
      }
      return Promise.resolve({
        ok: true,
        result: { action, containerId: cid, outcome: 'completed' },
      })
    })
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerActions(sessionId)
    const refreshA = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveRefreshA = r
        }),
    )
    const pA = api.runAction('a', 'stop', { onSuccessRefresh: refreshA })
    await Promise.resolve()
    await Promise.resolve()
    expect(api.isBusy('a')).toBe(true)
    expect(api.isBusy('b')).toBe(false)
    await api.runAction('b', 'start')
    expect(dockerContainerAction).toHaveBeenCalledTimes(2)
    expect(api.isBusy('b')).toBe(false)
    resolveRefreshA()
    await pA
    expect(api.isBusy('a')).toBe(false)
    api.dispose()
  })

  it('late refresh after session switch does not update feedback', async () => {
    let resolveRefresh!: () => void
    dockerContainerAction.mockResolvedValue({
      ok: true,
      result: { action: 'restart', containerId: 'c1', outcome: 'completed' },
    })
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerActions(sessionId)
    const refresh = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveRefresh = r
        }),
    )
    const p = api.runAction('c1', 'restart', { onSuccessRefresh: refresh })
    await Promise.resolve()
    await Promise.resolve()
    expect(api.feedback.value?.kind).toBe('completed')
    sessionId.value = 'sess-2'
    await nextTick()
    expect(api.isBusy('c1')).toBe(false)
    expect(api.feedback.value).toBeNull()
    resolveRefresh()
    await p
    expect(api.feedback.value).toBeNull()
    api.dispose()
  })
})
