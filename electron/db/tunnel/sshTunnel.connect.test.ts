import type { EventEmitter } from 'events'
import type { ConnectConfig } from 'ssh2'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openDbSshTunnel } from './sshTunnel'
import type { Connection } from '../../store/credentialStore'
import type { KnownHostsStore } from '../../ssh/trust/knownHosts'

type ClientDouble = EventEmitter & { config?: ConnectConfig; end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
const state = vi.hoisted(() => ({ clients: [] as ClientDouble[], forwardError: null as Error | null, closeServer: vi.fn() }))
vi.mock('../../ssh/loadSsh2', async () => {
  const { EventEmitter } = await import('events')
  const { PassThrough } = await import('stream')
  class Client extends EventEmitter {
    config?: ConnectConfig
    constructor() { super(); state.clients.push(this) }
    connect(config: ConnectConfig) {
      this.config = config
      queueMicrotask(() => this.emit('ready'))
      return this
    }
    forwardOut(_src: string, _srcPort: number, _dest: string, _destPort: number, callback: (error: Error | null, stream?: PassThrough) => void) {
      callback(state.forwardError, state.forwardError ? undefined : new PassThrough())
    }
    end = vi.fn()
    destroy = vi.fn()
    setNoDelay = vi.fn()
  }
  return { loadSsh2: async () => ({ Client }) }
})
vi.mock('net', async () => {
  const { EventEmitter } = await import('events')
  class Server extends EventEmitter {
    listen(_port: number, _host: string, callback: () => void) { queueMicrotask(callback) }
    address() { return { port: 12345 } }
    close = state.closeServer
  }
  return { createServer: () => new Server() }
})

const connection: Connection = {
  id: 'ssh', name: 'target', host: 'target.example', port: 2222, username: 'user', password: 'test-only',
  createdAt: 1, updatedAt: 1,
}
const knownHosts = { init: async () => {} } as KnownHostsStore

beforeEach(() => { state.clients.length = 0; state.forwardError = null; vi.clearAllMocks() })

describe('database SSH tunnel constructor ownership', () => {
  it('opens a direct connection with the lazily loaded client', async () => {
    const tunnel = await openDbSshTunnel(connection, 'db.internal', 5432, knownHosts)
    expect(state.clients).toHaveLength(1)
    expect(state.clients[0].config).toMatchObject({ host: 'target.example', port: 2222 })
    tunnel.close()
    expect(state.clients[0].destroy).toHaveBeenCalledOnce()
    expect(state.closeServer).toHaveBeenCalledOnce()
  })

  it('uses that constructor for the jump client and connects the target over its socket', async () => {
    const tunnel = await openDbSshTunnel({ ...connection, jumpHost: 'jump.example', jumpPort: 2200 }, 'db.internal', 5432, knownHosts)
    expect(state.clients).toHaveLength(2)
    const [target, jump] = state.clients
    expect(jump.config).toMatchObject({ host: 'jump.example', port: 2200 })
    expect(target.config?.sock).toBeDefined()
    expect(target.config).not.toHaveProperty('host')
    tunnel.close()
    expect(target.destroy).toHaveBeenCalledOnce()
    expect(jump.destroy).toHaveBeenCalledOnce()
  })

  it('closes both clients if the jump forward fails', async () => {
    state.forwardError = new Error('forward denied')
    await expect(openDbSshTunnel({ ...connection, jumpHost: 'jump.example' }, 'db.internal', 5432, knownHosts)).rejects.toThrow('Jump host forward failed: forward denied')
    expect(state.clients).toHaveLength(2)
    for (const client of state.clients) expect(client.destroy).toHaveBeenCalledOnce()
    expect(state.closeServer).not.toHaveBeenCalled()
  })
})
