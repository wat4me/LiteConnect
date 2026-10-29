import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Connection, Session, SSHCallbacks } from './types'
import { ConnectionService } from './connectionService'
import { SSH_CONNECTION_CANCELLED } from '../../shared/sshConnectionProgress'

const clients: FakeClient[] = []
const x11 = vi.hoisted(() => ({ resolve: vi.fn() }))
class FakeClient extends EventEmitter {
  constructor() { super(); clients.push(this) }
  connect = vi.fn(() => this)
  end = vi.fn()
  destroy = vi.fn()
  setNoDelay = vi.fn()
  shell = vi.fn((_options: unknown, _callback: (error: Error | null, stream: any) => void) => {})
}
vi.mock('./loadSsh2', () => ({ loadSsh2: async () => ({ Client: FakeClient }) }))
vi.mock('./connectionX11', () => ({ resolveConnectionX11: x11.resolve }))
vi.mock('../i18n', () => ({ t: (key: string) => key }))
vi.mock('electron', () => ({ app: { getPath: () => 'D:/tmp/LiteConnect-test-userdata' } }))

describe('ConnectionService cancellation', () => {
  beforeEach(() => { clients.length = 0; x11.resolve.mockReset().mockResolvedValue({ useX11: false }); vi.useFakeTimers() })
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
    if (ready) { client.emit('ready'); await vi.advanceTimersByTimeAsync(0) }
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

  it('starts SSH while the first display is preparing, but waits before opening the shell', async () => {
    let finish!: (result: { useX11: boolean }) => void
    x11.resolve.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const sessions = new Map<string, Session>()
    const service = new ConnectionService({
      sessions, decoders: new Map(), pendingHostKeys: new Map(), knownHosts: {} as any,
      cleanupSession: vi.fn(), bumpSessionEpoch: () => 1, getSessionEpoch: () => 1,
    })
    const callbacks: SSHCallbacks = { onData: vi.fn(), onError: vi.fn(), onClose: vi.fn() }
    const result = service.connect({ id: 'cold-start', host: 'host', username: 'root' } as Connection, callbacks)
    await vi.advanceTimersByTimeAsync(0)
    const client = clients[0]
    expect(client.connect).toHaveBeenCalledOnce()
    client.emit('ready')
    await vi.advanceTimersByTimeAsync(0)
    expect(client.shell).not.toHaveBeenCalled()
    finish({ useX11: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(client.shell).toHaveBeenCalledOnce()
    const stream = Object.assign(new EventEmitter(), { stderr: new EventEmitter() })
    await client.shell.mock.calls[0][1](null, stream)
    await expect(result).resolves.toEqual(expect.any(String))
    expect(sessions.size).toBe(1)
  })

  it('does not open a late shell after cancellation during display preparation', async () => {
    let finish!: (result: { useX11: boolean }) => void
    x11.resolve.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const sessions = new Map<string, Session>()
    const service = new ConnectionService({
      sessions, decoders: new Map(), pendingHostKeys: new Map(), knownHosts: {} as any,
      cleanupSession: vi.fn(), bumpSessionEpoch: () => 1, getSessionEpoch: () => 1,
    })
    const controller = new AbortController()
    const result = service.connect({ id: 'cancel-start', host: 'host', username: 'root' } as Connection,
      { signal: controller.signal, onData: vi.fn(), onError: vi.fn(), onClose: vi.fn() })
    const rejected = expect(result).rejects.toThrow(SSH_CONNECTION_CANCELLED)
    await vi.advanceTimersByTimeAsync(0)
    const client = clients[0]
    client.emit('ready')
    controller.abort()
    await rejected
    finish({ useX11: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(client.shell).not.toHaveBeenCalled()
    expect(client.destroy).toHaveBeenCalledOnce()
    expect(sessions.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a superseded connection when display preparation finishes', async () => {
    let finish!: (result: { useX11: boolean }) => void
    x11.resolve.mockReturnValue(new Promise(resolve => { finish = resolve }))
    let epoch = 1
    const service = new ConnectionService({
      sessions: new Map(), decoders: new Map(), pendingHostKeys: new Map(), knownHosts: {} as any,
      cleanupSession: vi.fn(), bumpSessionEpoch: () => epoch, getSessionEpoch: () => epoch,
    })
    const result = service.connect({ id: 'superseded', host: 'host', username: 'root' } as Connection,
      { onData: vi.fn(), onError: vi.fn(), onClose: vi.fn() })
    const rejected = expect(result).rejects.toThrow('SSH session generation changed')
    await vi.advanceTimersByTimeAsync(0)
    const client = clients[0]
    client.emit('ready')
    epoch++
    finish({ useX11: false })
    await vi.advanceTimersByTimeAsync(0)
    await rejected
    expect(client.shell).not.toHaveBeenCalled()
    expect(client.end).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
