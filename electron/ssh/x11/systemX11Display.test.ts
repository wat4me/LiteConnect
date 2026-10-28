import { describe, expect, it } from 'vitest'
import { buildXauthority } from './x11Auth'
import { parseSystemX11Display, readXauthorityCookies } from './systemX11Display'

const cookie = Buffer.alloc(16, 7)
function record(family: number, address: Buffer, display = '1', protocol = 'MIT-MAGIC-COOKIE-1', data = cookie) {
  const parts = [Buffer.from([family >> 8, family & 255])]
  for (const field of [address, Buffer.from(display), Buffer.from(protocol), data]) {
    const size = Buffer.alloc(2); size.writeUInt16BE(field.length)
    parts.push(size, field)
  }
  return Buffer.concat(parts)
}

describe('local desktop DISPLAY parsing', () => {
  it.each([':1', ':1.2', 'unix:1', 'unix/:1', 'workstation/unix:1', '::1'])('uses local Linux sockets for %s', value => {
    const result = parseSystemX11Display(value, 'linux')!
    expect(result.display).toBe(1)
    expect(result.endpoints).toEqual([{ path: '/tmp/.X11-unix/X1' }, { path: '\0/tmp/.X11-unix/X1' }])
  })
  it('preserves the screen number and handles launchd socket paths including :0', () => {
    expect(parseSystemX11Display('/private/tmp/com.apple.launchd.test/org.xquartz:0.1', 'darwin')).toEqual({
      display: 0, screen: 1, endpoints: [
        { path: '/private/tmp/com.apple.launchd.test/org.xquartz:0.1' },
        { path: '/private/tmp/com.apple.launchd.test/org.xquartz:0' },
      ],
    })
  })
  it.each(['localhost:10.0', '127.0.0.1:10', '[::1]:10.0'])('handles local TCP display %s', value => {
    expect(parseSystemX11Display(value, 'linux')!.endpoints[0]).toMatchObject({ port: 6010 })
  })
  it.each(['', '192.0.2.1:0', ':65535', ':0\nmalicious', 'bad', '/tmp/:0'])('rejects an unsupported Linux display %j', value => {
    expect(parseSystemX11Display(value, 'linux')).toBeNull()
  })
})

describe('system display cookie selection', () => {
  it('matches the host, display, protocol and cookie length rather than picking the first entry', () => {
    const bytes = Buffer.concat([
      record(256, Buffer.from('other-machine')),
      record(256, Buffer.from('desktop'), '0'),
      record(256, Buffer.from('desktop'), '1', 'OTHER'),
      record(256, Buffer.from('desktop'), '1', undefined, Buffer.alloc(32)),
      record(256, Buffer.from('desktop')),
    ])
    expect(readXauthorityCookies(bytes, 1, 'desktop')).toEqual([cookie])
  })
  it('supports local FQDNs, loopback families and wildcard records', () => {
    const bytes = Buffer.concat([
      buildXauthority(1, cookie), record(0, Buffer.from([127, 0, 0, 1])),
      record(6, Buffer.from('00000000000000000000000000000001', 'hex')),
      record(256, Buffer.from('desktop.example')),
    ])
    expect(readXauthorityCookies(bytes, 1, 'desktop')).toHaveLength(4)
  })
  it.each([Buffer.from([255]), Buffer.from([255, 255, 0, 5, 1]), Buffer.from([255, 255, 0])])('rejects a truncated authority record', bytes => {
    expect(() => readXauthorityCookies(bytes, 1, 'desktop')).toThrow('Truncated')
  })
})
