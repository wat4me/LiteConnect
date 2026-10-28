import { EventEmitter, once } from 'node:events'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duplex, PassThrough } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { attachX11Forwarding, destroyX11Sockets } from './x11'
import { buildAuthenticatedSetup, probeAuthenticatedX11Endpoint } from './x11Auth'
import type { Socket } from 'node:net'
import type { Client, ClientChannel } from 'ssh2'
import type { Connection, SSHCallbacks } from '../types'

it('authenticates and rewrites a fragmented X11 channel through a real local IPC socket', async () => {
  const slash = String.fromCharCode(92)
  // Named pipes let Windows CI exercise the same net.connect({path}) stream
  // path as Unix-domain sockets, without claiming a macOS/Linux desktop test.
  const path = process.platform === 'win32'
    ? [slash, '.', 'pipe', 'liteconnect-x11-' + randomUUID()].join(slash)
    : join(tmpdir(), 'lc-x11-' + randomUUID().slice(0, 8))
  const auth = { remoteCookie: randomBytes(16), localCookie: randomBytes(16) }
  const localConnections = new Set<Socket>()
  const packets: Buffer[] = []
  const server = createServer(socket => {
    localConnections.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => localConnections.delete(socket))
    let data = Buffer.alloc(0)
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk])
      if (data.length < 48) return
      packets.push(data)
      socket.write(Buffer.from([data.subarray(32, 48).equals(auth.localCookie) ? 1 : 0, 0, 11, 0, 0, 0, 0, 0]))
    })
  })
  server.listen(path)
  await once(server, 'listening')
  const upstream = new PassThrough()
  const downstream = new PassThrough()
  const channel = Duplex.from({ readable: upstream, writable: downstream }) as ClientChannel
  channel.close = () => { channel.destroy(); return channel }
  const sockets = new Set<Socket>()
  try {
    expect(await probeAuthenticatedX11Endpoint({ path }, auth.localCookie)).toBe(true)
    expect(await probeAuthenticatedX11Endpoint({ path }, randomBytes(16))).toBe(false)
    const client = new EventEmitter()
    const callbacks = { onData: vi.fn(), onError: vi.fn(), onClose: vi.fn() } as SSHCallbacks
    attachX11Forwarding(client as Client, 'fixture', { x11Forwarding: true } as Connection, callbacks, sockets, auth, { path })
    client.emit('x11', {}, () => channel, vi.fn())
    const reply = once(downstream, 'data')
    const setup = buildAuthenticatedSetup(auth.remoteCookie)
    upstream.write(setup.subarray(0, 7))
    upstream.write(setup.subarray(7))
    expect((await reply)[0][0]).toBe(1)
    expect(packets.at(-1)!.subarray(32, 48)).toEqual(auth.localCookie)
    expect(callbacks.onError).not.toHaveBeenCalled()
  } finally {
    destroyX11Sockets(sockets)
    channel.destroy(); upstream.destroy(); downstream.destroy()
    for (const socket of localConnections) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
