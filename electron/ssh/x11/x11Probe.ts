import * as net from 'net'

/**
 * Minimal X11 Connection Setup (client → server), little-endian, no auth.
 * Spec: X Window System Protocol, Connection Setup.
 */
export function buildX11ConnectionSetupPacket(): Buffer {
  const buf = Buffer.alloc(12)
  buf[0] = 0x6c // 'l' — LSB first
  buf[1] = 0 // unused
  buf.writeUInt16LE(11, 2) // protocol-major-version
  buf.writeUInt16LE(0, 4) // protocol-minor-version
  buf.writeUInt16LE(0, 6) // authorization-protocol-name length
  buf.writeUInt16LE(0, 8) // authorization-protocol-data length
  buf.writeUInt16LE(0, 10) // unused
  return buf
}

/**
 * First byte of the server's Connection Setup reply:
 * 0 = Failed, 1 = Success, 2 = Authenticate.
 * Any of these means a real X server answered (even if auth would fail later).
 */
export function isX11ConnectionSetupResponse(firstByte: number): boolean {
  return firstByte === 0 || firstByte === 1 || firstByte === 2
}

export type X11ProbeReason =
  | 'x11_ok'
  | 'refused'
  | 'timeout'
  | 'not_x11'
  | 'closed'
  | 'error'

export type X11ProbeResult = {
  /** True only when a real X11 Connection Setup reply was received. */
  ok: boolean
  /** True when TCP connect to host:port succeeded (something accepted). */
  tcpOpen: boolean
  reason: X11ProbeReason
}

/**
 * Detailed probe: distinguishes "nothing listening" from "port open but not X11".
 *
 * Manual VcXsrv exit can leave another process (or a stuck socket) on :6000 still
 * LISTENING; a plain TCP connect would false-positive as "display ready".
 */
export function probeX11PortDetailed(
  host: string,
  port: number,
  timeoutMs = 2000,
): Promise<X11ProbeResult> {
  return new Promise((resolve) => {
    let settled = false
    let tcpOpen = false
    const socket = new net.Socket()

    const done = (result: X11ProbeResult) => {
      if (settled) return
      settled = true
      try {
        socket.removeAllListeners()
        socket.destroy()
      } catch {}
      resolve(result)
    }

    socket.setTimeout(timeoutMs)

    socket.once('connect', () => {
      tcpOpen = true
      try {
        socket.write(buildX11ConnectionSetupPacket())
      } catch {
        done({ ok: false, tcpOpen: true, reason: 'error' })
      }
    })

    socket.on('data', (chunk: Buffer) => {
      if (!chunk.length) return
      if (isX11ConnectionSetupResponse(chunk[0]!)) {
        done({ ok: true, tcpOpen: true, reason: 'x11_ok' })
      } else {
        done({ ok: false, tcpOpen: true, reason: 'not_x11' })
      }
    })

    socket.once('error', (err: NodeJS.ErrnoException) => {
      const code = err?.code || ''
      if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
        done({ ok: false, tcpOpen: false, reason: 'refused' })
        return
      }
      // After connect, reset/abort → treat as open but not usable X
      if (tcpOpen) {
        done({ ok: false, tcpOpen: true, reason: 'error' })
        return
      }
      done({ ok: false, tcpOpen: false, reason: 'error' })
    })

    socket.once('timeout', () => {
      // Connected but no X reply → occupied / hung, not a working display server
      if (tcpOpen) {
        done({ ok: false, tcpOpen: true, reason: 'timeout' })
      } else {
        done({ ok: false, tcpOpen: false, reason: 'timeout' })
      }
    })

    socket.once('end', () => {
      if (!settled) {
        done({
          ok: false,
          tcpOpen,
          reason: tcpOpen ? 'closed' : 'refused',
        })
      }
    })

    socket.once('close', () => {
      if (!settled) {
        done({
          ok: false,
          tcpOpen,
          reason: tcpOpen ? 'closed' : 'refused',
        })
      }
    })

    try {
      socket.connect(port, host)
    } catch {
      done({ ok: false, tcpOpen: false, reason: 'error' })
    }
  })
}

/**
 * True only if something on host:port speaks X11 (not mere TCP accept).
 */
export function probeX11Port(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return probeX11PortDetailed(host, port, timeoutMs).then((r) => r.ok)
}
