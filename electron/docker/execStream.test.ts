import { describe, expect, it, vi, afterEach } from 'vitest'
import * as net from 'net'
import {
  HijackHttpHeaderParser,
  isSuccessfulExecAttachStatus,
  mapExecAttachResponseHeaders,
  startDockerExecAttachStream,
} from './execStream'
import { DOCKER_PROXY_ERROR_HEADER } from './transport'

describe('HijackHttpHeaderParser', () => {
  it('parses headers split across arbitrary chunks and keeps remainder', () => {
    const p = new HijackHttpHeaderParser()
    const full =
      'HTTP/1.1 200 OK\r\nContent-Type: application/vnd.docker.raw-stream\r\n\r\n' +
      'prompt> '
    const mid = Math.floor(full.length / 2)
    expect(p.push(Buffer.from(full.slice(0, mid), 'utf8'))).toEqual({ complete: false })
    const r = p.push(Buffer.from(full.slice(mid), 'utf8'))
    expect(r.complete).toBe(true)
    if (!r.complete) return
    expect(r.statusCode).toBe(200)
    expect(r.remainder.toString('utf8')).toBe('prompt> ')
  })

  it('accepts 101 upgrade and preserves first TTY bytes in same chunk', () => {
    const p = new HijackHttpHeaderParser()
    const r = p.push(
      Buffer.from(
        'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n\x1b[?2004h$',
        'binary',
      ),
    )
    expect(r.complete).toBe(true)
    if (!r.complete) return
    expect(r.statusCode).toBe(101)
    expect(Buffer.from(r.remainder).toString('binary')).toBe('\x1b[?2004h$')
  })

  it('handles Chinese/emoji/ANSI split after headers as raw remainder', () => {
    const p = new HijackHttpHeaderParser()
    const text = '你好🌍\x1b[31mred\x1b[0m'
    const r = p.push(Buffer.from(`HTTP/1.1 200 OK\r\n\r\n${text}`, 'utf8'))
    expect(r.complete).toBe(true)
    if (!r.complete) return
    expect(r.remainder.toString('utf8')).toBe(text)
  })

  it('throws on malformed status line', () => {
    const p = new HijackHttpHeaderParser()
    expect(() => p.push(Buffer.from('NOTHTTP\r\n\r\n', 'utf8'))).toThrow()
  })
})

describe('mapExecAttachResponseHeaders', () => {
  it('accepts 101/2xx and maps errors without body', () => {
    expect(isSuccessfulExecAttachStatus(101)).toBe(true)
    expect(isSuccessfulExecAttachStatus(200)).toBe(true)
    expect(isSuccessfulExecAttachStatus(404)).toBe(false)
    expect(mapExecAttachResponseHeaders(200, {})).toBeNull()
    expect(mapExecAttachResponseHeaders(404, {})).toBe('container-not-found')
    expect(mapExecAttachResponseHeaders(409, {})).toBe('container-not-running')
    expect(mapExecAttachResponseHeaders(403, {})).toBe('permission-denied')
    expect(
      mapExecAttachResponseHeaders(502, {
        [DOCKER_PROXY_ERROR_HEADER.toLowerCase()]: 'proxy-closed',
      }),
    ).toBe('proxy-closed')
  })
})

describe('startDockerExecAttachStream', () => {
  let server: net.Server | null = null
  let port = 0

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) {
        resolve()
        return
      }
      server.close(() => resolve())
      server = null
    })
  })

  async function listen(): Promise<number> {
    server = net.createServer()
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
    port = (server.address() as net.AddressInfo).port
    return port
  }

  it('emits attached + first TTY bytes without multiplex frames', async () => {
    await listen()
    const ttyBytes = Buffer.from('你好🌍\x1b[31m', 'utf8')
    server!.on('connection', (sock) => {
      let buf = Buffer.alloc(0)
      sock.on('data', (c) => {
        buf = Buffer.concat([buf, c])
        if (buf.includes('\r\n\r\n')) {
          // Split header and first body across writes
          sock.write(Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: application/vnd.docker.raw-stream\r\n'))
          sock.write(Buffer.concat([Buffer.from('\r\n'), ttyBytes.subarray(0, 3)]))
          sock.write(ttyBytes.subarray(3))
        }
      })
    })

    const chunks: Buffer[] = []
    const states: string[] = []
    await new Promise<void>((resolve, reject) => {
      const handle = startDockerExecAttachStream({
        endpoint: {
          sessionId: 's1',
          generation: 1,
          localHost: '127.0.0.1',
          localPort: port,
        },
        apiPath: '/exec/a1b2c3d4e5f67890/start',
        body: JSON.stringify({ Detach: false, Tty: true }),
        isLive: () => true,
        callbacks: {
          onData: (c) => {
            chunks.push(Buffer.from(c))
            if (Buffer.concat(chunks).length >= ttyBytes.length) {
              handle.destroy('stopped')
              resolve()
            }
          },
          onState: (s) => {
            states.push(s)
          },
        },
      })
      setTimeout(() => reject(new Error('timeout')), 3000)
    })

    expect(states).toContain('connecting')
    expect(states).toContain('attached')
    expect(Buffer.concat(chunks).equals(ttyBytes)).toBe(true)
  })

  it('maps non-success without leaking body to onData', async () => {
    await listen()
    server!.on('connection', (sock) => {
      let buf = Buffer.alloc(0)
      sock.on('data', (c) => {
        buf = Buffer.concat([buf, c])
        if (buf.includes('\r\n\r\n')) {
          sock.write(
            Buffer.from(
              'HTTP/1.1 404 Not Found\r\nContent-Length: 12\r\n\r\nsecret-body!',
              'utf8',
            ),
          )
          sock.end()
        }
      })
    })

    const chunks: Buffer[] = []
    const states: Array<{ s: string; code?: string }> = []
    await new Promise<void>((resolve) => {
      startDockerExecAttachStream({
        endpoint: {
          sessionId: 's1',
          generation: 1,
          localHost: '127.0.0.1',
          localPort: port,
        },
        apiPath: '/exec/a1b2c3d4e5f67890/start',
        body: '{}',
        isLive: () => true,
        callbacks: {
          onData: (c) => chunks.push(Buffer.from(c)),
          onState: (s, code) => {
            states.push({ s, code })
            if (s === 'error') resolve()
          },
        },
      })
    })
    expect(chunks.length).toBe(0)
    expect(states.some((x) => x.s === 'error' && x.code === 'container-not-found')).toBe(true)
  })

  it('rejects disallowed path before connect', () => {
    expect(() =>
      startDockerExecAttachStream({
        endpoint: {
          sessionId: 's1',
          generation: 1,
          localHost: '127.0.0.1',
          localPort: 9,
        },
        apiPath: '/containers/x/kill',
        body: '{}',
        isLive: () => true,
        callbacks: { onData: () => {}, onState: () => {} },
      }),
    ).toThrow()
  })
})
