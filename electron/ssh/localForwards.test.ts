import { afterEach, describe, expect, it, vi } from 'vitest'
import * as net from 'net'
import { closeLocalForwardServers, setupLocalForwards, type LocalForwardServer } from './localForwards'
import type { Connection, SSHCallbacks } from './types'

vi.mock('../i18n', () => ({
  t: (_key: string, params?: Record<string, unknown>) =>
    params ? JSON.stringify(params) : _key,
}))

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      if (!addr || typeof addr === 'string') {
        s.close()
        reject(new Error('no port'))
        return
      }
      const port = addr.port
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

describe('setupLocalForwards', () => {
  const serversToClose: LocalForwardServer[] = []

  afterEach(() => {
    closeLocalForwardServers(serversToClose)
    serversToClose.length = 0
  })

  it('announces success only after listening', async () => {
    const port = await freePort()
    const messages: string[] = []
    const callbacks: SSHCallbacks = {
      onData: (_sid, data) => messages.push(data),
      onClose: () => {},
      onError: () => {},
    }
    const connection = {
      id: 'c',
      host: 'h',
      port: 22,
      username: 'u',
      password: 'p',
      name: 'n',
      localForwards: [{ localPort: port, remoteHost: '10.0.0.1', remotePort: 80 }],
    } as Connection

    const fakeClient = { forwardOut: vi.fn() } as any
    const servers = setupLocalForwards(fakeClient, connection, 'sess', callbacks)
    serversToClose.push(...servers)

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 3000
      const tick = () => {
        if (messages.some((m) => m.includes('localForwardOk') || m.includes(String(port)))) {
          resolve()
          return
        }
        if (Date.now() > deadline) {
          reject(new Error(`no success message: ${messages.join('|')}`))
          return
        }
        setTimeout(tick, 20)
      }
      tick()
    })

    expect(messages.some((m) => m.includes('localForwardListenFailed'))).toBe(false)
  })

  it('port in use shows failure only (no success)', async () => {
    const port = await freePort()
    const blocker = net.createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.listen(port, '127.0.0.1', () => resolve())
      blocker.on('error', reject)
    })

    try {
      const messages: string[] = []
      const callbacks: SSHCallbacks = {
        onData: (_sid, data) => messages.push(data),
        onClose: () => {},
        onError: () => {},
      }
      const connection = {
        id: 'c',
        host: 'h',
        port: 22,
        username: 'u',
        password: 'p',
        name: 'n',
        localForwards: [{ localPort: port, remoteHost: '10.0.0.1', remotePort: 80 }],
      } as Connection

      const fakeClient = { forwardOut: vi.fn() } as any
      const servers = setupLocalForwards(fakeClient, connection, 'sess', callbacks)
      serversToClose.push(...servers)

      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 3000
        const tick = () => {
          if (messages.some((m) => m.includes('localForwardListenFailed') || m.includes('EADDRINUSE'))) {
            resolve()
            return
          }
          if (Date.now() > deadline) {
            reject(new Error(`no failure message: ${messages.join('|')}`))
            return
          }
          setTimeout(tick, 20)
        }
        tick()
      })

      expect(messages.some((m) => m.includes('localForwardOk'))).toBe(false)
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })

  it('closeLocalForwardServers destroys accepted sockets', async () => {
    const port = await freePort()
    const messages: string[] = []
    const callbacks: SSHCallbacks = {
      onData: (_sid, data) => messages.push(data),
      onClose: () => {},
      onError: () => {},
    }
    const connection = {
      id: 'c',
      host: 'h',
      port: 22,
      username: 'u',
      password: 'p',
      name: 'n',
      localForwards: [{ localPort: port, remoteHost: '10.0.0.1', remotePort: 80 }],
    } as Connection
    const fakeClient = {
      forwardOut: (_a: any, _b: any, _c: any, _d: any, cb: any) => {
        // never complete forward — socket stays open on server side
        setTimeout(() => cb(new Error('no forward')), 50)
      },
    } as any

    const servers = setupLocalForwards(fakeClient, connection, 'sess', callbacks)
    serversToClose.push(...servers)

    // Wait until listen succeeds (listen is async)
    await new Promise<void>((resolve, reject) => {
      const s = servers[0]
      if (!s) return reject(new Error('no server'))
      const onListening = () => {
        cleanup()
        resolve()
      }
      const onError = (err: Error) => {
        cleanup()
        reject(err)
      }
      const cleanup = () => {
        s.off('listening', onListening)
        s.off('error', onError)
      }
      // Already listening?
      try {
        if (typeof (s as any).listening === 'boolean' && (s as any).listening) {
          cleanup()
          resolve()
          return
        }
      } catch {}
      s.once('listening', onListening)
      s.once('error', onError)
      setTimeout(() => {
        cleanup()
        resolve() // fall through; connect will fail if not ready
      }, 500)
    })

    const client = net.connect({ host: '127.0.0.1', port })
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve())
      client.once('error', reject)
    })

    // Allow connection callback to register socket in __liteConnectSockets
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setTimeout(r, 20))

    const server = servers[0]
    expect(server.__liteConnectSockets?.size).toBeGreaterThan(0)

    closeLocalForwardServers(servers)
    serversToClose.length = 0

    await new Promise((r) => setTimeout(r, 50))
    expect(server.__liteConnectSockets?.size ?? 0).toBe(0)
    try {
      client.destroy()
    } catch {}
  })
})
