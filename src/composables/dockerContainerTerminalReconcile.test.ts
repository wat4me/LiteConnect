import { describe, expect, it } from 'vitest'
import {
  createReconcileController,
  decideRetryCommit,
  decideTerminalReconcile,
  shouldResetForTarget,
  type ReconcileSnapshot,
} from './dockerContainerTerminalReconcile'

describe('decideTerminalReconcile', () => {
  const base = {
    ready: true,
    active: true,
    sessionId: 'sess-1',
    containerId: 'ctr1',
    sshDisconnected: false,
    containerRunnable: true,
    activeExecContainerId: null,
    activeExecSessionId: null,
  }

  it('returns noop before ready even if all other conditions hold', () => {
    expect(decideTerminalReconcile({ ...base, ready: false })).toEqual({ kind: 'noop' })
  })

  it('returns noop when no live exec and not startable (no stop needed)', () => {
    expect(decideTerminalReconcile({ ...base, ready: false, active: false })).toEqual({
      kind: 'noop',
    })
    expect(decideTerminalReconcile({ ...base, active: false })).toEqual({ kind: 'noop' })
  })

  it('returns start exactly once when ready+active+valid+runnable and no live exec', () => {
    expect(decideTerminalReconcile({ ...base })).toEqual({
      kind: 'start',
      containerId: 'ctr1',
      sessionId: 'sess-1',
    })
  })

  it('returns noop (no double start) when live exec matches same container+session', () => {
    expect(
      decideTerminalReconcile({
        ...base,
        activeExecContainerId: 'ctr1',
        activeExecSessionId: 'sess-1',
      }),
    ).toEqual({ kind: 'noop' })
  })

  it('returns start (stop+start) when container changes while live', () => {
    expect(
      decideTerminalReconcile({
        ...base,
        activeExecContainerId: 'ctr-old',
        activeExecSessionId: 'sess-1',
      }),
    ).toEqual({ kind: 'start', containerId: 'ctr1', sessionId: 'sess-1' })
  })

  it('returns start when session changes while live', () => {
    expect(
      decideTerminalReconcile({
        ...base,
        activeExecContainerId: 'ctr1',
        activeExecSessionId: 'sess-old',
      }),
    ).toEqual({ kind: 'start', containerId: 'ctr1', sessionId: 'sess-1' })
  })

  it('returns stop when a live exec exists but conditions became unstartable', () => {
    expect(
      decideTerminalReconcile({
        ...base,
        active: false,
        activeExecContainerId: 'ctr1',
        activeExecSessionId: 'sess-1',
      }),
    ).toEqual({ kind: 'stop' })
    expect(
      decideTerminalReconcile({
        ...base,
        sshDisconnected: true,
        activeExecContainerId: 'ctr1',
        activeExecSessionId: 'sess-1',
      }),
    ).toEqual({ kind: 'stop' })
    expect(
      decideTerminalReconcile({
        ...base,
        containerRunnable: false,
        activeExecContainerId: 'ctr1',
        activeExecSessionId: 'sess-1',
      }),
    ).toEqual({ kind: 'stop' })
    expect(
      decideTerminalReconcile({
        ...base,
        sessionId: null,
        activeExecContainerId: 'ctr1',
        activeExecSessionId: 'sess-1',
      }),
    ).toEqual({ kind: 'stop' })
  })

  it('stop takes precedence over start when ready is false but live exec exists', () => {
    expect(
      decideTerminalReconcile({
        ...base,
        ready: false,
        activeExecContainerId: 'ctr1',
        activeExecSessionId: 'sess-1',
      }),
    ).toEqual({ kind: 'stop' })
  })
})

// ─── Async controller: dirty-flag single-consumer loop ─────────────────────

/**
 * Controllable harness: start/stop resolve only when the test releases them,
 * letting us drive the exact A-pending -> B -> A-resolve ordering.
 */
function createHarness() {
  let snapshot: ReconcileSnapshot = {
    ready: true,
    active: true,
    sessionId: 'sess-1',
    containerId: 'A',
    sshDisconnected: false,
    containerRunnable: true,
  }
  let activeCid: string | null = null
  let activeSid: string | null = null
  let disposed = false

  const startCalls: Array<{ target: { containerId: string; sessionId: string } }> = []
  const stopCalls: number[] = []
  let startResolve: (() => void) | null = null
  let stopResolve: (() => void) | null = null
  const startPromises: Array<Promise<void>> = []
  const stopPromises: Array<Promise<void>> = []

  const ctl = createReconcileController({
    getSnapshot: () => snapshot,
    getActiveExecContainerId: () => activeCid,
    getActiveExecSessionId: () => activeSid,
    setActiveExec: (cid, sid) => {
      activeCid = cid
      activeSid = sid
    },
    start: (target) => {
      startCalls.push({ target: { ...target } })
      const p = new Promise<void>((r) => {
        startResolve = r
      })
      startPromises.push(p)
      return p
    },
    stop: () => {
      stopCalls.push(stopCalls.length)
      // Mimic stopSession: active owner is cleared only AFTER the async stop
      // completes (resolved by resolveStop), not synchronously.
      const p = new Promise<void>((r) => {
        stopResolve = r
      })
      stopPromises.push(p)
      return p
    },
    isDisposed: () => disposed,
  })

  return {
    ctl,
    setSnapshot(next: Partial<ReconcileSnapshot>) {
      snapshot = { ...snapshot, ...next }
    },
    setContainer(id: string) {
      snapshot = { ...snapshot, containerId: id }
    },
    setActive(cid: string | null, sid: string | null) {
      activeCid = cid
      activeSid = sid
    },
    getActiveCid: () => activeCid,
    getActiveSid: () => activeSid,
    dispose() {
      disposed = true
    },
    startCalls,
    stopCalls,
    resolveStart() {
      const r = startResolve
      startResolve = null
      r?.()
    },
    resolveStop() {
      const r = stopResolve
      stopResolve = null
      // Mimic stopSession clearing the active owner when the stop completes.
      activeCid = null
      activeSid = null
      r?.()
    },
  }
}

// Allow microtask queue to drain so the runner loop advances.
function flush() {
  return new Promise<void>((r) => setTimeout(r, 0))
}

describe('createReconcileController async scheduling', () => {
  it('A pending -> B request -> A resolve: A is stopped, B starts, final owner is B', async () => {
    const h = createHarness()
    h.setContainer('A')
    h.ctl.request()
    // Let the runner pick up A and enter start (pending).
    await flush()
    expect(h.startCalls.length).toBe(1)
    expect(h.startCalls[0].target.containerId).toBe('A')
    // A's start is pending. Switch props to B and request again.
    h.setContainer('B')
    h.ctl.request()
    // Resolve A's start. The runner should record A, then loop (dirty from B).
    h.resolveStart()
    await flush()
    // After A resolves, dirty loop sees B != A -> stop A then start B.
    // stop is pending; resolve it.
    expect(h.stopCalls.length).toBe(1)
    h.resolveStop()
    await flush()
    expect(h.startCalls.length).toBe(2)
    expect(h.startCalls[1].target.containerId).toBe('B')
    h.resolveStart()
    await flush()
    // Final active owner is B, not A.
    expect(h.getActiveCid()).toBe('B')
    expect(h.getActiveSid()).toBe('sess-1')
  })

  it('fast A -> B -> C: only C remains; A and B are stopped', async () => {
    const h = createHarness()
    h.setContainer('A')
    h.ctl.request()
    await flush()
    expect(h.startCalls.length).toBe(1)
    // A pending. Switch to B (dirty), then to C (dirty) before resolving A.
    h.setContainer('B')
    h.ctl.request()
    h.setContainer('C')
    h.ctl.request()
    h.resolveStart()
    await flush()
    // After A resolves, loop captures latest snapshot = C. Stop A.
    expect(h.stopCalls.length).toBe(1)
    expect(h.getActiveCid()).toBe('A')
    h.resolveStop()
    await flush()
    // Now start C (B was coalesced away - dirty flag cleared once per round).
    expect(h.startCalls.length).toBe(2)
    expect(h.startCalls[1].target.containerId).toBe('C')
    h.resolveStart()
    await flush()
    expect(h.getActiveCid()).toBe('C')
    // No extra starts beyond A and C.
    expect(h.startCalls.length).toBe(2)
  })

  it('A pending data/resize does not enter B: A is stopped before B starts', async () => {
    const h = createHarness()
    h.setContainer('A')
    h.ctl.request()
    await flush()
    // A pending. Switch to B.
    h.setContainer('B')
    h.ctl.request()
    h.resolveStart()
    await flush()
    // A's active owner was set to A; stop A first; only after stop resolve, start B.
    expect(h.stopCalls.length).toBe(1)
    expect(h.startCalls.length).toBe(1) // still only A
    expect(h.getActiveCid()).toBe('A')
    h.resolveStop()
    await flush()
    expect(h.startCalls.length).toBe(2)
    expect(h.startCalls[1].target.containerId).toBe('B')
    h.resolveStart()
    await flush()
    expect(h.getActiveCid()).toBe('B')
  })

  it('pending -> inactive: does not start B; stops A', async () => {
    const h = createHarness()
    h.setContainer('A')
    h.ctl.request()
    await flush()
    expect(h.startCalls.length).toBe(1)
    // While A pending, become inactive.
    h.setSnapshot({ active: false })
    h.ctl.request()
    h.resolveStart()
    await flush()
    // After A resolves, snapshot is inactive + live exec A -> stop.
    expect(h.stopCalls.length).toBe(1)
    expect(h.startCalls.length).toBe(1) // no B start
    h.resolveStop()
    await flush()
    expect(h.getActiveCid()).toBeNull()
  })

  it('pending -> dispose: no new start after dispose', async () => {
    const h = createHarness()
    h.setContainer('A')
    h.ctl.request()
    await flush()
    h.ctl.dispose()
    h.setContainer('B')
    h.ctl.request()
    h.resolveStart()
    await flush()
    // A resolved; controller disposed -> no B start.
    expect(h.startCalls.length).toBe(1)
    expect(h.startCalls[0].target.containerId).toBe('A')
  })

  it('no concurrent starts: second request coalesces while first pending', async () => {
    const h = createHarness()
    h.setContainer('A')
    h.ctl.request()
    await flush()
    expect(h.ctl.isRunning()).toBe(true)
    // Duplicate request for same target while pending -> coalesced, no second start.
    h.ctl.request()
    h.resolveStart()
    await flush()
    expect(h.startCalls.length).toBe(1)
    expect(h.ctl.isRunning()).toBe(false)
  })
})

// ─── shouldResetForTarget: rendered content owner vs live exec owner ────────

describe('shouldResetForTarget', () => {
  it('first start (no rendered owner) -> no reset', () => {
    expect(
      shouldResetForTarget(null, null, { containerId: 'A', sessionId: 's1' }),
    ).toBe(false)
  })

  it('rendered=A, start B -> reset', () => {
    expect(
      shouldResetForTarget('A', 's1', { containerId: 'B', sessionId: 's1' }),
    ).toBe(true)
  })

  it('rendered session=A, start same container but session=B -> reset', () => {
    expect(
      shouldResetForTarget('A', 's1', { containerId: 'A', sessionId: 's2' }),
    ).toBe(true)
  })

  it('rendered=A, bash->sh retry same A -> no reset (keep failure output)', () => {
    expect(
      shouldResetForTarget('A', 's1', { containerId: 'A', sessionId: 's1' }),
    ).toBe(false)
  })

  it('stop does not clear rendered owner: stop A then start B still detects mismatch', () => {
    // After stop, rendered owner is still A (not cleared). start B must reset.
    expect(
      shouldResetForTarget('A', 's1', { containerId: 'B', sessionId: 's1' }),
    ).toBe(true)
  })
})

// ─── decideRetryCommit: retry target capture + post-await commit policy ─────

describe('decideRetryCommit', () => {
  const retryTarget = { containerId: 'A', sessionId: 's1' }

  it('disposed -> skip (write no owner)', () => {
    expect(
      decideRetryCommit({
        disposed: true,
        retryTarget,
        currentTarget: { containerId: 'A', sessionId: 's1' },
        canStart: true,
      }),
    ).toEqual({ kind: 'skip' })
  })

  it('props unchanged and startable -> commit retry target', () => {
    expect(
      decideRetryCommit({
        disposed: false,
        retryTarget,
        currentTarget: { containerId: 'A', sessionId: 's1' },
        canStart: true,
      }),
    ).toEqual({ kind: 'commit', containerId: 'A', sessionId: 's1' })
  })

  it('A retry pending -> props changed to B -> reconcile-only (do not write B or A as owner)', () => {
    expect(
      decideRetryCommit({
        disposed: false,
        retryTarget,
        currentTarget: { containerId: 'B', sessionId: 's1' },
        canStart: true,
      }),
    ).toEqual({ kind: 'reconcile-only' })
  })

  it('props changed and no longer startable -> reconcile-only', () => {
    expect(
      decideRetryCommit({
        disposed: false,
        retryTarget,
        currentTarget: { containerId: 'B', sessionId: 's1' },
        canStart: false,
      }),
    ).toEqual({ kind: 'reconcile-only' })
  })

  it('props unchanged but not startable -> reconcile-only (cannot commit)', () => {
    expect(
      decideRetryCommit({
        disposed: false,
        retryTarget,
        currentTarget: { containerId: 'A', sessionId: 's1' },
        canStart: false,
      }),
    ).toEqual({ kind: 'reconcile-only' })
  })

  it('shell selection is never reset by commit policy (caller preserves sh)', () => {
    // decideRetryCommit does not touch shell; the retry path keeps the user's
    // explicit sh choice. This test documents that the decision carries no
    // shell field - shell is the caller's responsibility.
    const d = decideRetryCommit({
      disposed: false,
      retryTarget,
      currentTarget: { containerId: 'A', sessionId: 's1' },
      canStart: true,
    })
    expect(d).toEqual({ kind: 'commit', containerId: 'A', sessionId: 's1' })
    expect('shell' in d).toBe(false)
  })
})

// ─── Controller dispose guard: pending start -> dispose -> no setActiveExec ──

describe('createReconcileController dispose guard on setActiveExec', () => {
  it('pending start -> dispose -> resolve: setActiveExec not called, owner stays null', async () => {
    let activeCid: string | null = null
    let activeSid: string | null = null
    let disposed = false
    let startResolve: (() => void) | null = null

    const ctl = createReconcileController({
      getSnapshot: () => ({
        ready: true,
        active: true,
        sessionId: 's1',
        containerId: 'A',
        sshDisconnected: false,
        containerRunnable: true,
      }),
      getActiveExecContainerId: () => activeCid,
      getActiveExecSessionId: () => activeSid,
      setActiveExec: (cid, sid) => {
        activeCid = cid
        activeSid = sid
      },
      start: () =>
        new Promise<void>((r) => {
          startResolve = r
        }),
      stop: async () => {},
      isDisposed: () => disposed,
    })

    ctl.request()
    await flush()
    expect(startResolve).not.toBeNull()
    // Dispose while start is pending.
    ctl.dispose()
    disposed = true
    startResolve!()
    await flush()
    // setActiveExec was NOT called after dispose.
    expect(activeCid).toBeNull()
    expect(activeSid).toBeNull()
  })
})
