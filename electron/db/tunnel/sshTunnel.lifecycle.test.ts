import { describe, expect, it, vi } from 'vitest'
import type { DbTunnelCloseReason } from './sshTunnel'

/**
 * Unit tests for tunnel close reason semantics without a real SSH server.
 * Mirrors openDbSshTunnel closeAll behaviour.
 */
describe('DbTunnel close semantics', () => {
  function makeCloseMachine() {
    let closed = false
    let closeReason: DbTunnelCloseReason = 'local_close'
    const closeListeners = new Set<(reason: DbTunnelCloseReason) => void>()
    const closeAll = (reason: DbTunnelCloseReason = 'local_close') => {
      if (closed) return
      closed = true
      closeReason = reason
      for (const cb of closeListeners) {
        try {
          cb(closeReason)
        } catch {}
      }
      closeListeners.clear()
    }
    return {
      closeAll,
      onClosed: (cb: (reason: DbTunnelCloseReason) => void) => {
        if (closed) {
          cb(closeReason)
          return
        }
        closeListeners.add(cb)
      },
      get closed() {
        return closed
      },
      get reason() {
        return closeReason
      },
    }
  }

  it('local_close fires once and second close is no-op', () => {
    const m = makeCloseMachine()
    const reasons: DbTunnelCloseReason[] = []
    m.onClosed((r) => reasons.push(r))
    m.closeAll('local_close')
    m.closeAll('ssh_tunnel_error')
    expect(reasons).toEqual(['local_close'])
    expect(m.closed).toBe(true)
  })

  it('ssh_tunnel_closed is distinct from local_close', () => {
    const m = makeCloseMachine()
    const reasons: DbTunnelCloseReason[] = []
    m.onClosed((r) => reasons.push(r))
    m.closeAll('ssh_tunnel_closed')
    expect(reasons).toEqual(['ssh_tunnel_closed'])
  })

  it('late onClosed after close still receives reason (handshake)', () => {
    const m = makeCloseMachine()
    m.closeAll('ssh_tunnel_error')
    const late: DbTunnelCloseReason[] = []
    m.onClosed((r) => late.push(r))
    expect(late).toEqual(['ssh_tunnel_error'])
  })
})
