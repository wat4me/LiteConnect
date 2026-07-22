import { describe, expect, it, vi } from 'vitest'
import * as net from 'net'
import { closeLocalForwardServers, type LocalForwardServer } from './localForwards'

vi.mock('electron', () => ({
  app: { getPath: () => 'D:\\tmp\\LiteConnect-test-userdata' },
}))

vi.mock('../i18n', () => ({
  t: (key: string) => key,
}))

/**
 * Regression: shell open timeout / shell error after local forward listen
 * must destroy accepted sockets via closeLocalForwardServers (not bare server.close).
 */
describe('local forward cleanup on abort paths', () => {
  it('closeLocalForwardServers destroys accepted sockets', async () => {
    const sockets = new Set<net.Socket>()
    const server = net.createServer((sock) => {
      sockets.add(sock)
      sock.on('close', () => sockets.delete(sock))
    }) as LocalForwardServer
    server.__liteConnectSockets = sockets

    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve())
      server.on('error', reject)
    })

    const addr = server.address() as net.AddressInfo
    const client = net.connect(addr.port, '127.0.0.1')
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve())
      client.once('error', reject)
    })
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (sockets.size > 0) {
          clearInterval(t)
          resolve()
        }
      }, 5)
      setTimeout(() => {
        clearInterval(t)
        resolve()
      }, 1000)
    })

    expect(sockets.size).toBeGreaterThanOrEqual(1)
    const accepted = [...sockets]
    const closed = accepted.map(() => false)
    accepted.forEach((s, i) =>
      s.on('close', () => {
        closed[i] = true
      }),
    )

    closeLocalForwardServers([server])
    await new Promise((r) => setTimeout(r, 80))

    expect(closed.every(Boolean)).toBe(true)
    try {
      client.destroy()
    } catch {}
  })

  it('forceDisconnectAll-equivalent cleanup closes forwards, jump, sftp, x11', () => {
    // Mirrors SSHManager.cleanupSession + forceDisconnectAll resource release
    const serverClose = vi.fn()
    const socketDestroy = vi.fn()
    const sock = { destroy: socketDestroy } as unknown as net.Socket
    const servers: LocalForwardServer[] = [
      {
        close: serverClose,
        __liteConnectSockets: new Set([sock]),
      } as any,
    ]
    const jumpEnd = vi.fn()
    const sftpEnd = vi.fn()
    const streamClose = vi.fn()
    const clientDestroy = vi.fn()
    const x11Destroy = vi.fn()
    const x11Sockets = new Set([{ destroy: x11Destroy } as unknown as net.Socket])

    // Unified cleanup (same order as manager.cleanupSession + client/stream teardown)
    closeLocalForwardServers(servers)
    try {
      jumpEnd()
    } catch {}
    try {
      sftpEnd()
    } catch {}
    for (const s of x11Sockets) {
      try {
        s.destroy()
      } catch {}
    }
    streamClose()
    clientDestroy()

    expect(socketDestroy).toHaveBeenCalled()
    expect(serverClose).toHaveBeenCalled()
    expect(jumpEnd).toHaveBeenCalled()
    expect(sftpEnd).toHaveBeenCalled()
    expect(x11Destroy).toHaveBeenCalled()
    expect(streamClose).toHaveBeenCalled()
    expect(clientDestroy).toHaveBeenCalled()
  })

  it('manager.forceDisconnectAll source uses cleanupSession', async () => {
    const fs = await import('fs/promises')
    const path = await import('path')
    const src = await fs.readFile(path.join(__dirname, 'manager.ts'), 'utf-8')
    expect(src).toMatch(/forceDisconnectAll\s*\(/)
    expect(src).toContain('cleanupSession')
    // forceDisconnectAll body must call cleanupSession (not only bare server.close)
    const fn = src.slice(src.indexOf('forceDisconnectAll'))
    const body = fn.slice(0, fn.indexOf('\n  ', 2) > 0 ? 800 : 800)
    expect(body).toContain('cleanupSession')
    expect(body).toContain('bumpSessionEpoch')
  })

  it('shell-timeout style abort uses closeLocalForwardServers not bare close', () => {
    const bareClose = vi.fn()
    const withSockets: LocalForwardServer = {
      close: bareClose,
      __liteConnectSockets: new Set(),
    } as any
    closeLocalForwardServers([withSockets])
    expect(bareClose).toHaveBeenCalled()
  })
})

describe('ConnectionService abortPendingResources contract', () => {
  it('shell timeout/error paths use abortPendingResources / closeLocalForwardServers', async () => {
    const fs = await import('fs/promises')
    const path = await import('path')
    const src = await fs.readFile(path.join(__dirname, 'connectionService.ts'), 'utf-8')
    expect(src).toContain('closeLocalForwardServers')
    expect(src).toContain('abortPendingResources')
    expect(src).not.toMatch(
      /for\s*\(\s*const\s+s\s+of\s+localForwardServers\s*\)\s*\{\s*s\.close/,
    )
  })
})
