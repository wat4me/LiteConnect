import type { Client } from 'ssh2'
import * as net from 'net'
import type { Connection, SSHCallbacks } from './types'
import { t } from '../i18n'

export type RemoteForwardHandle = {
  remoteHost: string
  remotePort: number
  close: () => void
}

export function setupRemoteForwards(
  client: Client,
  connection: Connection,
  sessionId: string,
  callbacks: SSHCallbacks,
): RemoteForwardHandle[] {
  const handles: RemoteForwardHandle[] = []
  const list = connection.remoteForwards || []

  const onTcp = (
    details: { destIP?: string; destPort?: number; srcIP?: string; srcPort?: number },
    accept: () => import('stream').Duplex,
    reject: () => void,
  ) => {
    const match = list.find(
      (f) => f && f.remotePort === details.destPort,
    )
    if (!match) {
      reject()
      return
    }
    const localHost = match.localHost || '127.0.0.1'
    const sock = net.connect(match.localPort, localHost)
    sock.once('error', () => {
      try {
        reject()
      } catch {}
    })
    sock.once('connect', () => {
      let stream: import('stream').Duplex
      try {
        stream = accept()
      } catch {
        sock.destroy()
        return
      }
      sock.pipe(stream)
      stream.pipe(sock)
      sock.on('error', () => {
        try {
          ;(stream as any).destroy?.()
        } catch {}
      })
      stream.on('error', () => sock.destroy())
    })
  }

  if (list.length > 0) {
    client.on('tcp connection', onTcp)
  }

  for (const fwd of list) {
    if (!fwd || !fwd.remotePort || !fwd.localPort) continue
    const remoteHost = fwd.remoteHost?.trim() || '127.0.0.1'
    client.forwardIn(remoteHost, fwd.remotePort, (err) => {
      if (err) {
        callbacks.onData(
          sessionId,
          `\r\n\x1b[33m[LiteConnect] ${t('ssh.remoteForwardFailed', {
            remoteHost,
            remotePort: fwd.remotePort,
            localHost: fwd.localHost || '127.0.0.1',
            localPort: fwd.localPort,
            error: err.message,
          })}\x1b[0m\r\n`,
        )
        return
      }
      callbacks.onData(
        sessionId,
        `\r\n\x1b[32m[LiteConnect] ${t('ssh.remoteForwardOk', {
          remoteHost,
          remotePort: fwd.remotePort,
          localHost: fwd.localHost || '127.0.0.1',
          localPort: fwd.localPort,
        })}\x1b[0m\r\n`,
      )
    })
    handles.push({
      remoteHost,
      remotePort: fwd.remotePort,
      close: () => {
        try {
          client.unforwardIn(remoteHost, fwd.remotePort, () => {})
        } catch {}
      },
    })
  }

  return handles
}

export function closeRemoteForwards(handles: RemoteForwardHandle[] | undefined): void {
  if (!handles) return
  for (const h of handles) {
    try {
      h.close()
    } catch {}
  }
}
