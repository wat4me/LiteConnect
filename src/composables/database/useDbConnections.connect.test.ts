import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * Pure logic mirror of connect dedupe + generation invalidation
 * (same contract as useDbConnections.connect).
 */
function createConnectController() {
  const live = new Map<string, { sessionId: string }>()
  const inflight = new Map<string, Promise<void>>()
  const generation = new Map<string, number>()
  const connecting = new Set<string>()
  let nextSession = 1
  const disconnects: string[] = []
  const connects: string[] = []

  async function dbConnect(connectionId: string): Promise<{ sessionId: string }> {
    connects.push(connectionId)
    await Promise.resolve()
    return { sessionId: `sess-${nextSession++}` }
  }

  async function dbDisconnect(sessionId: string) {
    disconnects.push(sessionId)
  }

  async function connect(connectionId: string) {
    if (live.has(connectionId)) return
    const existing = inflight.get(connectionId)
    if (existing) {
      await existing
      return
    }
    const gen = (generation.get(connectionId) || 0) + 1
    generation.set(connectionId, gen)
    connecting.add(connectionId)
    const run = (async () => {
      try {
        const info = await dbConnect(connectionId)
        if (generation.get(connectionId) !== gen) {
          await dbDisconnect(info.sessionId)
          return
        }
        live.set(connectionId, info)
      } finally {
        if (generation.get(connectionId) === gen) connecting.delete(connectionId)
        inflight.delete(connectionId)
      }
    })()
    inflight.set(connectionId, run)
    await run
  }

  function invalidate(connectionId: string) {
    generation.set(connectionId, (generation.get(connectionId) || 0) + 1)
    connecting.delete(connectionId)
  }

  return { live, connecting, connects, disconnects, connect, invalidate, dbConnect }
}

describe('db connect dedupe + stale response', () => {
  it('double-click reuses one in-flight connect', async () => {
    const c = createConnectController()
    let resolveConnect!: (v: { sessionId: string }) => void
    const slow = new Promise<{ sessionId: string }>((r) => {
      resolveConnect = r
    })
    // Override dbConnect to hang once
    let calls = 0
    const orig = c.dbConnect
    ;(c as any).dbConnect = async (id: string) => {
      calls++
      c.connects.push(id)
      if (calls === 1) return slow
      return orig(id)
    }

    // Rebuild connect with patched dbConnect — use manual hang via generation of two parallel
    // Simpler: fire two connects with shared inflight map by calling connect twice quickly
    // with real async:
    const ctrl = createConnectController()
    const p1 = ctrl.connect('c1')
    const p2 = ctrl.connect('c1')
    await Promise.all([p1, p2])
    expect(ctrl.connects.length).toBe(1)
    expect(ctrl.live.size).toBe(1)
  })

  it('different connections connect in parallel', async () => {
    const ctrl = createConnectController()
    await Promise.all([ctrl.connect('a'), ctrl.connect('b')])
    expect(ctrl.connects.sort()).toEqual(['a', 'b'])
    expect(ctrl.live.size).toBe(2)
  })

  it('invalidate during connect disconnects stale session', async () => {
    let resolveConnect!: (v: { sessionId: string }) => void
    const gate = new Promise<{ sessionId: string }>((r) => {
      resolveConnect = r
    })

    const live = new Map<string, { sessionId: string }>()
    const inflight = new Map<string, Promise<void>>()
    const generation = new Map<string, number>()
    const disconnects: string[] = []
    let connectCalls = 0

    async function connect(id: string) {
      if (live.has(id)) return
      if (inflight.has(id)) {
        await inflight.get(id)
        return
      }
      const gen = (generation.get(id) || 0) + 1
      generation.set(id, gen)
      const run = (async () => {
        connectCalls++
        const info = await gate
        if (generation.get(id) !== gen) {
          disconnects.push(info.sessionId)
          return
        }
        live.set(id, info)
      })().finally(() => inflight.delete(id))
      inflight.set(id, run)
      await run
    }

    const p = connect('c1')
    // disconnect while connecting
    generation.set('c1', (generation.get('c1') || 0) + 1)
    resolveConnect({ sessionId: 'orphan-sess' })
    await p
    expect(live.size).toBe(0)
    expect(disconnects).toEqual(['orphan-sess'])
    expect(connectCalls).toBe(1)
  })
})
