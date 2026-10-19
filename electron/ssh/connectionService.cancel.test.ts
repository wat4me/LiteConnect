import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection, Session, SSHCallbacks } from './types'
import { ConnectionService } from './connectionService'
import { SSH_CONNECTION_CANCELLED } from '../../shared/sshConnectionProgress'

const clients: FakeClient[] = []
class FakeClient extends EventEmitter {
  constructor() { super(); clients.push(this) }
  connect = vi.fn(() => this)
  end = vi.fn()
  destroy = vi.fn()
  setNoDelay = vi.fn()
  shell = vi.fn((_options: unknown, _callback: (error: Error | null, stream: any) => void) => {})
}
vi.mock('./loadSsh2', () => ({ loadSsh2: async () => ({ Client: FakeClient }) }))
vi.mock('./connectionX11', () => ({ resolveConnectionX11: async () => ({ useX11: false }) }))
vi.mock('../i18n', () => ({ t: (key: string) => key }))
vi.mock('electron', () => ({ app: { getPath: () => 'D:/tmp/LiteConnect-test-userdata' } }))

describe('ConnectionService cancellation', () => {
  beforeEach(() => { clients.length = 0; vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('rejects an offline host after the handshake deadline and reports the error', async () => {
    const sessions = new Map<string, Session>()
    const service = new ConnectionService({
      sessions, decoders: new Map(), pendingHostKeys: new Map(), knownHosts: {} as any,
      cleanupSession: vi.fn(), bumpSessionEpoch: () => 1, getSessionEpoch: () => 1,
    })
    const callbacks: SSHCallbacks = { onData: vi.fn(), onError: vi.fn(), onClose: vi.fn() }
    const result = service.connect({ id: 'offline', name: 'Offline', host: '10.2.5.223', port: 22, username: 'root' } as Connection, callbacks)
    const rejection = expect(result).rejects.toThrow('Timed out while waiting for handshake')
    await vi.advanceTimersByTimeAsync(20_000)
    await rejection
    expect(callbacks.onError).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('Timed out'))
    expect(clients[0].destroy).toHaveBeenCalled()
    expect(sessions.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])('destroys the client and rejects late shell results (shell started: %s)', async (ready) => {
    const sessions = new Map<string, Session>()
    const service = new ConnectionService({
      sessions, decoders: new Map(), pendingHostKeys: new Map(), knownHosts: {} as any,
      cleanupSession: vi.fn(), bumpSessionEpoch: () => 1, getSessionEpoch: () => 1,
    })
    const controller = new AbortController()
    const callbacks: SSHCallbacks = { signal: controller.signal, onData: vi.fn(), onError: vi.fn(), onClose: vi.fn() }
    const result = service.connect({ id: 'c1', name: 'Server', host: 'host', username: 'root' } as Connection, callbacks)
    const rejection = expect(result).rejects.toThrow(SSH_CONNECTION_CANCELLED)
    await vi.advanceTimersByTimeAsync(0)
    const client = clients[0]
    if (ready) client.emit('ready')
    controller.abort()
    await rejection
    expect(client.destroy).toHaveBeenCalled()
    if (ready) {
      const stream = { close: vi.fn() }
      await client.shell.mock.calls[0][1](null, stream)
      expect(stream.close).toHaveBeenCalled()
    }
    expect(sessions.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(() => client.emit('error', new Error('late network error'))).not.toThrow()
  })
})
