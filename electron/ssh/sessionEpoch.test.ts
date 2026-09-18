import { describe, expect, it } from 'vitest'

/**
 * Pure generation logic used by SSHManager (connect/reconnect/disconnect).
 * Ensures late events from an old generation cannot affect a new connection.
 */
function createEpochTracker() {
  const map = new Map<string, number>()
  return {
    bump(sessionId: string): number {
      const next = (map.get(sessionId) || 0) + 1
      map.set(sessionId, next)
      return next
    },
    get(sessionId: string): number {
      return map.get(sessionId) || 0
    },
    isLive(sessionId: string, epoch: number): boolean {
      return this.get(sessionId) === epoch
    },
  }
}

describe('session connection generation', () => {
  it('bumps on connect and reconnect so old generation is dead', () => {
    const epochs = createEpochTracker()
    const sid = 'session-1'
    const e1 = epochs.bump(sid)
    expect(e1).toBe(1)
    expect(epochs.isLive(sid, e1)).toBe(true)

    const e2 = epochs.bump(sid) // reconnect
    expect(e2).toBe(2)
    expect(epochs.isLive(sid, e1)).toBe(false)
    expect(epochs.isLive(sid, e2)).toBe(true)
  })

  it('disconnect invalidates in-flight generation', () => {
    const epochs = createEpochTracker()
    const sid = 'session-2'
    const e1 = epochs.bump(sid)
    epochs.bump(sid) // disconnect
    expect(epochs.isLive(sid, e1)).toBe(false)
  })

  it('late close after new ready does not affect new generation', () => {
    const epochs = createEpochTracker()
    const sid = 'session-3'
    const oldEpoch = epochs.bump(sid)
    // old client still "connected"
    let notified = false
    const onOldClose = () => {
      if (!epochs.isLive(sid, oldEpoch)) return
      notified = true
    }

    const newEpoch = epochs.bump(sid) // new ready
    expect(newEpoch).toBeGreaterThan(oldEpoch)

    // late close from old client
    onOldClose()
    expect(notified).toBe(false)
    expect(epochs.isLive(sid, newEpoch)).toBe(true)
  })
})

describe('error/close notify dedupe', () => {
  /**
   * Renderer-side: first disconnect event schedules reconnect;
   * subsequent error/close while reconnecting or timer pending must not double-schedule.
   */
  it('error then close only schedules once', () => {
    let reconnecting = false
    let timer: number | null = null
    let scheduleCount = 0

    const noteDisconnected = () => {
      if (timer !== null || reconnecting) return
      scheduleCount++
      reconnecting = true
      timer = 1
    }

    noteDisconnected() // error
    noteDisconnected() // close
    expect(scheduleCount).toBe(1)
  })

  it('only error schedules once', () => {
    let reconnecting = false
    let timer: number | null = null
    let scheduleCount = 0
    const noteDisconnected = () => {
      if (timer !== null || reconnecting) return
      scheduleCount++
      reconnecting = true
      timer = 1
    }
    noteDisconnected()
    expect(scheduleCount).toBe(1)
  })

  it('only close schedules once', () => {
    let reconnecting = false
    let timer: number | null = null
    let scheduleCount = 0
    const noteDisconnected = () => {
      if (timer !== null || reconnecting) return
      scheduleCount++
      reconnecting = true
      timer = 1
    }
    noteDisconnected()
    expect(scheduleCount).toBe(1)
  })
})
