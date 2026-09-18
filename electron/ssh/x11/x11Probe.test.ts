import * as net from 'net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildX11ConnectionSetupPacket,
  isX11ConnectionSetupResponse,
  probeX11Port,
  probeX11PortDetailed,
} from './x11Probe'

describe('X11 connection setup packet', () => {
  it('is 12-byte little-endian no-auth setup', () => {
    const p = buildX11ConnectionSetupPacket()
    expect(p.length).toBe(12)
    expect(p[0]).toBe(0x6c)
    expect(p.readUInt16LE(2)).toBe(11)
    expect(p.readUInt16LE(4)).toBe(0)
    expect(p.readUInt16LE(6)).toBe(0)
    expect(p.readUInt16LE(8)).toBe(0)
  })
})

describe('isX11ConnectionSetupResponse', () => {
  it('accepts Failed / Success / Authenticate', () => {
    expect(isX11ConnectionSetupResponse(0)).toBe(true)
    expect(isX11ConnectionSetupResponse(1)).toBe(true)
    expect(isX11ConnectionSetupResponse(2)).toBe(true)
  })

  it('rejects other first bytes', () => {
    expect(isX11ConnectionSetupResponse(3)).toBe(false)
    expect(isX11ConnectionSetupResponse(0x48)).toBe(false)
  })
})

describe('probeX11Port', () => {
  const servers: net.Server[] = []
  const sockets: net.Socket[] = []

  afterEach(async () => {
    for (const s of sockets.splice(0)) {
      try {
        s.destroy()
      } catch {}
    }
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve())
            // Ensure close cannot hang if a stray connection remains
            setTimeout(() => resolve(), 200).unref?.()
          }),
      ),
    )
  })

  function listen(handler: (socket: net.Socket) => void): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        sockets.push(socket)
        handler(socket)
      })
      servers.push(server)
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (!addr || typeof addr === 'string') {
          reject(new Error('no port'))
          return
        }
        resolve(addr.port)
      })
    })
  }

  it('returns false when nothing is listening', async () => {
    // Bind then close to pick a free port that will refuse connect
    const port = await new Promise<number>((resolve, reject) => {
      const s = net.createServer()
      s.once('error', reject)
      s.listen(0, '127.0.0.1', () => {
        const addr = s.address()
        if (!addr || typeof addr === 'string') {
          reject(new Error('no port'))
          return
        }
        const p = addr.port
        s.close(() => resolve(p))
      })
    })
    await expect(probeX11Port('127.0.0.1', port, 400)).resolves.toBe(false)
  })

  it('returns false when TCP accepts but peer is not X11', async () => {
    const port = await listen((socket) => {
      // Accept then send HTTP-like garbage
      socket.write('HTTP/1.1 200 OK\r\n\r\n')
    })
    await expect(probeX11Port('127.0.0.1', port, 800)).resolves.toBe(false)
    const detailed = await probeX11PortDetailed('127.0.0.1', port, 800)
    expect(detailed).toMatchObject({ ok: false, tcpOpen: true, reason: 'not_x11' })
  })

  it('returns false when TCP accepts but never replies', async () => {
    const port = await listen((_socket) => {
      // accept only, no data
    })
    await expect(probeX11Port('127.0.0.1', port, 400)).resolves.toBe(false)
    const detailed = await probeX11PortDetailed('127.0.0.1', port, 400)
    expect(detailed.ok).toBe(false)
    expect(detailed.tcpOpen).toBe(true)
    expect(['timeout', 'closed', 'error']).toContain(detailed.reason)
  })

  it('returns true when peer replies with X11 Success', async () => {
    const port = await listen((socket) => {
      socket.once('data', () => {
        // Success reply prefix (only first byte is checked)
        const reply = Buffer.alloc(8, 0)
        reply[0] = 1
        socket.write(reply)
      })
    })
    await expect(probeX11Port('127.0.0.1', port, 800)).resolves.toBe(true)
  })

  it('returns true when peer replies with X11 Failed (still an X server)', async () => {
    const port = await listen((socket) => {
      socket.once('data', () => {
        const reply = Buffer.from([0, 0, 0, 0])
        socket.write(reply)
      })
    })
    await expect(probeX11Port('127.0.0.1', port, 800)).resolves.toBe(true)
  })
})
