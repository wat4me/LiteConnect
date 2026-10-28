import { isIP } from 'node:net'
import { X11_AUTH_PROTOCOL } from './x11Auth'
import type { X11Endpoint } from './x11Endpoint'

export type SystemX11Display = { display: number; screen: number; endpoints: X11Endpoint[] }

/** DISPLAY is local process state, never taken from the remote SSH environment. */
export function parseSystemX11Display(value: string, platform: NodeJS.Platform): SystemX11Display | null {
  const display = value.trim()
  if (!display || /[\0\r\n]/.test(display)) return null
  const suffix = /:(\d+)(?:\.(\d+))?$/.exec(display)
  if (!suffix) return null
  const number = Number(suffix[1])
  const screen = Number(suffix[2] || 0)
  if (!Number.isSafeInteger(number) || number > 59535 || !Number.isSafeInteger(screen) || screen > 65535) return null
  if (platform === 'darwin' && display.startsWith('/')) {
    // launchd's socket name itself includes :0. A screen suffix is not part of
    // the socket name. Try the exact path first, as the OpenSSH client does.
    return { display: number, screen, endpoints: [...new Set([display, display.replace(/\.\d+$/, '')])].map(path => ({ path })) }
  }
  const host = display.slice(0, suffix.index)
  if (!host || host === ':' || host === 'unix' || host.endsWith('/unix') || host === 'unix/') {
    const path = `/tmp/.X11-unix/X${number}`
    return { display: number, screen, endpoints: [
      { path }, ...(platform === 'linux' ? [{ path: `\0${path}` }] : []),
    ] }
  }
  const tcpHost = host.replace(/^\[|\]$/g, '')
  // Automatic mode reuses a local display. Remote display hosts remain available
  // through explicit custom mode, without silently sending desktop credentials.
  if (tcpHost !== 'localhost' && tcpHost !== '127.0.0.1' && tcpHost !== '::1') return null
  return { display: number, screen, endpoints: [{ host: tcpHost, port: 6000 + number }] }
}

/** Reads the binary Xauthority format without invoking a shell or logging keys.
 * Only this machine's matching MIT-MAGIC-COOKIE-1 records are eligible.
 */
export function readXauthorityCookies(data: Buffer, display: number, hostname: string): Buffer[] {
  const candidates: Array<{ score: number; cookie: Buffer }> = []
  let offset = 0
  while (offset < data.length) {
    if (offset + 2 > data.length) throw new Error('Truncated Xauthority record')
    const family = data.readUInt16BE(offset)
    offset += 2
    const fields: Buffer[] = []
    for (let index = 0; index < 4; index++) {
      if (offset + 2 > data.length) throw new Error('Truncated Xauthority field')
      const length = data.readUInt16BE(offset)
      offset += 2
      if (offset + length > data.length) throw new Error('Truncated Xauthority value')
      fields.push(data.subarray(offset, offset + length))
      offset += length
    }
    const [address, number, protocol, cookie] = fields
    if (number.toString() !== String(display) || protocol.toString() !== X11_AUTH_PROTOCOL || cookie.length !== 16) continue
    const name = address.toString().toLowerCase()
    const local = hostname.toLowerCase()
    let score = 0
    if (family === 256 && name === local) score = 4 // FamilyLocal
    else if (family === 256 && name && name.split('.')[0] === local.split('.')[0]) score = 3
    else if (family === 65535) score = 1 // FamilyWild
    else if (family === 0 && address.length === 4 && address[0] === 127) score = 2
    else if (family === 6 && address.length === 16 && address.subarray(0, 15).every(byte => byte === 0) && address[15] === 1) score = 2
    // Some xauth producers write the literal loopback name in a local record.
    else if (family === 256 && (name === 'localhost' || isIP(name) && (name === '127.0.0.1' || name === '::1'))) score = 2
    if (score) candidates.push({ score, cookie: Buffer.from(cookie) })
  }
  return candidates.sort((a, b) => b.score - a.score).map(entry => entry.cookie)
}
