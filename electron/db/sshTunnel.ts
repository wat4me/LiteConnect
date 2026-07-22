import { Client, type ConnectConfig } from 'ssh2'
import * as net from 'net'
import type { Connection } from '../store/credentialStore'
import { buildAuthFields } from '../ssh/auth'
import { createHostVerifier, type HostKeyRejectInfo } from '../ssh/hostKeyVerify'
import type { KnownHostsStore } from '../ssh/knownHosts'

export type DbTunnelCloseReason = 'ssh_tunnel_closed' | 'ssh_tunnel_error' | 'local_close'

export type DbTunnelHandle = {
  localHost: string
  localPort: number
  remoteHost: string
  remotePort: number
  close: () => void
  /** Fired once when the tunnel becomes unusable (SSH drop or local close). */
  onClosed?: (cb: (reason: DbTunnelCloseReason) => void) => void
}

/**
 * Open a dedicated SSH client (no shell) and forward a local ephemeral port
 * to remoteHost:remotePort via the SSH server.
 */
export async function openDbSshTunnel(
  ssh: Connection,
  remoteHost: string,
  remotePort: number,
  knownHosts: KnownHostsStore,
): Promise<DbTunnelHandle> {
  if (!remoteHost?.trim()) throw new Error('Invalid tunnel remote host')
  if (!Number.isFinite(remotePort) || remotePort < 1 || remotePort > 65535) {
    throw new Error('Invalid tunnel remote port')
  }

  await knownHosts.init()

  const client = new Client()
  let jumpClient: Client | undefined
  let server: net.Server | null = null
  const sockets = new Set<net.Socket>()
  let closed = false
  let closeReason: DbTunnelCloseReason = 'local_close'
  const closeListeners = new Set<(reason: DbTunnelCloseReason) => void>()

  const closeAll = (reason: DbTunnelCloseReason = 'local_close') => {
    if (closed) return
    closed = true
    closeReason = reason
    for (const s of sockets) {
      try {
        s.destroy()
      } catch {}
    }
    sockets.clear()
    try {
      server?.close()
    } catch {}
    server = null
    try {
      client.removeAllListeners()
    } catch {}
    try {
      client.end()
    } catch {}
    try {
      client.destroy()
    } catch {}
    try {
      jumpClient?.removeAllListeners()
    } catch {}
    try {
      jumpClient?.end()
    } catch {}
    try {
      jumpClient?.destroy()
    } catch {}
    for (const cb of closeListeners) {
      try {
        cb(closeReason)
      } catch {}
    }
    closeListeners.clear()
  }

  try {
    await connectSshClient(client, ssh, knownHosts, (jc) => {
      jumpClient = jc
    })
  } catch (err) {
    closeAll('local_close')
    throw err
  }

  // After ready: any later SSH failure tears down the tunnel
  const onRemoteDrop = (reason: DbTunnelCloseReason) => {
    closeAll(reason)
  }
  client.on('close', () => onRemoteDrop('ssh_tunnel_closed'))
  client.on('end', () => onRemoteDrop('ssh_tunnel_closed'))
  client.on('error', () => onRemoteDrop('ssh_tunnel_error'))
  if (jumpClient) {
    jumpClient.on('close', () => onRemoteDrop('ssh_tunnel_closed'))
    jumpClient.on('end', () => onRemoteDrop('ssh_tunnel_closed'))
    jumpClient.on('error', () => onRemoteDrop('ssh_tunnel_error'))
  }

  try {
    const bound = await listenEphemeralForward(client, remoteHost.trim(), remotePort, sockets)
    server = bound.server
    return {
      localHost: '127.0.0.1',
      localPort: bound.port,
      remoteHost: remoteHost.trim(),
      remotePort,
      close: () => closeAll('local_close'),
      onClosed: (cb) => {
        if (closed) {
          try {
            cb(closeReason)
          } catch {}
          return
        }
        closeListeners.add(cb)
      },
    }
  } catch (err) {
    closeAll('local_close')
    throw err
  }
}

function connectSshClient(
  client: Client,
  connection: Connection,
  knownHosts: KnownHostsStore,
  onJump: (jump: Client) => void,
): Promise<void> {
  const hasJump = !!(connection.jumpHost && connection.jumpHost.trim())

  return new Promise((resolve, reject) => {
    let settled = false
    let jumpClient: Client | undefined

    const safeResolve = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const safeReject = (err: Error) => {
      if (settled) return
      settled = true
      try {
        jumpClient?.end()
      } catch {}
      try {
        client.end()
      } catch {}
      reject(err)
    }

    let hostKeyError: string | null = null
    const onHostKeyReject = (info: HostKeyRejectInfo) => {
      hostKeyError = info.error
    }

    const targetConfig = (sock?: import('stream').Duplex): ConnectConfig => ({
      ...(sock
        ? { sock }
        : { host: connection.host, port: connection.port || 22 }),
      ...buildAuthFields({
        username: connection.username,
        password: connection.password,
        privateKey: connection.privateKey,
        useAgent: connection.useAgent,
      }),
      readyTimeout: 20_000,
      keepaliveInterval: connection.keepaliveInterval ?? 30_000,
      hostVerifier: createHostVerifier(
        knownHosts,
        connection.host,
        connection.port || 22,
        'target',
        onHostKeyReject,
      ),
    })

    const rejectWithHostKey = (err: Error) => {
      safeReject(new Error(hostKeyError || err.message))
    }

    if (!hasJump) {
      client.once('ready', () => {
        try {
          client.setNoDelay(true)
        } catch {}
        safeResolve()
      })
      client.once('error', (err) =>
        rejectWithHostKey(err instanceof Error ? err : new Error(String(err))),
      )
      client.connect(targetConfig())
      return
    }

    jumpClient = new Client()
    onJump(jumpClient)
    const jumpHost = connection.jumpHost!.trim()
    const jumpPort = connection.jumpPort || 22
    jumpClient
      .on('ready', () => {
        jumpClient!.forwardOut(
          '127.0.0.1',
          0,
          connection.host,
          connection.port || 22,
          (err, stream) => {
            if (err) {
              safeReject(new Error(`Jump host forward failed: ${err.message}`))
              return
            }
            client.once('ready', () => {
              try {
                client.setNoDelay(true)
              } catch {}
              safeResolve()
            })
            client.once('error', (e) =>
              rejectWithHostKey(e instanceof Error ? e : new Error(String(e))),
            )
            client.connect(targetConfig(stream))
          },
        )
      })
      .on('error', (err) =>
        rejectWithHostKey(err instanceof Error ? err : new Error(String(err))),
      )
      .connect({
        host: jumpHost,
        port: jumpPort,
        ...buildAuthFields({
          username: connection.jumpUsername || connection.username,
          password: connection.jumpPassword || connection.password,
          privateKey: connection.jumpPrivateKey || connection.privateKey,
          useAgent: connection.useAgent,
        }),
        readyTimeout: 20_000,
        hostVerifier: createHostVerifier(
          knownHosts,
          jumpHost,
          jumpPort,
          'jump',
          onHostKeyReject,
        ),
      })
  })
}

function listenEphemeralForward(
  client: Client,
  remoteHost: string,
  remotePort: number,
  sockets: Set<net.Socket>,
): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      client.forwardOut('127.0.0.1', 0, remoteHost, remotePort, (err, stream) => {
        if (err) {
          socket.destroy()
          return
        }
        socket.pipe(stream)
        stream.pipe(socket)
        socket.on('error', () => stream.destroy())
        stream.on('error', () => socket.destroy())
      })
    })

    server.once('error', (err) => {
      reject(err instanceof Error ? err : new Error(String(err)))
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        try {
          server.close()
        } catch {}
        reject(new Error('Failed to bind local tunnel port'))
        return
      }
      resolve({ server, port: addr.port })
    })
  })
}
