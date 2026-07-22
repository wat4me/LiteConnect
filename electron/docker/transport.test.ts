import { afterEach, describe, expect, it, vi } from 'vitest'
import * as net from 'net'
import { Duplex } from 'stream'
import { DockerSocketTransport, dockerHttpRequest } from './transport'
import { DockerTransportError, type StreamLocalChannelOpener } from './types'
import { DockerService } from './service'
import { startDockerLogHttpStream } from './logStream'

type FakeOpenerState = {
  sessions: Set<string>
  generation: Map<string, number>
  openImpl: (
    sessionId: string,
    path: string,
    generation: number,
  ) => Promise<NodeJS.ReadWriteStream>
  hooks: Set<(sessionId: string) => void>
}

function createFakeOpener(state?: Partial<FakeOpenerState>): {
  opener: StreamLocalChannelOpener
  state: FakeOpenerState
  teardown: (sessionId: string) => void
} {
  const st: FakeOpenerState = {
    sessions: new Set(['sess-a']),
    generation: new Map([['sess-a', 1]]),
    openImpl: async () => {
      throw new Error('openImpl not set')
    },
    hooks: new Set(),
    ...state,
  }
  const opener: StreamLocalChannelOpener = {
    hasSession: (id) => st.sessions.has(id),
    getSessionGeneration: (id) => st.generation.get(id) || 0,
    openStreamLocal: (id, path, gen) => st.openImpl(id, path, gen),
    registerSessionTeardownHook: (hook) => {
      st.hooks.add(hook)
      return () => st.hooks.delete(hook)
    },
  }
  return {
    opener,
    state: st,
    teardown: (sessionId: string) => {
      for (const h of st.hooks) h(sessionId)
    },
  }
}

/** Minimal duplex that answers HTTP once (simulates docker.sock over StreamLocal). */
function httpAnswerStream(handler: (reqHead: string) => { status: number; body: string }) {
  let buf = Buffer.alloc(0)
  let answered = false
  const duplex = new Duplex({
    read() {},
    write(chunk, _enc, cb) {
      if (answered) {
        cb()
        return
      }
      buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
      const sep = buf.indexOf('\r\n\r\n')
      if (sep < 0) {
        cb()
        return
      }
      answered = true
      const head = buf.subarray(0, sep).toString('utf8')
      const res = handler(head)
      const body = res.body
      const payload =
        `HTTP/1.1 ${res.status} OK\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        `Connection: close\r\n` +
        `\r\n` +
        body
      this.push(Buffer.from(payload))
      this.push(null)
      cb()
    },
  }) as Duplex & { destroy: (err?: Error) => Duplex }
  return duplex
}

/** nc-like duplex: emits a framed response but deliberately keeps stdout open. */
function openEndedNcHttpStream(
  handler: (request: Buffer) => { status: number; body: Buffer; contentType?: string },
) {
  let request = Buffer.alloc(0)
  let finalCalled = false
  let answered = false
  const duplex = new Duplex({
    read() {},
    write(chunk, _enc, cb) {
      request = Buffer.concat([request, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
      const separator = request.indexOf('\r\n\r\n')
      if (!answered && separator >= 0) {
        const head = request.subarray(0, separator).toString('latin1')
        const match = /(?:^|\r\n)content-length:\s*(\d+)/i.exec(head)
        const contentLength = match ? Number(match[1]) : 0
        if (request.length >= separator + 4 + contentLength) {
          answered = true
          const res = handler(request)
          const responseHead =
            `HTTP/1.1 ${res.status} OK\r\n` +
            `Content-Length: ${res.body.length}\r\n` +
            `Content-Type: ${res.contentType || 'application/json'}\r\n` +
            `Connection: close\r\n` +
            `\r\n`
          this.push(Buffer.concat([Buffer.from(responseHead), res.body]))
          // Intentionally no push(null): real nc may keep stdout open.
        }
      }
      cb()
    },
    final(cb) {
      finalCalled = true
      cb()
    },
  })
  return Object.assign(duplex, {
    wasFinalCalled: () => finalCalled,
  })
}

function trackableStream(): NodeJS.ReadWriteStream & { destroyedFlag: boolean } {
  const s = new Duplex({
    read() {},
    write(_c, _e, cb) {
      cb()
    },
  }) as Duplex & { destroyedFlag: boolean }
  s.destroyedFlag = false
  const orig = s.destroy.bind(s)
  s.destroy = ((err?: Error) => {
    s.destroyedFlag = true
    return orig(err)
  }) as typeof s.destroy
  return s as NodeJS.ReadWriteStream & { destroyedFlag: boolean }
}

describe('DockerSocketTransport', () => {
  const transports: DockerSocketTransport[] = []

  afterEach(() => {
    for (const t of transports) {
      try {
        t.closeAll()
      } catch {}
    }
    transports.length = 0
  })

  it('returns ready only after listen succeeds and binds 127.0.0.1', async () => {
    const { opener } = createFakeOpener({
      openImpl: async () => httpAnswerStream(() => ({ status: 200, body: 'OK' })),
    })
    const transport = new DockerSocketTransport(opener)
    transports.push(transport)

    const endpoint = await transport.ensureProxy('sess-a')
    expect(endpoint.localHost).toBe('127.0.0.1')
    expect(endpoint.localPort).toBeGreaterThan(0)
    expect(endpoint.generation).toBe(1)
    expect(transport.isProxyListening('sess-a')).toBe(true)

    // Port must not be listening on 0.0.0.0 鈥?verify we can connect via 127.0.0.1 only
    await new Promise<void>((resolve, reject) => {
      const c = net.connect({ host: '127.0.0.1', port: endpoint.localPort }, () => {
        c.end()
        resolve()
      })
      c.on('error', reject)
    })
  })

  it('dedupes concurrent ensureProxy for the same session', async () => {
    const { opener } = createFakeOpener({
      openImpl: async () => httpAnswerStream(() => ({ status: 200, body: 'OK' })),
    })
    const transport = new DockerSocketTransport(opener)
    transports.push(transport)

    const results = await Promise.all([
      transport.ensureProxy('sess-a'),
      transport.ensureProxy('sess-a'),
      transport.ensureProxy('sess-a'),
    ])
    expect(results[0].localPort).toBe(results[1].localPort)
    expect(results[1].localPort).toBe(results[2].localPort)
    expect(results[0].generation).toBe(1)
  })

  it('closeSession is idempotent and destroys accepted sockets and remote streams', async () => {
    const remote = trackableStream()
    const { opener } = createFakeOpener({
      openImpl: async () => remote,
    })
    const transport = new DockerSocketTransport(opener)
    transports.push(transport)

    const endpoint = await transport.ensureProxy('sess-a')
    const client = net.connect({ host: '127.0.0.1', port: endpoint.localPort })
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve())
      client.once('error', reject)
    })
    await waitFor(() => transport.getActiveStreamCount('sess-a') === 1)

    let clientClosed = false
    client.on('close', () => {
      clientClosed = true
    })

    transport.closeSession('sess-a')
    transport.closeSession('sess-a')
    transport.closeSession('sess-a')

    await new Promise((r) => setTimeout(r, 80))
    expect(transport.getActiveEndpoint('sess-a')).toBeNull()
    expect(transport.getActiveStreamCount('sess-a')).toBe(0)
    expect(remote.destroyedFlag).toBe(true)
    expect(clientClosed).toBe(true)
  })

  it('SSH teardown hook closes proxy server, sockets, and remote StreamLocal streams', async () => {
    const remote = trackableStream()
    const { opener, teardown } = createFakeOpener({
      openImpl: async () => remote,
    })
    const transport = new DockerSocketTransport(opener)
    transports.push(transport)

    const endpoint = await transport.ensureProxy('sess-a')
    expect(transport.isProxyListening('sess-a')).toBe(true)

    const client = net.connect({ host: '127.0.0.1', port: endpoint.localPort })
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve())
      client.once('error', reject)
    })
    await waitFor(() => transport.getActiveStreamCount('sess-a') === 1)

    teardown('sess-a')
    await new Promise((r) => setTimeout(r, 50))

    expect(transport.getActiveEndpoint('sess-a')).toBeNull()
    expect(transport.getActiveStreamCount('sess-a')).toBe(0)
    expect(remote.destroyedFlag).toBe(true)
    // New connections must fail
    await expect(
      new Promise<void>((resolve, reject) => {
        const c = net.connect({ host: '127.0.0.1', port: endpoint.localPort })
        c.once('connect', () => {
          c.destroy()
          reject(new Error('should not connect'))
        })
        c.once('error', () => resolve())
      }),
    ).resolves.toBeUndefined()
    try {
      client.destroy()
    } catch {}
  })

  it('local client abort destroys paired remote StreamLocal stream', async () => {
    const remote = trackableStream()
    const { opener } = createFakeOpener({
      openImpl: async () => remote,
    })
    const transport = new DockerSocketTransport(opener)
    transports.push(transport)

    const endpoint = await transport.ensureProxy('sess-a')
    const client = net.connect({ host: '127.0.0.1', port: endpoint.localPort })
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve())
      client.once('error', reject)
    })
    await waitFor(() => transport.getActiveStreamCount('sess-a') === 1)

    client.destroy()
    await waitFor(() => remote.destroyedFlag === true)
    await waitFor(() => transport.getActiveStreamCount('sess-a') === 0)
    expect(remote.destroyedFlag).toBe(true)
    expect(transport.getActiveStreamCount('sess-a')).toBe(0)
  })

  it('late ensure after generation bump does not resurrect closed transport', async () => {
    const { opener, state } = createFakeOpener({
      openImpl: async () => httpAnswerStream(() => ({ status: 200, body: 'OK' })),
    })
    const transport = new DockerSocketTransport(opener)
    transports.push(transport)

    const first = await transport.ensureProxy('sess-a')
    expect(first.generation).toBe(1)

    // Simulate reconnect: bump generation, remove old session briefly then re-add
    transport.closeSession('sess-a')
    state.generation.set('sess-a', 2)

    // Stale generation openStreamLocal would be rejected by real manager; here ensure uses gen 2
    const second = await transport.ensureProxy('sess-a')
    expect(second.generation).toBe(2)
    expect(second.localPort).not.toBe(first.localPort)

    // Old endpoint must not work
    await expect(
      dockerHttpRequest(
        { ...first, generation: 1 },
        'GET',
        '/_ping',
        { timeoutMs: 500 },
      ),
    ).rejects.toBeTruthy()
  })

  it('ensureProxy rejects when SSH session missing', async () => {
    const { opener } = createFakeOpener({
      sessions: new Set(),
      generation: new Map(),
    })
    const transport = new DockerSocketTransport(opener)
    transports.push(transport)

    await expect(transport.ensureProxy('gone')).rejects.toMatchObject({
      code: 'ssh-disconnected',
    })
  })

  it('closeAll is idempotent', async () => {
    const { opener } = createFakeOpener({
      openImpl: async () => httpAnswerStream(() => ({ status: 200, body: 'OK' })),
    })
    const transport = new DockerSocketTransport(opener)
    transports.push(transport)
    await transport.ensureProxy('sess-a')
    transport.closeAll()
    transport.closeAll()
    expect(transport.getActiveEndpoint('sess-a')).toBeNull()
    await expect(transport.ensureProxy('sess-a')).rejects.toMatchObject({
      code: 'proxy-closed',
    })
  })

  it('drops late StreamLocal open when generation becomes stale', async () => {
    const { opener, state } = createFakeOpener()
    let resolveOpen: (s: NodeJS.ReadWriteStream) => void = () => {}
    state.openImpl = () =>
      new Promise((resolve) => {
        resolveOpen = resolve
      })

    const transport = new DockerSocketTransport(opener)
    transports.push(transport)
    const endpoint = await transport.ensureProxy('sess-a')

    const client = net.connect({ host: '127.0.0.1', port: endpoint.localPort })
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve())
      client.once('error', reject)
    })
    // Allow accept handler to register openStreamLocal promise
    await new Promise((r) => setTimeout(r, 20))

    // Bump generation before late open completes
    state.generation.set('sess-a', 99)
    const late = trackableStream()

    resolveOpen(late)
    await new Promise((r) => setTimeout(r, 40))
    expect(late.destroyedFlag).toBe(true)
    try {
      client.destroy()
    } catch {}
  })

  it('openDockerSocketChannel path: /_ping HTTP bytes round-trip over exec-nc fake', async () => {
    const openDocker = vi.fn(async () =>
      httpAnswerStream((head) => {
        expect(head.startsWith('GET /_ping')).toBe(true)
        return { status: 200, body: 'OK' }
      }),
    )
    const { opener } = createFakeOpener({
      openImpl: async () => {
        throw new Error('should use openDockerSocketChannel')
      },
    })
    ;(opener as any).openDockerSocketChannel = openDocker

    const transport = new DockerSocketTransport(opener)
    transports.push(transport)
    const endpoint = await transport.ensureProxy('sess-a')
    const res = await dockerHttpRequest(endpoint, 'GET', '/_ping', { timeoutMs: 3000 })
    expect(res.statusCode).toBe(200)
    expect(res.body.toString('utf8')).toBe('OK')
    expect(openDocker).toHaveBeenCalled()
  })

  it('completes a framed GET response even when nc stdout stays open', async () => {
    let remote: ReturnType<typeof openEndedNcHttpStream> | null = null
    const { opener } = createFakeOpener()
    ;(opener as any).openDockerSocketChannel = async () => {
      remote = openEndedNcHttpStream((request) => {
        expect(request.toString('utf8')).toContain('GET /_ping HTTP/1.1\r\n')
        return { status: 200, body: Buffer.from('OK') }
      })
      return remote
    }
    const transport = new DockerSocketTransport(opener)
    transports.push(transport)
    const endpoint = await transport.ensureProxy('sess-a')

    const response = await dockerHttpRequest(endpoint, 'GET', '/_ping', { timeoutMs: 2000 })

    expect(remote?.wasFinalCalled()).toBe(false)
    expect(response.statusCode).toBe(200)
    expect(response.body.toString('utf8')).toBe('OK')
  })

  it('sends the complete POST body and completes without nc stdout EOF', async () => {
    const body = '{"reason":"test"}'
    let received = Buffer.alloc(0)
    const { opener } = createFakeOpener()
    ;(opener as any).openDockerSocketChannel = async () =>
      openEndedNcHttpStream((request) => {
        received = request
        return { status: 204, body: Buffer.alloc(0) }
      })
    const transport = new DockerSocketTransport(opener)
    transports.push(transport)
    const endpoint = await transport.ensureProxy('sess-a')

    const response = await dockerHttpRequest(endpoint, 'POST', '/containers/abc/start', {
      body,
      headers: { 'Content-Type': 'application/json' },
      timeoutMs: 2000,
    })

    expect(received.toString('utf8')).toContain(`Content-Length: ${Buffer.byteLength(body)}\r\n`)
    expect(received.subarray(-Buffer.byteLength(body)).toString('utf8')).toBe(body)
    expect(response.statusCode).toBe(204)
  })

  it('finishes a content-length log response even when nc stdout stays open', async () => {
    const states: string[] = []
    const { opener } = createFakeOpener()
    ;(opener as any).openDockerSocketChannel = async () =>
      openEndedNcHttpStream((request) => {
        expect(request.toString('utf8')).toContain(
          'GET /containers/abc/logs?stdout=1&stderr=1&timestamps=0&tail=200&follow=1 HTTP/1.1',
        )
        return {
          status: 200,
          body: Buffer.alloc(0),
          contentType: 'application/vnd.docker.raw-stream',
        }
      })
    const transport = new DockerSocketTransport(opener)
    transports.push(transport)
    const endpoint = await transport.ensureProxy('sess-a')

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('log stream did not end')), 2000)
      startDockerLogHttpStream({
        endpoint,
        apiPath: '/containers/abc/logs?stdout=1&stderr=1&timestamps=0&tail=200&follow=1',
        tty: false,
        isLive: () => true,
        callbacks: {
          onEntries: () => {},
          onState: (state) => {
            states.push(state)
            if (state === 'ended') {
              clearTimeout(timer)
              resolve()
            } else if (state === 'error') {
              clearTimeout(timer)
              reject(new Error('log stream errored'))
            }
          },
        },
      })
    })

    expect(states).toEqual(['connecting', 'streaming', 'ended'])
  })

  it('two accepted sockets create two independent remote channels; close A does not destroy B', async () => {
    const remotes: Array<NodeJS.ReadWriteStream & { destroyedFlag: boolean }> = []
    const openDocker = vi.fn(async () => {
      const r = trackableStream()
      remotes.push(r)
      return r
    })
    const { opener } = createFakeOpener()
    ;(opener as any).openDockerSocketChannel = openDocker

    const transport = new DockerSocketTransport(opener)
    transports.push(transport)
    const endpoint = await transport.ensureProxy('sess-a')

    const a = net.connect({ host: '127.0.0.1', port: endpoint.localPort })
    const b = net.connect({ host: '127.0.0.1', port: endpoint.localPort })
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        a.once('connect', () => resolve())
        a.once('error', reject)
      }),
      new Promise<void>((resolve, reject) => {
        b.once('connect', () => resolve())
        b.once('error', reject)
      }),
    ])
    await waitFor(() => remotes.length === 2 && transport.getActiveStreamCount('sess-a') === 2)

    a.destroy()
    await waitFor(() => remotes[0].destroyedFlag === true)
    expect(remotes[1].destroyedFlag).toBe(false)
    expect(transport.getActiveStreamCount('sess-a')).toBe(1)

    b.destroy()
    await waitFor(() => remotes[1].destroyedFlag === true)
    expect(transport.getActiveStreamCount('sess-a')).toBe(0)
  })

  it('closeSession destroys all remote channels for that session only', async () => {
    const remotesA: Array<NodeJS.ReadWriteStream & { destroyedFlag: boolean }> = []
    const remotesB: Array<NodeJS.ReadWriteStream & { destroyedFlag: boolean }> = []
    const { opener, state } = createFakeOpener()
    state.sessions.add('sess-b')
    state.generation.set('sess-b', 1)
    ;(opener as any).openDockerSocketChannel = async (id: string) => {
      const r = trackableStream()
      if (id === 'sess-a') remotesA.push(r)
      else remotesB.push(r)
      return r
    }

    const transport = new DockerSocketTransport(opener)
    transports.push(transport)
    const epA = await transport.ensureProxy('sess-a')
    const epB = await transport.ensureProxy('sess-b')

    const cA = net.connect({ host: '127.0.0.1', port: epA.localPort })
    const cB = net.connect({ host: '127.0.0.1', port: epB.localPort })
    await Promise.all([
      new Promise<void>((res, rej) => {
        cA.once('connect', () => res())
        cA.once('error', rej)
      }),
      new Promise<void>((res, rej) => {
        cB.once('connect', () => res())
        cB.once('error', rej)
      }),
    ])
    await waitFor(() => remotesA.length === 1 && remotesB.length === 1)

    transport.closeSession('sess-a')
    await waitFor(() => remotesA[0].destroyedFlag === true)
    expect(remotesB[0].destroyedFlag).toBe(false)
    expect(transport.getActiveEndpoint('sess-b')).not.toBeNull()
    expect(transport.getActiveStreamCount('sess-b')).toBe(1)

    try {
      cA.destroy()
      cB.destroy()
    } catch {}
  })

  it('closeAll zeros proxy/socket/stream owners', async () => {
    const remote = trackableStream()
    const { opener } = createFakeOpener()
    ;(opener as any).openDockerSocketChannel = async () => remote
    const transport = new DockerSocketTransport(opener)
    transports.push(transport)
    const endpoint = await transport.ensureProxy('sess-a')
    const client = net.connect({ host: '127.0.0.1', port: endpoint.localPort })
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve())
      client.once('error', reject)
    })
    await waitFor(() => transport.getActiveStreamCount('sess-a') === 1)

    transport.closeAll()
    transport.closeAll()
    expect(transport.getActiveEndpoint('sess-a')).toBeNull()
    expect(transport.getActiveStreamCount('sess-a')).toBe(0)
    expect(remote.destroyedFlag).toBe(true)
  })

  it('remote channel early failure surfaces structured proxy error (no hang)', async () => {
    const { opener } = createFakeOpener()
    ;(opener as any).openDockerSocketChannel = async () => {
      throw new DockerTransportError('transport-unsupported', 'Remote nc -U is not available', 'sess-a')
    }
    const transport = new DockerSocketTransport(opener)
    transports.push(transport)
    const endpoint = await transport.ensureProxy('sess-a')
    await expect(
      dockerHttpRequest(endpoint, 'GET', '/_ping', { timeoutMs: 2000 }),
    ).rejects.toMatchObject({
      name: 'DockerTransportError',
      code: 'transport-unsupported',
    })
  })
})

describe('DockerService ping/version over proxy', () => {
  const services: DockerService[] = []

  afterEach(() => {
    for (const s of services) {
      try {
        s.closeAll()
      } catch {}
    }
    services.length = 0
  })

  it('ping and version succeed through loopback proxy + StreamLocal mock', async () => {
    const { opener } = createFakeOpener({
      openImpl: async (_id, path) => {
        expect(path).toBe('/var/run/docker.sock')
        return httpAnswerStream((head) => {
          if (head.startsWith('GET /_ping')) {
            return { status: 200, body: 'OK' }
          }
          if (head.startsWith('GET /version')) {
            return {
              status: 200,
              body: JSON.stringify({ Version: '24.0.0', ApiVersion: '1.43' }),
            }
          }
          return { status: 404, body: 'no' }
        })
      },
    })
    const service = new DockerService(opener)
    services.push(service)

    await expect(service.ping('sess-a')).resolves.toBe(true)
    const ver = await service.version('sess-a')
    expect(ver.Version).toBe('24.0.0')
    expect(ver.ApiVersion).toBe('1.43')
  })

  it('discards ping result when generation goes stale during request', async () => {
    const { opener, state } = createFakeOpener()
    state.openImpl = async () =>
      httpAnswerStream(() => {
        // Mutate generation while request is in flight (after headers received)
        state.generation.set('sess-a', 2)
        // Also close old proxy via generation mismatch on isLive
        return { status: 200, body: 'OK' }
      })

    const service = new DockerService(opener)
    services.push(service)

    // ensure first so proxy exists at gen 1
    await service.ensureTransport('sess-a')
    // After ensure, bump generation and close old proxy the way reconnect would
    state.generation.set('sess-a', 2)
    service.closeSession('sess-a')

    // Late request using ensure will create gen-2 proxy; force stale mid-flight differently:
    state.generation.set('sess-a', 1)
    await service.ensureTransport('sess-a')
    // Concurrent bump before response applied
    const pingPromise = service.ping('sess-a')
    state.generation.set('sess-a', 5)
    service.getTransport().closeSession('sess-a')

    await expect(pingPromise).rejects.toBeInstanceOf(DockerTransportError)
  })

  it('ping surfaces permission-denied via full loopback proxy path', async () => {
    const { opener } = createFakeOpener({
      openImpl: async () => {
        throw Object.assign(new Error('Permission denied'), { code: 'EACCES' })
      },
    })
    const service = new DockerService(opener)
    services.push(service)

    await expect(service.ping('sess-a')).rejects.toMatchObject({
      name: 'DockerTransportError',
      code: 'permission-denied',
    })
  })

  it('ping surfaces socket-not-found via full loopback proxy path', async () => {
    const { opener } = createFakeOpener({
      openImpl: async () => {
        throw Object.assign(new Error('connect ENOENT'), { code: 'ENOENT' })
      },
    })
    const service = new DockerService(opener)
    services.push(service)

    await expect(service.ping('sess-a')).rejects.toMatchObject({
      name: 'DockerTransportError',
      code: 'socket-not-found',
    })
  })

  it('version surfaces transport-unsupported via full loopback proxy path', async () => {
    const { opener } = createFakeOpener({
      openImpl: async () => {
        throw new Error('openssh_forwardOutStreamLocal is not supported')
      },
    })
    const service = new DockerService(opener)
    services.push(service)

    await expect(service.version('sess-a')).rejects.toMatchObject({
      name: 'DockerTransportError',
      code: 'transport-unsupported',
    })
  })
})

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('waitFor timeout')
}

function createFakeNcChannel(opts?: {
  exitCode?: number | null
  stderr?: string
  /** Fail before manager settle grace (40ms). */
  exitImmediate?: boolean
}): {
  channel: any
  written: Buffer[]
  destroy: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  emit: (ev: string, ...args: any[]) => void
} {
  const listeners = new Map<string, Set<(...a: any[]) => void>>()
  const written: Buffer[] = []
  const destroy = vi.fn()
  const close = vi.fn()
  const end = vi.fn()
  const stderrListeners = new Map<string, Set<(...a: any[]) => void>>()
  const stderr = {
    on(ev: string, fn: (...a: any[]) => void) {
      if (!stderrListeners.has(ev)) stderrListeners.set(ev, new Set())
      stderrListeners.get(ev)!.add(fn)
      return stderr
    },
    removeAllListeners(ev?: string) {
      if (ev) stderrListeners.delete(ev)
      else stderrListeners.clear()
      return stderr
    },
    resume: vi.fn(),
    emit(ev: string, ...args: any[]) {
      for (const fn of stderrListeners.get(ev) || []) fn(...args)
    },
  }
  const channel = {
    stderr,
    writable: true,
    readable: true,
    on(ev: string, fn: (...a: any[]) => void) {
      if (!listeners.has(ev)) listeners.set(ev, new Set())
      listeners.get(ev)!.add(fn)
      return channel
    },
    once(ev: string, fn: (...a: any[]) => void) {
      const wrap = (...a: any[]) => {
        listeners.get(ev)?.delete(wrap)
        fn(...a)
      }
      return channel.on(ev, wrap)
    },
    write(chunk: any, enc?: any, cb?: any) {
      written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      if (typeof enc === 'function') enc()
      else if (typeof cb === 'function') cb()
      return true
    },
    pipe(dest: any) {
      return dest
    },
    destroy,
    close,
    end,
    push(data: Buffer | null) {
      if (data === null) {
        for (const fn of listeners.get('end') || []) fn()
        for (const fn of listeners.get('close') || []) fn()
        return
      }
      for (const fn of listeners.get('data') || []) fn(data)
    },
  }
  const emit = (ev: string, ...args: any[]) => {
    for (const fn of listeners.get(ev) || []) fn(...args)
  }
  if (opts?.exitImmediate) {
    // After listeners attach (exec callback finishes), before 40ms settle
    setTimeout(() => {
      if (opts.stderr) stderr.emit('data', Buffer.from(opts.stderr))
      emit('exit', opts.exitCode ?? 1, null)
      emit('close')
    }, 10)
  }
  return { channel, written, destroy, close, end, emit }
}

async function loadSshManager() {
  vi.resetModules()
  vi.doMock('electron', () => ({
    app: { getPath: () => 'D:\\tmp\\LiteConnect-test-userdata' },
  }))
  vi.doMock('../i18n', () => ({ t: (k: string) => k }))
  vi.doMock('../ssh/x11Server', () => ({
    ensureX11ServerReady: vi.fn(async () => ({ ready: false, message: 'skip' })),
  }))
  const { SSHManager } = await import('../ssh/manager')
  return SSHManager
}

const dockerHosts = new WeakMap<object, any>()
async function hostFor(manager: object): Promise<any> {
  let host = dockerHosts.get(manager)
  if (!host) {
    const { DockerSshSessionHost } = await import('./sshSessionHost')
    host = new DockerSshSessionHost(manager as any)
    dockerHosts.set(manager, host)
  }
  return host
}

describe('SSHManager primitives and DockerSshSessionHost (unit)', () => {
  it('openStreamLocal rejects stale generation and missing session', async () => {
    const SSHManager = await loadSshManager()
    const manager = new SSHManager({
      init: vi.fn(async () => {}),
    } as any)

    await expect(manager.openStreamLocal('nope', '/var/run/docker.sock', 1)).rejects.toThrow(
      /not connected|generation/i,
    )

    const sid = 'sess-stream'
    ;(manager as any).sessionEpoch.set(sid, 3)
    ;(manager as any).sessions.set(sid, {
      id: sid,
      client: {
        openssh_forwardOutStreamLocal: (_p: string, cb: (err: Error | null, stream?: any) => void) => {
          cb(null, { destroy: vi.fn(), close: vi.fn(), on: vi.fn() })
        },
      },
      stream: {},
      connectionId: 'c',
      connectionName: 'n',
    })

    await expect(manager.openStreamLocal(sid, '/var/run/docker.sock', 1)).rejects.toThrow(
      /generation/i,
    )

    const stream = await manager.openStreamLocal(sid, '/var/run/docker.sock', 3)
    expect(stream).toBeTruthy()

    // Late callback after generation bump must reject
    ;(manager as any).sessions.set(sid, {
      id: sid,
      client: {
        openssh_forwardOutStreamLocal: (_p: string, cb: (err: Error | null, stream?: any) => void) => {
          ;(manager as any).sessionEpoch.set(sid, 4)
          const s = { destroy: vi.fn(), close: vi.fn(), on: vi.fn() }
          cb(null, s)
          expect(s.destroy).toHaveBeenCalled()
        },
      },
      stream: {},
      connectionId: 'c',
      connectionName: 'n',
    })
    await expect(manager.openStreamLocal(sid, '/var/run/docker.sock', 3)).rejects.toThrow(
      /generation/i,
    )
  })

  it('StreamLocal success does not call exec', async () => {
    const SSHManager = await loadSshManager()
    const manager = new SSHManager({ init: vi.fn(async () => {}) } as any)
    const sid = 'sess-sl-ok'
    const exec = vi.fn()
    const slStream = { destroy: vi.fn(), close: vi.fn(), on: vi.fn() }
    ;(manager as any).sessionEpoch.set(sid, 1)
    ;(manager as any).sessions.set(sid, {
      id: sid,
      client: {
        openssh_forwardOutStreamLocal: (_p: string, cb: (err: Error | null, stream?: any) => void) => {
          cb(null, slStream)
        },
        exec,
      },
      stream: {},
      connectionId: 'c',
      connectionName: 'n',
    })

    const stream = await (await hostFor(manager)).openDockerSocketChannel(sid, 1)
    expect(stream).toBe(slStream)
    expect(exec).not.toHaveBeenCalled()
    expect((await hostFor(manager)).getLastDockerSocketMode(sid)).toBe('streamlocal')
  })

  it('StreamLocal hang times out and falls back to fixed nc exec; late StreamLocal is destroyed', async () => {
    const SSHManager = await loadSshManager()
    const manager = new SSHManager({ init: vi.fn(async () => {}) } as any)
    const sid = 'sess-sl-hang'
    let slCb: ((err: Error | null, stream?: any) => void) | null = null
    const exec = vi.fn((_c: string, _o: any, cb: (err: Error | null, stream?: any) => void) => {
      const { channel } = createFakeNcChannel()
      // settle immediately after exec open (no early exit)
      cb(null, channel)
    })
    ;(manager as any).sessionEpoch.set(sid, 1)
    ;(manager as any).sessions.set(sid, {
      id: sid,
      client: {
        openssh_forwardOutStreamLocal: (
          _p: string,
          cb: (err: Error | null, stream?: any) => void,
        ) => {
          slCb = cb
          // hang: never invokes cb until after timeout (late success)
        },
        exec,
      },
      stream: {},
      connectionId: 'c',
      connectionName: 'n',
    })

    const p = (await hostFor(manager)).openDockerSocketChannel(sid, 1)
    // Wait past DOCKER_STREAMLOCAL_OPEN_TIMEOUT_MS (2500) + nc settle
    await new Promise((r) => setTimeout(r, 2700))
    const stream = await p
    expect(exec).toHaveBeenCalledTimes(1)
    expect((await hostFor(manager)).getLastDockerSocketMode(sid)).toBe('exec-nc')
    expect(stream).toBeTruthy()

    const late = { end: vi.fn(), on: vi.fn() }
    expect(slCb).toBeTypeOf('function')
    slCb!(null, late)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(late.end).toHaveBeenCalledTimes(1)
  }, 10_000)

  it('administratively prohibited triggers fixed nc exec once, no PTY/sudo/-l', async () => {
    const SSHManager = await loadSshManager()
    const manager = new SSHManager({ init: vi.fn(async () => {}) } as any)
    const sid = 'sess-nc-fb'
    const { channel } = createFakeNcChannel()
    const exec = vi.fn((_cmd: string, opts: any, cb: (err: Error | null, stream?: any) => void) => {
      expect(_cmd).toBe('exec /usr/bin/nc -U /var/run/docker.sock')
      expect(opts).toEqual({ pty: false })
      expect(_cmd).not.toMatch(/-l\b|sudo/)
      cb(null, channel)
    })
    ;(manager as any).sessionEpoch.set(sid, 1)
    ;(manager as any).sessions.set(sid, {
      id: sid,
      client: {
        openssh_forwardOutStreamLocal: (_p: string, cb: (err: Error | null, stream?: any) => void) => {
          cb(new Error('channel open failed: administratively prohibited'))
        },
        exec,
      },
      stream: {},
      connectionId: 'c',
      connectionName: 'n',
    })

    const stream = await (await hostFor(manager)).openDockerSocketChannel(sid, 1)
    expect(stream).toBe(channel)
    expect(exec).toHaveBeenCalledTimes(1)
    expect((await hostFor(manager)).getLastDockerSocketMode(sid)).toBe('exec-nc')
  })

  it('fallback stdout is binary-transparent; stderr not mixed into channel reads', async () => {
    const SSHManager = await loadSshManager()
    const manager = new SSHManager({ init: vi.fn(async () => {}) } as any)
    const sid = 'sess-bin'
    const { channel, written } = createFakeNcChannel()
    ;(manager as any).sessionEpoch.set(sid, 1)
    ;(manager as any).sessions.set(sid, {
      id: sid,
      client: {
        openssh_forwardOutStreamLocal: (_p: string, cb: (err: Error | null) => void) => {
          cb(new Error('Administratively prohibited'))
        },
        exec: (_c: string, _o: any, cb: (err: Error | null, stream?: any) => void) => {
          cb(null, channel)
        },
      },
      stream: {},
      connectionId: 'c',
      connectionName: 'n',
    })

    const stream = await (await hostFor(manager)).openDockerSocketChannel(sid, 1)
    const payload = Buffer.from([0x00, 0xff, 0x01, 0x7f])
    ;(stream as any).write(payload)
    expect(written[0].equals(payload)).toBe(true)

    const dataChunks: Buffer[] = []
    stream.on('data', (c: Buffer) => dataChunks.push(c))
    channel.stderr.emit('data', Buffer.from('secret-stderr-token'))
    channel.push(Buffer.from('HTTP/1.0 200 OK\r\n\r\nOK'))
    expect(Buffer.concat(dataChunks).toString('utf8')).toBe('HTTP/1.0 200 OK\r\n\r\nOK')
    expect(Buffer.concat(dataChunks).toString('utf8')).not.toMatch(/secret-stderr/)
  })

  it('nc missing maps transport-unsupported without stderr leak', async () => {
    const SSHManager = await loadSshManager()
    const manager = new SSHManager({ init: vi.fn(async () => {}) } as any)
    const sid = 'sess-nc-miss'
    ;(manager as any).sessionEpoch.set(sid, 1)
    ;(manager as any).sessions.set(sid, {
      id: sid,
      client: {
        openssh_forwardOutStreamLocal: (_p: string, cb: (err: Error | null) => void) => {
          cb(new Error('channel open failed: administratively prohibited'))
        },
        exec: (_c: string, _o: any, cb: (err: Error | null, stream?: any) => void) => {
          const { channel } = createFakeNcChannel({
            exitImmediate: true,
            exitCode: 127,
            stderr: 'bash: /usr/bin/nc: No such file or directory',
          })
          cb(null, channel)
        },
      },
      stream: {},
      connectionId: 'c',
      connectionName: 'n',
    })

    try {
      await (await hostFor(manager)).openDockerSocketChannel(sid, 1)
      expect.fail('should reject')
    } catch (err: any) {
      expect(err.name).toBe('DockerTransportError')
      expect(err.code).toBe('transport-unsupported')
      expect(String(err.message)).not.toMatch(/bash:|No such file/)
    }
  })

  it('socket missing and permission map stable codes without stderr leak', async () => {
    const SSHManager = await loadSshManager()
    const manager = new SSHManager({ init: vi.fn(async () => {}) } as any)
    const host = await hostFor(manager)
    const sid = 'sess-nc-sock'
    ;(manager as any).sessionEpoch.set(sid, 1)

    const run = async (stderr: string, exitCode: number) => {
      const { channel } = createFakeNcChannel({ exitImmediate: true, exitCode, stderr })
      ;(manager as any).sessions.set(sid, {
        id: sid,
        client: {
          openssh_forwardOutStreamLocal: (_p: string, cb: (err: Error | null) => void) => {
            cb(new Error('Channel open failure: open failed'))
          },
          exec: (_c: string, _o: any, cb: (err: Error | null, stream?: any) => void) => {
            cb(null, channel)
          },
        },
        stream: {},
        connectionId: 'c',
        connectionName: 'n',
      })
      return host.openDockerSocketChannel(sid, 1)
    }

    await expect(
      run('nc: connect to /var/run/docker.sock failed: No such file or directory', 1),
    ).rejects.toMatchObject({ code: 'socket-not-found', message: 'Docker socket not found' })

    await expect(
      run('nc: Permission denied connecting to docker.sock', 1),
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('missing session / disconnected / generation stale do not exec', async () => {
    const SSHManager = await loadSshManager()
    const manager = new SSHManager({ init: vi.fn(async () => {}) } as any)
    const exec = vi.fn()

    await expect((await hostFor(manager)).openDockerSocketChannel('gone', 1)).rejects.toThrow(/not connected|generation/i)
    expect(exec).not.toHaveBeenCalled()

    const sid = 'sess-stale'
    ;(manager as any).sessionEpoch.set(sid, 2)
    ;(manager as any).sessions.set(sid, {
      id: sid,
      client: {
        openssh_forwardOutStreamLocal: vi.fn(),
        exec,
      },
      stream: {},
      connectionId: 'c',
      connectionName: 'n',
    })
    await expect((await hostFor(manager)).openDockerSocketChannel(sid, 1)).rejects.toThrow(/generation/i)
    expect(exec).not.toHaveBeenCalled()
  })

  it('late nc channel after generation bump is destroyed', async () => {
    const SSHManager = await loadSshManager()
    const manager = new SSHManager({ init: vi.fn(async () => {}) } as any)
    const sid = 'sess-late-nc'
    let execCb: ((err: Error | null, stream?: any) => void) | null = null
    ;(manager as any).sessionEpoch.set(sid, 1)
    ;(manager as any).sessions.set(sid, {
      id: sid,
      client: {
        openssh_forwardOutStreamLocal: (_p: string, cb: (err: Error | null) => void) => {
          cb(new Error('administratively prohibited'))
        },
        exec: (_c: string, _o: any, cb: (err: Error | null, stream?: any) => void) => {
          execCb = cb
        },
      },
      stream: {},
      connectionId: 'c',
      connectionName: 'n',
    })

    const p = (await hostFor(manager)).openDockerSocketChannel(sid, 1)
    await new Promise((r) => setTimeout(r, 10))
    ;(manager as any).sessionEpoch.set(sid, 2)
    const { channel, destroy } = createFakeNcChannel()
    execCb!(null, channel)
    await expect(p).rejects.toThrow(/generation/i)
    expect(destroy).toHaveBeenCalled()
  })

  it('non-fallback StreamLocal errors do not call exec', async () => {
    const SSHManager = await loadSshManager()
    const manager = new SSHManager({ init: vi.fn(async () => {}) } as any)
    const sid = 'sess-no-fb'
    const exec = vi.fn()
    ;(manager as any).sessionEpoch.set(sid, 1)
    ;(manager as any).sessions.set(sid, {
      id: sid,
      client: {
        openssh_forwardOutStreamLocal: (_p: string, cb: (err: Error | null) => void) => {
          cb(Object.assign(new Error('Permission denied'), { code: 'EACCES' }))
        },
        exec,
      },
      stream: {},
      connectionId: 'c',
      connectionName: 'n',
    })
    await expect((await hostFor(manager)).openDockerSocketChannel(sid, 1)).rejects.toThrow(/Permission denied/i)
    expect(exec).not.toHaveBeenCalled()
  })

  it('reconnect prefers StreamLocal again (no permanent nc lock)', async () => {
    const SSHManager = await loadSshManager()
    const manager = new SSHManager({ init: vi.fn(async () => {}) } as any)
    const sid = 'sess-reconnect'
    let streamLocalFails = true
    const exec = vi.fn((_c: string, _o: any, cb: (err: Error | null, stream?: any) => void) => {
      const { channel } = createFakeNcChannel()
      cb(null, channel)
    })
    const setClient = () => {
      ;(manager as any).sessions.set(sid, {
        id: sid,
        client: {
          openssh_forwardOutStreamLocal: (_p: string, cb: (err: Error | null, stream?: any) => void) => {
            if (streamLocalFails) {
              cb(new Error('channel open failed: administratively prohibited'))
            } else {
              cb(null, { destroy: vi.fn(), close: vi.fn(), on: vi.fn() })
            }
          },
          exec,
        },
        stream: {},
        connectionId: 'c',
        connectionName: 'n',
      })
    }
    ;(manager as any).sessionEpoch.set(sid, 1)
    setClient()
    await (await hostFor(manager)).openDockerSocketChannel(sid, 1)
    expect((await hostFor(manager)).getLastDockerSocketMode(sid)).toBe('exec-nc')
    expect(exec).toHaveBeenCalledTimes(1)

    // Reconnect: bump generation, StreamLocal works
    ;(manager as any).sessionEpoch.set(sid, 2)
    streamLocalFails = false
    setClient()
    await (await hostFor(manager)).openDockerSocketChannel(sid, 2)
    expect((await hostFor(manager)).getLastDockerSocketMode(sid)).toBe('streamlocal')
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('checkDockerInstallation is generation-bound and token-based', async () => {
    vi.resetModules()
    vi.doMock('electron', () => ({
      app: { getPath: () => 'D:\\tmp\\LiteConnect-test-userdata' },
    }))
    vi.doMock('../i18n', () => ({ t: (k: string) => k }))
    vi.doMock('../ssh/x11Server', () => ({
      ensureX11ServerReady: vi.fn(async () => ({ ready: false, message: 'skip' })),
    }))

    const { SSHManager } = await import('../ssh/manager')
    const manager = new SSHManager({
      init: vi.fn(async () => {}),
    } as any)

    expect(await (await hostFor(manager)).checkDockerInstallation('missing', 1)).toBe('unknown')

    const sid = 'sess-install'
    ;(manager as any).sessionEpoch.set(sid, 2)
    ;(manager as any).sessions.set(sid, {
      id: sid,
      client: {},
      stream: {},
      connectionId: 'c',
      connectionName: 'n',
    })

    const sftpExec = vi.fn(async () => 'LITECONNECT_DOCKER_INSTALLED')
    ;(manager as any).sftpExec = sftpExec

    expect(await (await hostFor(manager)).checkDockerInstallation(sid, 1)).toBe('unknown')
    expect(sftpExec).not.toHaveBeenCalled()

    expect(await (await hostFor(manager)).checkDockerInstallation(sid, 2)).toBe('installed')
    expect(sftpExec).toHaveBeenCalledTimes(1)
    const cmd = sftpExec.mock.calls[0][1] as string
    expect(cmd).toMatch(/command -v docker/)
    expect(cmd).toMatch(/LITECONNECT_DOCKER_INSTALLED/)
    // No renderer-supplied path; fixed check only
    expect(cmd).not.toMatch(/docker version|docker info/)

    sftpExec.mockResolvedValueOnce('LITECONNECT_DOCKER_NOT_INSTALLED')
    expect(await (await hostFor(manager)).checkDockerInstallation(sid, 2)).toBe('not-installed')

    sftpExec.mockImplementationOnce(async () => {
      ;(manager as any).sessionEpoch.set(sid, 3)
      return 'LITECONNECT_DOCKER_INSTALLED'
    })
    expect(await (await hostFor(manager)).checkDockerInstallation(sid, 2)).toBe('unknown')
  })

  it('DockerService.closeAll releases owned DockerSshSessionHost hook and mode state once', async () => {
    const SSHManager = await loadSshManager()
    const manager = new SSHManager({ init: vi.fn(async () => {}) } as any)
    const sid = 'sess-host-dispose'
    ;(manager as any).sessionEpoch.set(sid, 1)
    ;(manager as any).sessions.set(sid, {
      id: sid,
      client: {
        openssh_forwardOutStreamLocal: (_path: string, cb: (err: Error | null, stream?: any) => void) => {
          cb(null, { destroy: vi.fn(), close: vi.fn() })
        },
      },
      stream: {}, connectionId: 'c', connectionName: 'n',
    })
    const baseline = (manager as any).sessionTeardownHooks.size
    const host = await hostFor(manager)
    await host.openDockerSocketChannel(sid, 1)
    expect(host.getLastDockerSocketMode(sid)).toBe('streamlocal')
    expect((manager as any).sessionTeardownHooks.size).toBe(baseline + 1)

    const service = new DockerService(host)
    expect((manager as any).sessionTeardownHooks.size).toBe(baseline + 3)
    service.closeAll()
    expect((manager as any).sessionTeardownHooks.size).toBe(baseline)
    expect(host.getLastDockerSocketMode(sid)).toBeNull()
    service.closeAll()
    expect((manager as any).sessionTeardownHooks.size).toBe(baseline)
    expect(service.getTransport().getActiveEndpoint(sid)).toBeNull()
  })

  it('teardown hook runs on cleanupSession path (disconnect)', async () => {
    vi.resetModules()
    vi.doMock('electron', () => ({
      app: { getPath: () => 'D:\\tmp\\LiteConnect-test-userdata' },
    }))
    vi.doMock('../i18n', () => ({ t: (k: string) => k }))
    vi.doMock('../ssh/x11Server', () => ({
      ensureX11ServerReady: vi.fn(async () => ({ ready: false, message: 'skip' })),
    }))

    const { SSHManager } = await import('../ssh/manager')
    const manager = new SSHManager({
      init: vi.fn(async () => {}),
    } as any)

    const sid = 'sess-hook'
    const hook = vi.fn()
    const unsub = manager.registerSessionTeardownHook(hook)
    ;(manager as any).sessionEpoch.set(sid, 1)
    ;(manager as any).sessions.set(sid, {
      id: sid,
      client: { end: vi.fn(), destroy: vi.fn() },
      stream: { close: vi.fn() },
      connectionId: 'c',
      connectionName: 'n',
    })

    manager.disconnect(sid)
    expect(hook).toHaveBeenCalledWith(sid)

    unsub()
    ;(manager as any).sessions.set(sid, {
      id: sid,
      client: { end: vi.fn(), destroy: vi.fn() },
      stream: { close: vi.fn() },
      connectionId: 'c',
      connectionName: 'n',
    })
    manager.disconnect(sid)
    expect(hook).toHaveBeenCalledTimes(1)
  })
})
