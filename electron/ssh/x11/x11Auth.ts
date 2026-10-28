import { Transform, type TransformCallback } from 'node:stream'
import { timingSafeEqual } from 'node:crypto'
import { Socket } from 'node:net'
import type { X11Endpoint } from './x11Endpoint'

export const X11_AUTH_PROTOCOL = 'MIT-MAGIC-COOKIE-1'
export type X11Authentication = { remoteCookie: Buffer; localCookie: Buffer }
const padded = (length: number) => (length + 3) & ~3

/** Xauthority uses network byte order, independently of the X11 client's order. */
export function buildXauthority(display: number, cookie: Buffer): Buffer {
  const fields = [Buffer.alloc(0), Buffer.from(String(display)), Buffer.from(X11_AUTH_PROTOCOL), cookie]
  const result = Buffer.alloc(2 + fields.reduce((size, field) => size + 2 + field.length, 0))
  result.writeUInt16BE(0xffff, 0) // FamilyWild, scoped by the private file/cookie
  let offset = 2
  for (const field of fields) {
    result.writeUInt16BE(field.length, offset)
    field.copy(result, offset + 2)
    offset += 2 + field.length
  }
  return result
}

export function buildAuthenticatedSetup(cookie: Buffer): Buffer {
  const protocol = Buffer.from(X11_AUTH_PROTOCOL)
  const packet = Buffer.alloc(12 + padded(protocol.length) + padded(cookie.length))
  packet[0] = 0x6c
  packet.writeUInt16LE(11, 2)
  packet.writeUInt16LE(protocol.length, 6)
  packet.writeUInt16LE(cookie.length, 8)
  protocol.copy(packet, 12)
  cookie.copy(packet, 12 + padded(protocol.length))
  return packet
}

/** Unlike a port probe, requires a successful authenticated X11 setup. */
export function probeAuthenticatedX11(host: string, port: number, cookie: Buffer, timeout = 800): Promise<boolean> {
  return probeX11Setup(host, port, buildAuthenticatedSetup(cookie), timeout)
}

export function probeAuthenticatedX11Endpoint(endpoint: X11Endpoint, cookie: Buffer, timeout = 800): Promise<boolean> {
  return probeX11SetupEndpoint(endpoint, buildAuthenticatedSetup(cookie), timeout)
}

export function probeX11Setup(host: string, port: number, setup: Buffer, timeout = 800): Promise<boolean> {
  return probeX11SetupEndpoint({ host, port }, setup, timeout)
}

export function probeX11SetupEndpoint(endpoint: X11Endpoint, setup: Buffer, timeout = 800): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new Socket()
    let finished = false
    const finish = (ok: boolean) => {
      if (finished) return
      finished = true
      clearTimeout(deadline)
      socket.destroy()
      resolve(ok)
    }
    const deadline = setTimeout(() => finish(false), timeout)
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))
    socket.once('data', data => finish(data[0] === 1))
    socket.connect(endpoint, () => socket.write(setup))
  })
}

/** Validate the SSH session cookie before substituting the private local cookie.
 * Buffers only the bounded setup prefix, handles either byte order and fragments.
 * Piping through Transform preserves backpressure for subsequent bulk traffic.
 */
export class X11CookieRewriter extends Transform {
  private pending: Buffer = Buffer.alloc(0)
  private authenticated = false
  private readonly deadline: ReturnType<typeof setTimeout>

  constructor(private readonly auth: X11Authentication) {
    super()
    this.deadline = setTimeout(() => this.destroy(new Error('X11 authorization timed out')), 5000)
    this.deadline.unref()
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
    if (this.authenticated) { done(null, chunk); return }
    // At most 48 bytes of setup plus this single incoming stream chunk.
    const packet = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk
    if (packet.length < 12) { this.pending = packet; done(); return }
    const little = packet[0] === 0x6c
    if (!little && packet[0] !== 0x42) { done(new Error('Invalid X11 byte order')); return }
    const uint16 = (offset: number) => little ? packet.readUInt16LE(offset) : packet.readUInt16BE(offset)
    const nameLength = uint16(6)
    const dataLength = uint16(8)
    if (uint16(2) !== 11 || nameLength !== X11_AUTH_PROTOCOL.length || dataLength !== this.auth.remoteCookie.length) {
      done(new Error('Invalid X11 authorization')); return
    }
    const cookieOffset = 12 + padded(nameLength)
    const size = cookieOffset + padded(dataLength)
    if (packet.length < size) { this.pending = packet; done(); return }
    if (packet.subarray(12, 12 + nameLength).toString() !== X11_AUTH_PROTOCOL
      || !timingSafeEqual(packet.subarray(cookieOffset, cookieOffset + dataLength), this.auth.remoteCookie)) {
      done(new Error('Invalid X11 cookie')); return
    }
    const output = Buffer.from(packet)
    this.auth.localCookie.copy(output, cookieOffset)
    this.authenticated = true
    this.pending = Buffer.alloc(0)
    clearTimeout(this.deadline)
    done(null, output)
  }

  override _destroy(error: Error | null, done: (error?: Error | null) => void) {
    clearTimeout(this.deadline)
    this.pending = Buffer.alloc(0)
    done(error)
  }
}
