import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildAuthenticatedSetup, buildXauthority, X11CookieRewriter } from './x11Auth'

const auth = { remoteCookie: randomBytes(16), localCookie: randomBytes(16) }

describe('X11 session authentication', () => {
  it.each(['little', 'big'])('validates fragmented %s endian setup and preserves pipelined requests', async endian => {
    const input = buildAuthenticatedSetup(auth.remoteCookie)
    const expected = buildAuthenticatedSetup(auth.localCookie)
    if (endian === 'big') {
      for (const packet of [input, expected]) {
        packet[0] = 0x42
        for (let offset = 2; offset < 12; offset += 2) packet.writeUInt16BE(packet.readUInt16LE(offset), offset)
      }
    }
    const stream = new X11CookieRewriter(auth)
    const output: Buffer[] = []
    stream.on('data', chunk => output.push(chunk))
    const finished = once(stream, 'end')
    for (const byte of input) stream.write(Buffer.from([byte]))
    const requests = randomBytes(256 * 1024)
    stream.end(requests)
    await finished
    expect(Buffer.concat(output).equals(Buffer.concat([expected, requests]))).toBe(true)
  })

  it.each(['cookie', 'length', 'byteOrder', 'protocol'])('rejects invalid %s before forwarding setup', async failure => {
    const packet = buildAuthenticatedSetup(auth.remoteCookie)
    if (failure === 'cookie') packet[32] ^= 0xff
    if (failure === 'length') packet.writeUInt16LE(65535, 6)
    if (failure === 'byteOrder') packet[0] = 0
    if (failure === 'protocol') packet[12] = 0
    const stream = new X11CookieRewriter(auth)
    const output: Buffer[] = []
    stream.on('data', chunk => output.push(chunk))
    const error = once(stream, 'error')
    stream.end(packet)
    expect((await error)[0]).toBeInstanceOf(Error)
    expect(output).toHaveLength(0)
  })

  it('writes an interoperable network-order Xauthority record', () => {
    const record = buildXauthority(51, auth.localCookie)
    expect(record.readUInt16BE(0)).toBe(65535)
    let offset = 2
    const fields: Buffer[] = []
    while (offset < record.length) {
      const size = record.readUInt16BE(offset)
      fields.push(record.subarray(offset + 2, offset + 2 + size))
      offset += 2 + size
    }
    expect(fields.map(field => field.toString())).toEqual(['', '51', 'MIT-MAGIC-COOKIE-1', auth.localCookie.toString()])
  })
})
