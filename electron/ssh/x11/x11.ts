import type { Client, ClientChannel } from 'ssh2'
import * as net from 'net'
import { t } from '../../i18n'
import type { Connection, SSHCallbacks } from '../types'

export {
  buildX11ConnectionSetupPacket,
  isX11ConnectionSetupResponse,
  probeX11Port,
  probeX11PortDetailed,
} from './x11Probe'
export type { X11ProbeReason, X11ProbeResult } from './x11Probe'

export function getX11Host(connection: Connection): string {
  return connection.x11Host?.trim() || '127.0.0.1'
}

export function getX11Display(connection: Connection): number {
  return Number.isInteger(connection.x11Display) && connection.x11Display! >= 0
    ? connection.x11Display!
    : 0
}

/**
 * Whether shell() failed because the server rejected X11 forwarding on open.
 * Used to fall back to a plain PTY shell instead of failing the whole connect.
 * (Local X readiness is probed earlier; this covers remote sshd/xauth refusal.)
 */
export function isX11ShellRequestError(message: string | undefined | null): boolean {
  const msg = String(message || '')
  if (!msg) return false
  // ssh2 / OpenSSH common strings
  if (/unable to request x11/i.test(msg)) return true
  if (/x11.*forward/i.test(msg) && /fail|refus|den|unable|error/i.test(msg)) return true
  if (/\bx11\b/i.test(msg) && /channel.?fail|request.?fail|not allowed|disabled/i.test(msg)) {
    return true
  }
  // bare "… X11 …" from ssh2 Client shell callback
  if (/\bx11\b/i.test(msg)) return true
  return false
}

export function destroyX11Sockets(sockets?: Set<net.Socket>) {
  if (!sockets) return
  for (const socket of sockets) {
    try {
      socket.destroy()
    } catch {}
  }
  sockets.clear()
}

export function attachX11Forwarding(
  client: Client,
  sessionId: string,
  connection: Connection,
  callbacks: SSHCallbacks,
  x11Sockets: Set<net.Socket>,
) {
  const reportX11Error = (message: string) => {
    // A display/channel failure affects one X11 window, not the SSH shell.
    // ssh:error would make the renderer reconnect and tear down a healthy session.
    callbacks.onData(sessionId, `\r\n\x1b[33m[LiteConnect] ${message}\x1b[0m\r\n`)
  }

  client.on('x11', (_details, accept, rejectX11) => {
    if (connection.x11Forwarding !== true) {
      try {
        rejectX11()
      } catch {}
      return
    }

    let x11Channel: ClientChannel
    try {
      x11Channel = accept()
    } catch (err: any) {
      try {
        rejectX11()
      } catch {}
      reportX11Error(t('x11.channelFailed', { error: err?.message || 'failed to accept channel' }))
      return
    }

    const host = getX11Host(connection)
    const port = 6000 + getX11Display(connection)
    const localSocket = net.connect(port, host)
    // X11 exchanges many small request/reply messages; avoid Nagle delaying
    // writes to the local display server while the SSH transport uses noDelay.
    localSocket.setNoDelay(true)
    let closed = false
    let connected = false

    x11Sockets.add(localSocket)
    x11Channel.pipe(localSocket)
    localSocket.pipe(x11Channel)

    const closeBoth = () => {
      if (closed) return
      closed = true
      x11Sockets.delete(localSocket)
      try {
        localSocket.destroy()
      } catch {}
      try {
        x11Channel.close()
      } catch {}
    }

    localSocket.once('connect', () => {
      connected = true
    })
    localSocket.once('error', (err) => {
      if (!connected) {
        reportX11Error(t('x11.connectLocalFailed', { host, port, error: err.message }))
      }
      closeBoth()
    })
    localSocket.once('close', closeBoth)
    x11Channel.once('error', closeBoth)
    x11Channel.once('close', closeBoth)
  })
}
