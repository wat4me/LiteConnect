import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbConnection, DbSessionInfo } from './types'
import type { DbTunnelCloseReason, DbTunnelHandle } from './sshTunnel'

vi.mock('./drivers/mysql', () => ({
  MySqlDriver: class {
    private sessions = new Map<string, DbSessionInfo>()
    async connect(conn: DbConnection): Promise<DbSessionInfo> {
      const info: DbSessionInfo = {
        sessionId: 'sess-' + conn.id.slice(0, 8),
        connectionId: conn.id,
        connectionName: conn.name,
        engine: 'mysql',
        host: conn.host,
        port: conn.port,
        username: conn.username,
        database: conn.database || null,
        serverVersion: '8.0',
      }
      this.sessions.set(info.sessionId, info)
      return info
    }
    async disconnect(sessionId: string) {
      this.sessions.delete(sessionId)
    }
    disconnectAll() {
      this.sessions.clear()
    }
    async disconnectByConnectionId(connectionId: string) {
      for (const [id, s] of this.sessions) {
        if (s.connectionId === connectionId) this.sessions.delete(id)
      }
    }
    hasSession(sessionId: string) {
      return this.sessions.has(sessionId)
    }
    getSession(sessionId: string) {
      return this.sessions.get(sessionId) || null
    }
  },
}))

const openDbSshTunnel = vi.fn()
vi.mock('./sshTunnel', () => ({
  openDbSshTunnel: (...args: unknown[]) => openDbSshTunnel(...args),
}))

import { DatabaseManager } from './manager'

function makeTunnel(): DbTunnelHandle & {
  fire: (reason: DbTunnelCloseReason) => void
  closeCount: number
} {
  let closed = false
  let reason: DbTunnelCloseReason = 'local_close'
  const listeners = new Set<(r: DbTunnelCloseReason) => void>()
  const handle = {
    localHost: '127.0.0.1',
    localPort: 54321,
    remoteHost: '10.0.0.1',
    remotePort: 3306,
    closeCount: 0,
    close: () => {
      if (closed) return
      closed = true
      handle.closeCount++
      reason = 'local_close'
      for (const cb of listeners) cb(reason)
      listeners.clear()
    },
    onClosed: (cb: (r: DbTunnelCloseReason) => void) => {
      if (closed) {
        cb(reason)
        return
      }
      listeners.add(cb)
    },
    fire: (r: DbTunnelCloseReason) => {
      if (closed) return
      closed = true
      handle.closeCount++
      reason = r
      for (const cb of [...listeners]) cb(r)
      listeners.clear()
    },
  }
  return handle
}

function conn(id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'): DbConnection {
  return {
    id,
    name: 'db1',
    engine: 'mysql',
    host: '10.0.0.1',
    port: 3306,
    username: 'u',
    password: 'p',
    sshConnectionId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('DatabaseManager sessionLost lifecycle', () => {
  let manager: DatabaseManager
  let lostEvents: any[]

  beforeEach(() => {
    openDbSshTunnel.mockReset()
    manager = new DatabaseManager()
    lostEvents = []
    manager.setSessionLostHandler((ev) => lostEvents.push(ev))
    manager.setTunnelDeps(
      {
        init: async () => {},
        getConnectionForAuth: () => ({
          id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
          name: 'ssh',
          host: 'bastion',
          port: 22,
          username: 'root',
          password: 'x',
        }),
      } as any,
      { init: async () => {} } as any,
    )
  })

  it('emits structured sessionLost once on remote close (no English message field)', async () => {
    const tunnel = makeTunnel()
    openDbSshTunnel.mockResolvedValue(tunnel)
    const info = await manager.connect(conn())
    expect(info.viaTunnel).toBe(true)

    tunnel.fire('ssh_tunnel_closed')
    // allow async handleTunnelLost
    await Promise.resolve()
    await Promise.resolve()

    expect(lostEvents).toHaveLength(1)
    expect(lostEvents[0].reason).toBe('ssh_tunnel_closed')
    expect(lostEvents[0].sessionId).toBe(info.sessionId)
    expect(lostEvents[0].connectionId).toBe(conn().id)
    expect(lostEvents[0].message).toBeUndefined()
    expect(lostEvents[0].detail).toBeTruthy()

    // second fire is no-op
    tunnel.fire('ssh_tunnel_error')
    await Promise.resolve()
    expect(lostEvents).toHaveLength(1)
  })

  it('emits once on tunnel error', async () => {
    const tunnel = makeTunnel()
    openDbSshTunnel.mockResolvedValue(tunnel)
    const info = await manager.connect(conn())
    tunnel.fire('ssh_tunnel_error')
    await Promise.resolve()
    await Promise.resolve()
    expect(lostEvents).toHaveLength(1)
    expect(lostEvents[0].reason).toBe('ssh_tunnel_error')
    expect(lostEvents[0].sessionId).toBe(info.sessionId)
  })

  it('intentional disconnect does not notify sessionLost', async () => {
    const tunnel = makeTunnel()
    openDbSshTunnel.mockResolvedValue(tunnel)
    const info = await manager.connect(conn())
    await manager.disconnect(info.sessionId)
    expect(lostEvents).toHaveLength(0)
    expect(tunnel.closeCount).toBe(1)
  })

  it('disconnectByConnectionId does not notify sessionLost', async () => {
    const tunnel = makeTunnel()
    openDbSshTunnel.mockResolvedValue(tunnel)
    const c = conn()
    await manager.connect(c)
    await manager.disconnectByConnectionId(c.id)
    expect(lostEvents).toHaveLength(0)
  })

  it('takePendingSessionLost recovers race before renderer subscription', async () => {
    const tunnel = makeTunnel()
    openDbSshTunnel.mockResolvedValue(tunnel)
    const c = conn()
    const info = await manager.connect(c)

    // Drop immediately (as if before renderer attached listener)
    tunnel.fire('ssh_tunnel_closed')
    await Promise.resolve()
    await Promise.resolve()

    expect(lostEvents).toHaveLength(1)
    const pending = manager.takePendingSessionLost(c.id, info.sessionId)
    expect(pending?.sessionId).toBe(info.sessionId)
    expect(pending?.reason).toBe('ssh_tunnel_closed')
    // second take is empty
    expect(manager.takePendingSessionLost(c.id, info.sessionId)).toBeNull()
  })

  it('connect result includes sessionLost when tunnel drops during connectOnce', async () => {
    const tunnel = makeTunnel()
    openDbSshTunnel.mockImplementation(async () => {
      // Fire after attach would register — simulate by returning tunnel that closes on onClosed register
      const t = tunnel
      const origOnClosed = t.onClosed.bind(t)
      t.onClosed = (cb) => {
        origOnClosed(cb)
        queueMicrotask(() => t.fire('ssh_tunnel_closed'))
      }
      return t
    })
    const c = conn()
    const info = await manager.connect(c)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // Either embedded on info or pending map
    const embedded = (info as any).sessionLost
    const pending = manager.takePendingSessionLost(c.id, info.sessionId)
    expect(embedded || pending).toBeTruthy()
    expect(lostEvents.length).toBeGreaterThanOrEqual(1)
    expect(lostEvents[0].message).toBeUndefined()
  })
})
