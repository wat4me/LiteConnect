import { afterEach, describe, expect, it, vi } from 'vitest'
import { Duplex } from 'stream'
import { DockerService } from './service'
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

const services: DockerService[] = []

afterEach(() => {
  for (const s of services) {
    try {
      s.closeAll()
    } catch {}
  }
  services.length = 0
})

describe('DockerService listContainers / inspectContainer', () => {
  it('lists 0 containers', async () => {
    const { host } = createFakeHost({
      openImpl: async () =>
        httpAnswerStream((head) => {
          if (head.includes('GET /containers/json?all=true')) {
            return { status: 200, body: '[]' }
          }
          return { status: 404, body: 'no' }
        }),
    })
    const svc = new DockerService(host)
    services.push(svc)
    await expect(svc.listContainers('sess-a')).resolves.toEqual([])
  })

  it('lists containers with real names stripped', async () => {
    const { host } = createFakeHost({
      openImpl: async () =>
        httpAnswerStream((head) => {
          if (head.includes('GET /containers/json?all=true')) {
            return {
              status: 200,
              body: JSON.stringify([
                {
                  Id: 'cid1',
                  Names: ['/billing-worker'],
                  Image: 'billing:2',
                  State: 'running',
                  Status: 'Up 1 day',
                  Created: 10,
                  Ports: [],
                },
              ]),
            }
          }
          return { status: 404, body: 'no' }
        }),
    })
    const svc = new DockerService(host)
    services.push(svc)
    const list = await svc.listContainers('sess-a')
    expect(list).toHaveLength(1)
    expect(list[0].displayName).toBe('billing-worker')
    expect(list[0].names[0]).toBe('billing-worker')
  })

  it('rejects non-2xx list', async () => {
    const { host } = createFakeHost({
      openImpl: async () =>
        httpAnswerStream(() => ({ status: 500, body: 'boom' })),
    })
    const svc = new DockerService(host)
    services.push(svc)
    await expect(svc.listContainers('sess-a')).rejects.toMatchObject({
      code: 'request-failed',
    })
  })

  it('rejects invalid JSON list', async () => {
    const { host } = createFakeHost({
      openImpl: async () =>
        httpAnswerStream((head) => {
          if (head.includes('/containers/json')) {
            return { status: 200, body: 'not-json{' }
          }
          return { status: 404, body: 'no' }
        }),
    })
    const svc = new DockerService(host)
    services.push(svc)
    await expect(svc.listContainers('sess-a')).rejects.toMatchObject({
      code: 'request-failed',
    })
  })

  it('list fails ssh-disconnected when session gone', async () => {
    const { host, state } = createFakeHost({
      openImpl: async () => httpAnswerStream(() => ({ status: 200, body: '[]' })),
    })
    const svc = new DockerService(host)
    services.push(svc)
    state.sessions.delete('sess-a')
    await expect(svc.listContainers('sess-a')).rejects.toMatchObject({
      code: 'ssh-disconnected',
    })
  })

  it('list fails generation-stale when generation bumps mid-flight', async () => {
    const { host, state } = createFakeHost({
      openImpl: async () => {
        state.generation.set('sess-a', 99)
        return httpAnswerStream(() => ({
          status: 200,
          body: JSON.stringify([{ Id: 'late', Names: ['/late'], State: 'running' }]),
        }))
      },
    })
    const svc = new DockerService(host)
    services.push(svc)
    await expect(svc.listContainers('sess-a')).rejects.toMatchObject({
      code: expect.stringMatching(/generation-stale|ssh-disconnected|proxy-closed|request-failed/),
    })
  })

  it('inspect validates container id', async () => {
    const { host } = createFakeHost({
      openImpl: async () => httpAnswerStream(() => ({ status: 200, body: '{}' })),
    })
    const svc = new DockerService(host)
    services.push(svc)
    await expect(svc.inspectContainer('sess-a', '../etc')).rejects.toMatchObject({
      code: 'request-failed',
    })
    await expect(svc.inspectContainer('sess-a', 'a/b')).rejects.toMatchObject({
      code: 'request-failed',
    })
  })

  it('inspect uses encoded path and returns structured result', async () => {
    const seen: string[] = []
    const { host } = createFakeHost({
      openImpl: async () =>
        httpAnswerStream((head) => {
          seen.push(head.split('\r\n')[0] || head)
          if (head.includes('GET /containers/my-app/json')) {
            return {
              status: 200,
              body: JSON.stringify({
                Id: 'full',
                Name: '/my-app',
                Config: { Image: 'img:1' },
                State: { Status: 'running', Running: true },
                NetworkSettings: { Networks: {}, Ports: {} },
                HostConfig: { RestartPolicy: { Name: 'no' } },
                Mounts: [],
              }),
            }
          }
          return { status: 404, body: 'no' }
        }),
    })
    const svc = new DockerService(host)
    services.push(svc)
    const r = await svc.inspectContainer('sess-a', 'my-app')
    expect(r.overview.displayName).toBe('my-app')
    expect(r.inspectJson).toContain('my-app')
    expect(seen.some((h) => h.includes('/containers/my-app/json'))).toBe(true)
  })

  it('inspect rejects invalid JSON without logging body', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { host } = createFakeHost({
      openImpl: async () =>
        httpAnswerStream(() => ({ status: 200, body: '{bad' })),
    })
    const svc = new DockerService(host)
    services.push(svc)
    await expect(svc.inspectContainer('sess-a', 'c1')).rejects.toMatchObject({
      code: 'request-failed',
    })
    const allLogs = [...consoleSpy.mock.calls, ...consoleErr.mock.calls].flat().join(' ')
    expect(allLogs).not.toContain('{bad')
    consoleSpy.mockRestore()
    consoleErr.mockRestore()
  })
})
