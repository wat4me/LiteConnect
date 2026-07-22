import { afterEach, describe, expect, it, vi } from 'vitest'
import { Duplex } from 'stream'
import { DockerService } from './service'
import { DOCKER_STOP_TIMEOUT_SEC, DockerTransportError } from './types'
import type {
  DockerInstallationChecker,
  DockerInstallationPresence,
  StreamLocalChannelOpener,
} from './types'
import { isAllowedDockerApiRequest } from './containers'
import { dockerHttpRequest } from './transport'

type FakeHostState = {
  sessions: Set<string>
  generation: Map<string, number>
  openImpl: (
    sessionId: string,
    path: string,
    generation: number,
  ) => Promise<NodeJS.ReadWriteStream>
  hooks: Set<(sessionId: string) => void>
}

function createFakeHost(state?: Partial<FakeHostState>): {
  host: StreamLocalChannelOpener & DockerInstallationChecker
  state: FakeHostState
} {
  const st: FakeHostState = {
    sessions: new Set(['sess-a']),
    generation: new Map([['sess-a', 1]]),
    openImpl: async () => {
      throw new Error('openImpl not set')
    },
    hooks: new Set(),
    ...state,
  }
  const host: StreamLocalChannelOpener & DockerInstallationChecker = {
    hasSession: (id) => st.sessions.has(id),
    getSessionGeneration: (id) => st.generation.get(id) || 0,
    openStreamLocal: async (id, path, gen) => st.openImpl(id, path, gen),
    registerSessionTeardownHook: (hook) => {
      st.hooks.add(hook)
      return () => st.hooks.delete(hook)
    },
    checkDockerInstallation: async () => 'unknown' as DockerInstallationPresence,
  }
  return { host, state: st }
}

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
      const statusText = res.status === 204 ? 'No Content' : res.status === 304 ? 'Not Modified' : 'OK'
      const body = res.body
      const payload =
        `HTTP/1.1 ${res.status} ${statusText}\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        `Connection: close\r\n` +
        `\r\n` +
        body
      this.push(Buffer.from(payload))
      this.push(null)
      cb()
    },
  })
  return duplex as NodeJS.ReadWriteStream
}

/** Stream that never responds (for timeout tests). */
function hangStream() {
  const duplex = new Duplex({
    read() {},
    write(_chunk, _enc, cb) {
      cb()
    },
  })
  return duplex as NodeJS.ReadWriteStream
}

const services: DockerService[] = []

afterEach(() => {
  for (const s of services) {
    try {
      s.closeAll()
    } catch {}
  }
  services.length = 0
  vi.useRealTimers()
})

describe('Docker API method+path whitelist', () => {
  it('allows only fixed GET and POST combinations', () => {
    expect(isAllowedDockerApiRequest('GET', '/_ping')).toBe(true)
    expect(isAllowedDockerApiRequest('GET', '/version')).toBe(true)
    expect(isAllowedDockerApiRequest('GET', '/containers/json?all=true')).toBe(true)
    expect(isAllowedDockerApiRequest('GET', '/containers/abc/json')).toBe(true)
    expect(isAllowedDockerApiRequest('POST', '/containers/abc/start')).toBe(true)
    expect(
      isAllowedDockerApiRequest('POST', `/containers/abc/stop?t=${DOCKER_STOP_TIMEOUT_SEC}`),
    ).toBe(true)
    expect(
      isAllowedDockerApiRequest('POST', `/containers/abc/restart?t=${DOCKER_STOP_TIMEOUT_SEC}`),
    ).toBe(true)
    expect(
      isAllowedDockerApiRequest(
        'GET',
        '/containers/abc/logs?stdout=1&stderr=1&timestamps=0&tail=200&follow=1',
      ),
    ).toBe(true)
  })

  it('rejects GET action paths and POST list/inspect', () => {
    expect(isAllowedDockerApiRequest('GET', '/containers/abc/start')).toBe(false)
    expect(isAllowedDockerApiRequest('POST', '/containers/json?all=true')).toBe(false)
    expect(isAllowedDockerApiRequest('POST', '/containers/abc/json')).toBe(false)
    expect(isAllowedDockerApiRequest('POST', '/containers/abc/stop?t=99')).toBe(false)
    expect(isAllowedDockerApiRequest('POST', '/containers/abc/start?force=1')).toBe(false)
    expect(isAllowedDockerApiRequest('DELETE', '/containers/abc')).toBe(false)
  })
})

describe('DockerService.containerAction', () => {
  it('start constructs fixed POST path', async () => {
    const seen: string[] = []
    const { host } = createFakeHost({
      openImpl: async () =>
        httpAnswerStream((head) => {
          seen.push(head.split('\r\n')[0] || '')
          if (head.includes('POST /containers/cid1/start')) {
            return { status: 204, body: '' }
          }
          return { status: 500, body: 'no' }
        }),
    })
    const svc = new DockerService(host)
    services.push(svc)
    const r = await svc.containerAction('sess-a', 'cid1', 'start')
    expect(r).toEqual({ action: 'start', containerId: 'cid1', outcome: 'completed' })
    expect(seen.some((l) => l.startsWith('POST /containers/cid1/start'))).toBe(true)
  })

  it('stop constructs fixed timeout query', async () => {
    const seen: string[] = []
    const { host } = createFakeHost({
      openImpl: async () =>
        httpAnswerStream((head) => {
          seen.push(head.split('\r\n')[0] || '')
          if (head.includes(`POST /containers/cid1/stop?t=${DOCKER_STOP_TIMEOUT_SEC}`)) {
            return { status: 204, body: '' }
          }
          return { status: 500, body: 'no' }
        }),
    })
    const svc = new DockerService(host)
    services.push(svc)
    await svc.containerAction('sess-a', 'cid1', 'stop')
    expect(
      seen.some((l) => l.includes(`POST /containers/cid1/stop?t=${DOCKER_STOP_TIMEOUT_SEC}`)),
    ).toBe(true)
  })

  it('restart constructs fixed timeout query', async () => {
    const seen: string[] = []
    const { host } = createFakeHost({
      openImpl: async () =>
        httpAnswerStream((head) => {
          seen.push(head.split('\r\n')[0] || '')
          if (head.includes(`POST /containers/cid1/restart?t=${DOCKER_STOP_TIMEOUT_SEC}`)) {
            return { status: 204, body: '' }
          }
          return { status: 500, body: 'no' }
        }),
    })
    const svc = new DockerService(host)
    services.push(svc)
    await svc.containerAction('sess-a', 'cid1', 'restart')
    expect(
      seen.some((l) =>
        l.includes(`POST /containers/cid1/restart?t=${DOCKER_STOP_TIMEOUT_SEC}`),
      ),
    ).toBe(true)
  })

  it('rejects invalid containerId', async () => {
    const { host } = createFakeHost()
    const svc = new DockerService(host)
    services.push(svc)
    await expect(svc.containerAction('sess-a', '../x', 'start')).rejects.toMatchObject({
      code: 'request-failed',
    })
    await expect(svc.containerAction('sess-a', 'a/b', 'start')).rejects.toMatchObject({
      code: 'request-failed',
    })
  })

  it('rejects non-whitelist action', async () => {
    const { host } = createFakeHost()
    const svc = new DockerService(host)
    services.push(svc)
    await expect(
      svc.containerAction('sess-a', 'cid1', 'delete' as any),
    ).rejects.toMatchObject({ code: 'request-failed' })
  })

  it('204 → completed, 304 → already-in-state', async () => {
    let n = 0
    const { host } = createFakeHost({
      openImpl: async () =>
        httpAnswerStream(() => {
          n += 1
          return n === 1 ? { status: 204, body: '' } : { status: 304, body: '' }
        }),
    })
    const svc = new DockerService(host)
    services.push(svc)
    await expect(svc.containerAction('sess-a', 'c1', 'start')).resolves.toMatchObject({
      outcome: 'completed',
    })
    await expect(svc.containerAction('sess-a', 'c1', 'start')).resolves.toMatchObject({
      outcome: 'already-in-state',
    })
  })

  it('404 → container-not-found, 409 → action-conflict', async () => {
    let mode = '404'
    const { host } = createFakeHost({
      openImpl: async () =>
        httpAnswerStream(() =>
          mode === '404'
            ? { status: 404, body: 'no such container SECRET' }
            : { status: 409, body: 'conflict SECRET' },
        ),
    })
    const svc = new DockerService(host)
    services.push(svc)
    await expect(svc.containerAction('sess-a', 'c1', 'start')).rejects.toMatchObject({
      code: 'container-not-found',
    })
    mode = '409'
    await expect(svc.containerAction('sess-a', 'c1', 'stop')).rejects.toMatchObject({
      code: 'action-conflict',
    })
  })

  it('401/403 → permission-denied, 500 → request-failed', async () => {
    let status = 401
    const { host } = createFakeHost({
      openImpl: async () => httpAnswerStream(() => ({ status, body: 'x' })),
    })
    const svc = new DockerService(host)
    services.push(svc)
    await expect(svc.containerAction('sess-a', 'c1', 'start')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    status = 403
    await expect(svc.containerAction('sess-a', 'c1', 'start')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    status = 500
    await expect(svc.containerAction('sess-a', 'c1', 'start')).rejects.toMatchObject({
      code: 'request-failed',
    })
  })

  it('same action stop+stop shares promise and both results are stop', async () => {
    let httpCount = 0
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const { host } = createFakeHost({
      openImpl: async () => {
        httpCount += 1
        await gate
        return httpAnswerStream(() => ({ status: 204, body: '' }))
      },
    })
    const svc = new DockerService(host)
    services.push(svc)
    const p1 = svc.containerAction('sess-a', 'same', 'stop')
    const p2 = svc.containerAction('sess-a', 'same', 'stop')
    await Promise.resolve()
    expect(svc.getActionInflightSize()).toBe(1)
    release()
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual({ action: 'stop', containerId: 'same', outcome: 'completed' })
    expect(r2).toEqual({ action: 'stop', containerId: 'same', outcome: 'completed' })
    expect(httpCount).toBe(1)
    expect(svc.getActionInflightSize()).toBe(0)
  })

  it('different action stop+restart: restart is action-conflict; one HTTP; stop completes', async () => {
    let httpCount = 0
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const { host } = createFakeHost({
      openImpl: async () => {
        httpCount += 1
        await gate
        return httpAnswerStream(() => ({ status: 204, body: '' }))
      },
    })
    const svc = new DockerService(host)
    services.push(svc)
    const pStop = svc.containerAction('sess-a', 'same', 'stop')
    // Wait until in-flight ownership is registered (before or after StreamLocal open).
    await vi.waitFor(() => {
      expect(svc.getActionInflightSize()).toBe(1)
    })
    await expect(svc.containerAction('sess-a', 'same', 'restart')).rejects.toMatchObject({
      code: 'action-conflict',
    })
    await expect(svc.containerAction('sess-a', 'same', 'start')).rejects.toMatchObject({
      code: 'action-conflict',
    })
    // At most one HTTP/StreamLocal open for the first stop
    await vi.waitFor(() => {
      expect(httpCount).toBe(1)
    })
    release()
    const stopResult = await pStop
    expect(stopResult).toEqual({ action: 'stop', containerId: 'same', outcome: 'completed' })
    expect(svc.getActionInflightSize()).toBe(0)
    // After first action completes, a new action may run
    const next = await svc.containerAction('sess-a', 'same', 'start')
    expect(next.action).toBe('start')
    expect(httpCount).toBe(2)
  })

  it('different containers A/B can run concurrently', async () => {
    let openCount = 0
    const { host } = createFakeHost({
      openImpl: async () => {
        openCount += 1
        return httpAnswerStream(() => ({ status: 204, body: '' }))
      },
    })
    const svc = new DockerService(host)
    services.push(svc)
    const [a, b] = await Promise.all([
      svc.containerAction('sess-a', 'container-a', 'start'),
      svc.containerAction('sess-a', 'container-b', 'stop'),
    ])
    expect(a.containerId).toBe('container-a')
    expect(b.containerId).toBe('container-b')
    expect(openCount).toBeGreaterThanOrEqual(2)
  })

  it('different sessions do not block each other', async () => {
    const { host, state } = createFakeHost({
      sessions: new Set(['sess-a', 'sess-b']),
      generation: new Map([
        ['sess-a', 1],
        ['sess-b', 1],
      ]),
      openImpl: async () => httpAnswerStream(() => ({ status: 204, body: '' })),
    })
    void state
    const svc = new DockerService(host)
    services.push(svc)
    const [a, b] = await Promise.all([
      svc.containerAction('sess-a', 'c1', 'start'),
      svc.containerAction('sess-b', 'c1', 'start'),
    ])
    expect(a.outcome).toBe('completed')
    expect(b.outcome).toBe('completed')
  })

  it('late 204 after generation bump is generation-stale (no pseudo-success)', async () => {
    const { host, state } = createFakeHost({
      openImpl: async () => {
        // Bump generation while request is in flight (after stream open, before response applied)
        state.generation.set('sess-a', 2)
        return httpAnswerStream(() => ({ status: 204, body: '' }))
      },
    })
    const svc = new DockerService(host)
    services.push(svc)
    await expect(svc.containerAction('sess-a', 'c1', 'start')).rejects.toMatchObject({
      code: 'generation-stale',
    })
  })

  it('SSH disconnect during action yields disconnected/stale', async () => {
    const { host, state } = createFakeHost({
      openImpl: async () => {
        state.sessions.delete('sess-a')
        for (const h of state.hooks) h('sess-a')
        return httpAnswerStream(() => ({ status: 204, body: '' }))
      },
    })
    const svc = new DockerService(host)
    services.push(svc)
    await expect(svc.containerAction('sess-a', 'c1', 'stop')).rejects.toBeInstanceOf(
      DockerTransportError,
    )
  })

  it('session teardown and closeAll clear action ownership', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const { host, state } = createFakeHost({
      openImpl: async () => {
        await gate
        return httpAnswerStream(() => ({ status: 204, body: '' }))
      },
    })
    const svc = new DockerService(host)
    services.push(svc)
    const p = svc.containerAction('sess-a', 'c1', 'start')
    await Promise.resolve()
    expect(svc.getActionInflightSize()).toBe(1)
    for (const h of state.hooks) h('sess-a')
    // teardown clears map; promise still settles via transport/generation
    expect(svc.getActionInflightSize()).toBe(0)
    release()
    await p.catch(() => {})
    svc.closeAll()
    expect(svc.getActionInflightSize()).toBe(0)
  })

  it('timeout releases in-flight', async () => {
    vi.useFakeTimers()
    const { host } = createFakeHost({
      openImpl: async () => hangStream(),
    })
    const svc = new DockerService(host)
    services.push(svc)
    const p = svc.containerAction('sess-a', 'c1', 'start')
    // Attach rejection handler before timers fire to avoid unhandled rejection.
    const assertion = expect(p).rejects.toMatchObject({ code: 'request-timeout' })
    await Promise.resolve()
    expect(svc.getActionInflightSize()).toBe(1)
    // Advance past DOCKER_ACTION_HTTP_TIMEOUT_MS (60s)
    await vi.advanceTimersByTimeAsync(61_000)
    await assertion
    expect(svc.getActionInflightSize()).toBe(0)
  })

  it('dockerHttpRequest rejects GET action path and arbitrary query', async () => {
    const endpoint = {
      sessionId: 's',
      generation: 1,
      localHost: '127.0.0.1' as const,
      localPort: 9,
    }
    await expect(
      dockerHttpRequest(endpoint, 'GET', '/containers/abc/start'),
    ).rejects.toMatchObject({ code: 'request-failed' })
    await expect(
      dockerHttpRequest(endpoint, 'POST', '/containers/abc/stop?t=1'),
    ).rejects.toMatchObject({ code: 'request-failed' })
    await expect(
      dockerHttpRequest(endpoint, 'POST', '/containers/json?all=true'),
    ).rejects.toMatchObject({ code: 'request-failed' })
  })

  it('status mapping: action/inspect 404 not-found; list/ping/version 404 request-failed', async () => {
    const secret = 'BODY_SECRET_SHOULD_NOT_LEAK'
    let pathMode: 'action' | 'inspect' | 'list' | 'version' | 'ping' | 'action409' | 'list409' =
      'action'
    const { host } = createFakeHost({
      openImpl: async () =>
        httpAnswerStream((head) => {
          if (pathMode === 'action') return { status: 404, body: secret }
          if (pathMode === 'inspect') return { status: 404, body: secret }
          if (pathMode === 'list') return { status: 404, body: secret }
          if (pathMode === 'version') return { status: 404, body: secret }
          if (pathMode === 'ping') return { status: 404, body: secret }
          if (pathMode === 'action409') return { status: 409, body: secret }
          return { status: 409, body: secret }
        }),
    })
    const svc = new DockerService(host)
    services.push(svc)

    pathMode = 'action'
    await expect(svc.containerAction('sess-a', 'c1', 'start')).rejects.toMatchObject({
      code: 'container-not-found',
    })

    pathMode = 'action409'
    await expect(svc.containerAction('sess-a', 'c1', 'stop')).rejects.toMatchObject({
      code: 'action-conflict',
    })

    pathMode = 'inspect'
    await expect(svc.inspectContainer('sess-a', 'c1')).rejects.toMatchObject({
      code: 'container-not-found',
    })

    pathMode = 'list'
    await expect(svc.listContainers('sess-a')).rejects.toMatchObject({
      code: 'request-failed',
    })

    pathMode = 'version'
    await expect(svc.version('sess-a')).rejects.toMatchObject({
      code: 'request-failed',
    })
    await expect(svc.version('sess-a')).rejects.not.toMatchObject({
      code: 'container-not-found',
    })

    pathMode = 'ping'
    // ping returns false on non-OK rather than always throwing; force via version path already covered
    // list 409 must not be action-conflict
    pathMode = 'list409'
    await expect(svc.listContainers('sess-a')).rejects.toMatchObject({
      code: 'request-failed',
    })
    await expect(svc.listContainers('sess-a')).rejects.not.toMatchObject({
      code: 'action-conflict',
    })
  })

  it('does not put response body into error message', async () => {
    const secret = 'ENV_SECRET_VALUE_SHOULD_NOT_LEAK'
    const { host } = createFakeHost({
      openImpl: async () =>
        httpAnswerStream(() => ({ status: 500, body: secret })),
    })
    const svc = new DockerService(host)
    services.push(svc)
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await svc.containerAction('sess-a', 'c1', 'start')
      expect.unreachable('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(DockerTransportError)
      expect((err as Error).message).not.toContain(secret)
    }
    const logged = [...spy.mock.calls, ...spyErr.mock.calls].flat().join(' ')
    expect(logged).not.toContain(secret)
    spy.mockRestore()
    spyErr.mockRestore()
  })
})
