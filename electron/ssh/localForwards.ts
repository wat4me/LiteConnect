import type { Client } from 'ssh2'
import * as net from 'net'
import type { Connection, SSHCallbacks } from './types'
import { t } from '../i18n'

export type LocalForwardServer = net.Server & {
  /** Destroy accepted client sockets when session ends */
  __liteConnectSockets?: Set<net.Socket>
}

/**
 * Bind local port forwards. Success is reported only after listen succeeds
 * (listening event / callback). Port-in-use shows failure only.
 * Callers must close servers (and destroy __liteConnectSockets) on session cleanup.
 */
export function setupLocalForwards(
  client: Client,
  connection: Connection,
  sessionId: string,
  callbacks: SSHCallbacks,
): LocalForwardServer[] {
  const servers: LocalForwardServer[] = []
  const forwards = connection.localForwards || []
  for (const fwd of forwards) {
    if (!fwd || !fwd.localPort || !fwd.remoteHost || !fwd.remotePort) continue
    const sockets = new Set<net.Socket>()
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      client.forwardOut(
        '127.0.0.1',
        0,
        fwd.remoteHost,
        fwd.remotePort,
        (err, stream) => {
          if (err) {
            socket.destroy()
            return
          }
          socket.pipe(stream)
          stream.pipe(socket)
          socket.on('error', () => stream.destroy())
          stream.on('error', () => socket.destroy())
        },
      )
    }) as LocalForwardServer
    server.__liteConnectSockets = sockets

    let announcedOk = false
    server.on('error', (err) => {
      // If listen never succeeded, do not also print "ok"
      if (announcedOk) {
        callbacks.onData(
          sessionId,
          `\r\n\x1b[33m[LiteConnect] ${t('ssh.localForwardFailed', {
            localPort: fwd.localPort,
            remoteHost: fwd.remoteHost,
            remotePort: fwd.remotePort,
            error: err.message,
          })}\x1b[0m\r\n`,
        )
      }
    })

    // Register early so session cleanup can close even if still binding
    servers.push(server)

    // listen() is async: EADDRINUSE arrives via 'error' before 'listening'
    server.once('error', (err) => {
      if (announcedOk) return
      callbacks.onData(
        sessionId,
        `\r\n\x1b[33m[LiteConnect] ${t('ssh.localForwardListenFailed', {
          localPort: fwd.localPort,
          error: err.message,
        })}\x1b[0m\r\n`,
      )
      try {
        server.close()
      } catch {}
    })

    try {
      server.listen(fwd.localPort, '127.0.0.1', () => {
        announcedOk = true
        callbacks.onData(
          sessionId,
          `\r\n\x1b[32m[LiteConnect] ${t('ssh.localForwardOk', {
            localPort: fwd.localPort,
            remoteHost: fwd.remoteHost,
            remotePort: fwd.remotePort,
          })}\x1b[0m\r\n`,
        )
      })
    } catch (err: any) {
      callbacks.onData(
        sessionId,
        `\r\n\x1b[33m[LiteConnect] ${t('ssh.localForwardListenFailed', {
          localPort: fwd.localPort,
          error: err?.message || String(err),
        })}\x1b[0m\r\n`,
      )
    }
  }
  return servers
}

/** Close forward servers and destroy all accepted sockets. */
export function closeLocalForwardServers(servers: LocalForwardServer[] | undefined): void {
  if (!servers) return
  for (const server of servers) {
    const sockets = server.__liteConnectSockets
    if (sockets) {
      for (const s of sockets) {
        try {
          s.destroy()
        } catch {}
      }
      sockets.clear()
    }
    try {
      server.close()
    } catch {}
  }
}
