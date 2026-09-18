import { afterEach, describe, expect, it, vi } from 'vitest'
import { Duplex } from 'stream'
import {
  compareDockerApiVersions,
  DOCKER_MVP_MIN_API_VERSION,
  DockerService,
  parseDockerApiVersion,
} from './service'
import type {
  DockerInstallationChecker,
  DockerInstallationPresence,
  StreamLocalChannelOpener,
} from './types'

type FakeHostState = {
  sessions: Set<string>
  generation: Map<string, number>
  openImpl: (
    sessionId: string,
    path: string,
    generation: number,
  ) => Promise<NodeJS.ReadWriteStream>
  hooks: Set<(sessionId: string) => void>
  openCount: number
  installImpl: (
    sessionId: string,
    generation: number,
  ) => Promise<DockerInstallationPresence>
  installCalls: Array<{ sessionId: string; generation: number }>
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
    openCount: 0,
    installImpl: async () => 'unknown',
    installCalls: [],
    ...state,
  }
  const host: StreamLocalChannelOpener & DockerInstallationChecker = {
    hasSession: (id) => st.sessions.has(id),
    getSessionGeneration: (id) => st.generation.get(id) || 0,
    openStreamLocal: async (id, path, gen) => {
      st.openCount += 1
      return st.openImpl(id, path, gen)
    },
    registerSessionTeardownHook: (hook) => {
      st.hooks.add(hook)
      return () => st.hooks.delete(hook)
    },
    checkDockerInstallation: async (sessionId, generation) => {
      st.installCalls.push({ sessionId, generation })
      return st.installImpl(sessionId, generation)
    },
  }
  return { host, state: st }
}

/** Answers one HTTP request then closes (one StreamLocal accept per request). */
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
  })
  return duplex as NodeJS.ReadWriteStream
}

function dockerOkOpenImpl(): (
  sessionId: string,
  path: string,
  generation: number,
) => Promise<NodeJS.ReadWriteStream> {
  return async () =>
    httpAnswerStream((head) => {
      if (head.includes('GET /_ping')) return { status: 200, body: 'OK' }
      if (head.includes('GET /version')) {
        return {
          status: 200,
          body: JSON.stringify({ Version: '24.0.7', ApiVersion: '1.43' }),
        }
      }
      return { status: 404, body: 'not found' }
    })
}

const services: DockerService[] = []

afterEach(() => {
  for (const s of services) {
    try {
      s.closeAll()
    } catch {}
  }
  services.length = 0
})

describe('DockerService.probe', () => {
  it('reports only a conclusively old API as incompatible', async () => {
    const makeOpen = (version: unknown) => async () =>
      httpAnswerStream((head) => {
        if (head.includes('GET /_ping')) return { status: 200, body: 'OK' }
        return { status: 200, body: JSON.stringify({ Version: 'old', ApiVersion: version }) }
      })
    const { host, state } = createFakeHost({ openImpl: makeOpen('1.22') })
    const svc = new DockerService(host)
    services.push(svc)
    await expect(svc.probe('sess-a')).resolves.toEqual({
      status: 'api-version-incompatible',
      engineVersion: 'old',
      apiVersion: '1.22',
      requiredApiVersion: DOCKER_MVP_MIN_API_VERSION,
    })

    state.openImpl = makeOpen('1.23')
    expect((await svc.probe('sess-a')).status).toBe('available')
    state.openImpl = makeOpen('1.24')
    expect((await svc.probe('sess-a')).status).toBe('available')
    state.openImpl = makeOpen('1.9')
    expect((await svc.probe('sess-a')).status).toBe('api-version-incompatible')
  })

  it('treats missing, malformed, or contradictory version data as probe failure', async () => {
    const makeOpen = (payload: Record<string, unknown>) => async () =>
      httpAnswerStream((head) => {
        if (head.includes('GET /_ping')) return { status: 200, body: 'OK' }
        return { status: 200, body: JSON.stringify(payload) }
      })
    for (const payload of [
      { Version: 'x' },
      { Version: 'x', ApiVersion: '' },
      { Version: 'x', ApiVersion: 'v1.25' },
      { Version: 'x', ApiVersion: '1.25.0' },
      { Version: 'x', ApiVersion: '1.25', MinAPIVersion: '1.26' },
    ]) {
      const { host } = createFakeHost({ openImpl: makeOpen(payload) })
      const svc = new DockerService(host)
      services.push(svc)
      expect((await svc.probe('sess-a')).status).toBe('daemon-unavailable')
    }
  })
  it('returns available with engine and api versions', async () => {
    const { host } = createFakeHost({
      openImpl: dockerOkOpenImpl(),
    })
    const svc = new DockerService(host)
    services.push(svc)

    const r = await svc.probe('sess-a')
    expect(r).toEqual({
      status: 'available',
      engineVersion: '24.0.7',
      apiVersion: '1.43',
    })
  })

  it('merges concurrent probes into one /_ping + /version (exactly 2 StreamLocal opens)', async () => {
    const { host, state } = createFakeHost({
      openImpl: dockerOkOpenImpl(),
    })
    const svc = new DockerService(host)
    services.push(svc)

    const p1 = svc.probe('sess-a')
    const p2 = svc.probe('sess-a')
    expect(svc.getProbeInflightSize()).toBe(1)

    const [a, b] = await Promise.all([p1, p2])
    expect(a).toBe(b)
    expect(a).toEqual({
      status: 'available',
      engineVersion: '24.0.7',
      apiVersion: '1.43',
    })
    // One probe cycle: one open for /_ping + one for /version (not 4)
    expect(state.openCount).toBe(2)
    expect(svc.getProbeInflightSize()).toBe(0)
  })

  it('allows retry after failure (no permanent fail cache)', async () => {
    const { host, state } = createFakeHost({
      openImpl: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
      installImpl: async () => 'not-installed',
    })
    const svc = new DockerService(host)
    services.push(svc)

    const first = await svc.probe('sess-a')
    expect(first.status).toBe('not-installed')
    expect(svc.getProbeInflightSize()).toBe(0)

    state.openImpl = dockerOkOpenImpl()
    const second = await svc.probe('sess-a')
    expect(second).toEqual({
      status: 'available',
      engineVersion: '24.0.7',
      apiVersion: '1.43',
    })
  })

  it('maps transport-unsupported and permission-denied', async () => {
    const { host, state } = createFakeHost({
      openImpl: async () => {
        throw new Error('openssh_forwardOutStreamLocal is not supported')
      },
    })
    const svc = new DockerService(host)
    services.push(svc)
    expect((await svc.probe('sess-a')).status).toBe('transport-unsupported')
    expect(state.installCalls.length).toBe(0)

    state.openImpl = async () => {
      throw Object.assign(new Error('Permission denied'), { code: 'EACCES' })
    }
    expect((await svc.probe('sess-a')).status).toBe('permission-denied')
  })

  it('socket-not-found + not-installed evidence → not-installed', async () => {
    const { host, state } = createFakeHost({
      openImpl: async () => {
        throw Object.assign(new Error('No such file'), { code: 'ENOENT' })
      },
      installImpl: async () => 'not-installed',
    })
    const svc = new DockerService(host)
    services.push(svc)
    const r = await svc.probe('sess-a')
    expect(r).toEqual({ status: 'not-installed' })
    expect(state.installCalls).toEqual([{ sessionId: 'sess-a', generation: 1 }])
  })

  it('socket-not-found + installed evidence → daemon-unavailable', async () => {
    const { host, state } = createFakeHost({
      openImpl: async () => {
        throw Object.assign(new Error('No such file'), { code: 'ENOENT' })
      },
      installImpl: async () => 'installed',
    })
    const svc = new DockerService(host)
    services.push(svc)
    const r = await svc.probe('sess-a')
    expect(r.status).toBe('daemon-unavailable')
    expect(state.installCalls).toEqual([{ sessionId: 'sess-a', generation: 1 }])
  })

  it('socket-not-found + unknown/failed install check → daemon-unavailable (not not-installed)', async () => {
    const { host, state } = createFakeHost({
      openImpl: async () => {
        throw Object.assign(new Error('No such file'), { code: 'ENOENT' })
      },
      installImpl: async () => 'unknown',
    })
    const svc = new DockerService(host)
    services.push(svc)
    expect((await svc.probe('sess-a')).status).toBe('daemon-unavailable')

    state.installImpl = async () => {
      throw new Error('exec failed')
    }
    expect((await svc.probe('sess-a')).status).toBe('daemon-unavailable')
  })

  it('socket-not-found install check after generation bump → ssh-disconnected', async () => {
    let releaseInstall: (() => void) | null = null
    const { host, state } = createFakeHost({
      openImpl: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
      installImpl: async () => {
        await new Promise<void>((resolve) => {
          releaseInstall = resolve
        })
        return 'not-installed'
      },
    })
    const svc = new DockerService(host)
    services.push(svc)

    const stale = svc.probe('sess-a')
    await new Promise((r) => setTimeout(r, 30))
    expect(releaseInstall).toBeTruthy()

    for (const h of state.hooks) h('sess-a')
    state.generation.set('sess-a', 2)
    state.openImpl = dockerOkOpenImpl()

    const fresh = await svc.probe('sess-a')
    expect(fresh.status).toBe('available')

    releaseInstall?.()
    expect((await stale).status).toBe('ssh-disconnected')
  })

  it('returns ssh-disconnected when session missing', async () => {
    const { host } = createFakeHost({
      sessions: new Set(),
      generation: new Map(),
    })
    const svc = new DockerService(host)
    services.push(svc)
    expect(await svc.probe('gone')).toEqual({ status: 'ssh-disconnected' })
  })

  it('stale generation does not overwrite reconnect probe result', async () => {
    let releaseGen1: (() => void) | null = null
    const { host, state } = createFakeHost()
    state.openImpl = async (_id, _path, gen) => {
      if (gen === 1) {
        await new Promise<void>((resolve) => {
          releaseGen1 = resolve
        })
        return httpAnswerStream(() => ({
          status: 200,
          body: JSON.stringify({ Version: '1.0.0-stale', ApiVersion: '1.0' }),
        }))
      }
      return httpAnswerStream((head) => {
        if (head.includes('GET /_ping')) return { status: 200, body: 'OK' }
        if (head.includes('GET /version')) {
          return {
            status: 200,
            body: JSON.stringify({ Version: '24.0.7', ApiVersion: '1.43' }),
          }
        }
        return { status: 404, body: 'no' }
      })
    }

    const svc = new DockerService(host)
    services.push(svc)

    const stale = svc.probe('sess-a')
    await new Promise((r) => setTimeout(r, 30))
    expect(releaseGen1).toBeTruthy()

    for (const h of state.hooks) h('sess-a')
    state.generation.set('sess-a', 2)

    const fresh = await svc.probe('sess-a')
    expect(fresh).toEqual({
      status: 'available',
      engineVersion: '24.0.7',
      apiVersion: '1.43',
    })

    releaseGen1?.()
    const staleResult = await stale
    expect(staleResult.status).toBe('ssh-disconnected')
  })

  it('closeSession is idempotent and clears probe inflight keys', async () => {
    const { host } = createFakeHost({
      openImpl: dockerOkOpenImpl(),
    })
    const svc = new DockerService(host)
    services.push(svc)
    await svc.probe('sess-a')
    svc.closeSession('sess-a')
    svc.closeSession('sess-a')
    expect(svc.getProbeInflightSize()).toBe(0)
    expect(svc.getTransport().getActiveEndpoint('sess-a')).toBeNull()
  })

  it('generic connection failure is daemon-unavailable without install check', async () => {
    const { host, state } = createFakeHost({
      openImpl: async () => {
        throw new Error('connection refused')
      },
    })
    const svc = new DockerService(host)
    services.push(svc)
    expect((await svc.probe('sess-a')).status).toBe('daemon-unavailable')
    expect(state.installCalls.length).toBe(0)
  })
})

describe('Docker API version helpers', () => {
  it('compares numeric dotted fields rather than lexical strings', () => {
    expect(compareDockerApiVersions('1.9', '1.10')).toBeLessThan(0)
    expect(compareDockerApiVersions('1.10', '1.9')).toBeGreaterThan(0)
    expect(compareDockerApiVersions('1.25', '1.25')).toBe(0)
  })

  it('rejects empty, non-numeric, and multi-segment API versions', () => {
    for (const value of [undefined, '', '1', '1.', '1.x', '1.25.0', ' 1.25']) {
      expect(parseDockerApiVersion(value)).toBeNull()
    }
  })
})

describe('SSHManager.checkDockerInstallation contract shape', () => {
  it('accepts host with checkDockerInstallation (smoke)', async () => {
    const check = vi.fn(async () => 'installed' as const)
    const { host } = createFakeHost({
      openImpl: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
      installImpl: check,
    })
    const svc = new DockerService(host)
    services.push(svc)
    await svc.probe('sess-a')
    expect(check).toHaveBeenCalledWith('sess-a', 1)
  })
})
