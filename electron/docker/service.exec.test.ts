import { afterEach, describe, expect, it, vi } from 'vitest'
import { Duplex } from 'stream'
import { EventEmitter } from 'events'
import { DockerService } from './service'
import { DockerTransportError } from './types'
import type {
  DockerInstallationChecker,
  DockerInstallationPresence,
  StreamLocalChannelOpener,
} from './types'
import type { WebContents } from 'electron'

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

function fakeOwner(id = 1): WebContents {
  const listeners = new Map<string, Set<() => void>>()
  return {
    id,
    isDestroyed: () => false,
    once: (ev: string, cb: () => void) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set())
      listeners.get(ev)!.add(cb)
    },
    removeListener: (ev: string, cb: () => void) => {
      listeners.get(ev)?.delete(cb)
    },
    send: vi.fn(),
  } as unknown as WebContents
}

/** WebContents fake with observable destroyed-listener ownership for cleanup tests. */
function observableOwner(id: number): WebContents & EventEmitter {
  const owner = new EventEmitter() as WebContents & EventEmitter
  Object.assign(owner, {
    id,
    isDestroyed: () => false,
    send: vi.fn(),
  })
  return owner
}

function installExecRoutes(
  state: FakeHostState,
  opts?: {
    createStatus?: number
    createId?: string
    hangAttach?: boolean
    attachStatus?: number
    attachBody?: Buffer
  },
) {
  const createStatus = opts?.createStatus ?? 201
  const createId = opts?.createId ?? 'a1b2c3d4e5f67890abcdef12'
  const hangAttach = opts?.hangAttach !== false
  const attachStatus = opts?.attachStatus ?? 200
  const attachBody = opts?.attachBody ?? Buffer.from('hi', 'utf8')

  state.openImpl = async () => {
    let buf = Buffer.alloc(0)
    let answered = false
    return new Duplex({
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
        const head = buf.subarray(0, sep).toString('utf8')
        const line = head.split('\r\n')[0] || ''
        if (/POST \/containers\/[^/]+\/exec/.test(line)) {
          answered = true
          const body = Buffer.from(JSON.stringify({ Id: createId }))
          if (createStatus >= 400) {
            this.push(
              Buffer.from(
                `HTTP/1.1 ${createStatus} X\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`,
              ),
            )
          } else {
            this.push(
              Buffer.concat([
                Buffer.from(
                  `HTTP/1.1 ${createStatus} Created\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
                ),
                body,
              ]),
            )
          }
          this.push(null)
          cb()
          return
        }
        if (/POST \/exec\/[^/]+\/start/.test(line)) {
          answered = true
          if (attachStatus >= 400) {
            this.push(
              Buffer.from(
                `HTTP/1.1 ${attachStatus} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
              ),
            )
            this.push(null)
            cb()
            return
          }
          const hdr = `HTTP/1.1 ${attachStatus} OK\r\nContent-Type: application/vnd.docker.raw-stream\r\n\r\n`
          this.push(Buffer.concat([Buffer.from(hdr), attachBody]))
          if (!hangAttach) this.push(null)
          cb()
          return
        }
        if (/POST \/exec\/[^/]+\/resize\?/.test(line)) {
          answered = true
          this.push(Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'))
          this.push(null)
          cb()
          return
        }
        if (/GET \/exec\/[^/]+\/json/.test(line)) {
          answered = true
          const body = Buffer.from(JSON.stringify({ Running: false, ExitCode: 0 }))
          this.push(
            Buffer.concat([
              Buffer.from(
                `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
              ),
              body,
            ]),
          )
          this.push(null)
          cb()
          return
        }
        // logs path for isolation test
        if (/\/logs\?/.test(line)) {
          answered = true
          this.push(
            Buffer.from(
              'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n',
            ),
          )
          cb()
          return
        }
        if (/\/containers\/[^/]+\/json/.test(line)) {
          answered = true
          const body = Buffer.from(JSON.stringify({ Id: 'ctr1', Config: { Tty: false } }))
          this.push(
            Buffer.concat([
              Buffer.from(
                `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
              ),
              body,
            ]),
          )
          this.push(null)
          cb()
          return
        }
        cb()
      },
    })
  }
}

const RID = 'b'.repeat(32)

describe('DockerService container exec', () => {
  let svc: DockerService | null = null

  afterEach(() => {
    try {
      svc?.closeAll()
    } catch {}
    svc = null
  })

  it('start binds create+attach to generation and returns terminalId', async () => {
    const { host, state } = createFakeHost()
    installExecRoutes(state, { hangAttach: true })
    svc = new DockerService(host)
    const owner = fakeOwner(7)
    const tid = await svc.startContainerExec(owner, 'sess-a', 'ctr1', {
      shell: 'bash',
      requestId: RID,
      cols: 80,
      rows: 24,
    })
    expect(tid).toMatch(/^[a-f0-9]{32}$/)
    expect(svc.getExecTerminalCount()).toBe(1)
  })

  it('closeSession isolates A resources from B; closeAll then returns all counters and listeners to baseline', async () => {
    const { host, state } = createFakeHost({
      sessions: new Set(['sess-a', 'sess-b']),
      generation: new Map([
        ['sess-a', 1],
        ['sess-b', 1],
      ]),
    })
    installExecRoutes(state, { hangAttach: true })
    svc = new DockerService(host)
    const ownerA = observableOwner(101)
    const ownerB = observableOwner(102)
    const baselineA = ownerA.listenerCount('destroyed')
    const baselineB = ownerB.listenerCount('destroyed')

    await svc.startContainerLogs(ownerA, 'sess-a', 'ctr-a', {
      tail: 200,
      follow: true,
      requestId: 'a'.repeat(32),
    })
    await svc.startContainerExec(ownerA, 'sess-a', 'ctr-a', {
      shell: 'bash', requestId: 'b'.repeat(32), cols: 80, rows: 24,
    })
    await svc.startContainerLogs(ownerB, 'sess-b', 'ctr-b', {
      tail: 200,
      follow: true,
      requestId: 'c'.repeat(32),
    })
    await svc.startContainerExec(ownerB, 'sess-b', 'ctr-b', {
      shell: 'bash', requestId: 'd'.repeat(32), cols: 80, rows: 24,
    })
    expect(svc.getLogStreamCount()).toBe(2)
    expect(svc.getExecTerminalCount()).toBe(2)
    expect(ownerA.listenerCount('destroyed')).toBe(baselineA + 2)
    expect(ownerB.listenerCount('destroyed')).toBe(baselineB + 2)

    svc.closeSession('sess-a')
    svc.closeSession('sess-a')
    expect(svc.getTransport().getActiveEndpoint('sess-a')).toBeNull()
    expect(svc.getTransport().getActiveStreamCount('sess-a')).toBe(0)
    expect(svc.getLogStreamCount()).toBe(1)
    expect(svc.getExecTerminalCount()).toBe(1)
    expect(ownerA.listenerCount('destroyed')).toBe(baselineA)
    expect(svc.getTransport().getActiveEndpoint('sess-b')).not.toBeNull()
    expect(svc.getTransport().getActiveStreamCount('sess-b')).toBeGreaterThan(0)
    expect(ownerB.listenerCount('destroyed')).toBe(baselineB + 2)

    svc.closeAll()
    svc.closeAll()
    expect(svc.getLogStreamCount()).toBe(0)
    expect(svc.getExecTerminalCount()).toBe(0)
    expect(svc.getProbeInflightSize()).toBe(0)
    expect(svc.getActionInflightSize()).toBe(0)
    expect(svc.getTransport().getActiveEndpoint('sess-b')).toBeNull()
    expect(svc.getTransport().getActiveStreamCount('sess-b')).toBe(0)
    expect(ownerB.listenerCount('destroyed')).toBe(baselineB)
  })

  it('20 open/stop cycles return ownership and transport counters to baseline', async () => {
    const { host, state } = createFakeHost()
    installExecRoutes(state, { hangAttach: true })
    svc = new DockerService(host)
    const owner = observableOwner(103)
    const baseline = owner.listenerCount('destroyed')
    for (let i = 0; i < 20; i += 1) {
      const logId = await svc.startContainerLogs(owner, 'sess-a', `log-${i}`, {
        tail: 100,
        follow: true,
        requestId: i.toString(16).padStart(32, '0'),
      })
      const execId = await svc.startContainerExec(owner, 'sess-a', `exec-${i}`, {
        shell: 'sh', requestId: (i + 32).toString(16).padStart(32, '0'), cols: 80, rows: 24,
      })
      expect(svc.stopContainerLogs(owner, logId)).toBe(true)
      expect(svc.stopContainerExec(owner, execId)).toBe(true)
      expect(svc.getLogStreamCount()).toBe(0)
      expect(svc.getExecTerminalCount()).toBe(0)
      expect(owner.listenerCount('destroyed')).toBe(baseline)
      svc.closeSession('sess-a')
      expect(svc.getTransport().getActiveEndpoint('sess-a')).toBeNull()
      expect(svc.getTransport().getActiveStreamCount('sess-a')).toBe(0)
    }
  })

  it('rejects start when generation changes mid-flight', async () => {
    const { host, state } = createFakeHost()
    let opens = 0
    state.openImpl = async () => {
      opens += 1
      if (opens === 1) {
        // create proxy accept — will bump generation before response
        state.generation.set('sess-a', 2)
      }
      return new Duplex({
        read() {},
        write(_c, _e, cb) {
          cb()
        },
      })
    }
    svc = new DockerService(host)
    await expect(
      svc.startContainerExec(fakeOwner(), 'sess-a', 'ctr1', {
        shell: 'bash',
        requestId: RID,
        cols: 80,
        rows: 24,
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/generation-stale|request-failed|proxy/) })
  })

  it('maps create 409 to container-not-running', async () => {
    const { host, state } = createFakeHost()
    installExecRoutes(state, { createStatus: 409 })
    svc = new DockerService(host)
    await expect(
      svc.startContainerExec(fakeOwner(), 'sess-a', 'ctr1', {
        shell: 'bash',
        requestId: RID,
        cols: 80,
        rows: 24,
      }),
    ).rejects.toBeInstanceOf(DockerTransportError)
    try {
      await svc.startContainerExec(fakeOwner(), 'sess-a', 'ctr1', {
        shell: 'bash',
        requestId: RID,
        cols: 80,
        rows: 24,
      })
    } catch (e) {
      expect((e as DockerTransportError).code).toBe('container-not-running')
    }
  })

  it('write/resize/stop require owner and terminalId', async () => {
    const { host, state } = createFakeHost()
    installExecRoutes(state, { hangAttach: true })
    svc = new DockerService(host)
    const owner = fakeOwner(1)
    const other = fakeOwner(2)
    const tid = await svc.startContainerExec(owner, 'sess-a', 'ctr1', {
      shell: 'bash',
      requestId: RID,
      cols: 80,
      rows: 24,
    })
    expect(svc.writeContainerExec(other, tid, 'x')).toBe(false)
    expect(svc.writeContainerExec(owner, 'f'.repeat(32), 'x')).toBe(false)
    expect(svc.writeContainerExec(owner, tid, 'echo hi\n')).toBe(true)
    expect(await svc.resizeContainerExec(other, tid, 100, 30)).toBe(false)
    expect(await svc.resizeContainerExec(owner, tid, 100, 30)).toBe(true)
    // dedupe same size
    expect(await svc.resizeContainerExec(owner, tid, 100, 30)).toBe(true)
    expect(svc.stopContainerExec(other, tid)).toBe(false)
    expect(svc.stopContainerExec(owner, tid)).toBe(true)
    expect(svc.getExecTerminalCount()).toBe(0)
    // idempotent
    expect(svc.stopContainerExec(owner, tid)).toBe(true)
  })

  it('re-start same owner closes previous exec', async () => {
    const { host, state } = createFakeHost()
    installExecRoutes(state, { hangAttach: true })
    svc = new DockerService(host)
    const owner = fakeOwner(3)
    const t1 = await svc.startContainerExec(owner, 'sess-a', 'ctr1', {
      shell: 'bash',
      requestId: RID,
      cols: 80,
      rows: 24,
    })
    const t2 = await svc.startContainerExec(owner, 'sess-a', 'ctr1', {
      shell: 'sh',
      requestId: 'c'.repeat(32),
      cols: 80,
      rows: 24,
    })
    expect(t1).not.toBe(t2)
    expect(svc.getExecTerminalCount()).toBe(1)
    expect(svc.writeContainerExec(owner, t1, 'x')).toBe(false)
    expect(svc.writeContainerExec(owner, t2, 'x')).toBe(true)
  })

  it('session close and closeAll clear exec terminals', async () => {
    const { host, state } = createFakeHost()
    installExecRoutes(state, { hangAttach: true })
    svc = new DockerService(host)
    const owner = fakeOwner(4)
    await svc.startContainerExec(owner, 'sess-a', 'ctr1', {
      shell: 'bash',
      requestId: RID,
      cols: 80,
      rows: 24,
    })
    expect(svc.getExecTerminalCount()).toBe(1)
    svc.closeSession('sess-a')
    expect(svc.getExecTerminalCount()).toBe(0)

    installExecRoutes(state, { hangAttach: true })
    await svc.startContainerExec(owner, 'sess-a', 'ctr1', {
      shell: 'bash',
      requestId: RID,
      cols: 80,
      rows: 24,
    })
    svc.closeAll()
    expect(svc.getExecTerminalCount()).toBe(0)
  })

  it('rejects oversized write payload', async () => {
    const { host, state } = createFakeHost()
    installExecRoutes(state, { hangAttach: true })
    svc = new DockerService(host)
    const owner = fakeOwner(5)
    const tid = await svc.startContainerExec(owner, 'sess-a', 'ctr1', {
      shell: 'bash',
      requestId: RID,
      cols: 80,
      rows: 24,
    })
    const big = 'x'.repeat(64 * 1024 + 1)
    expect(svc.writeContainerExec(owner, tid, big)).toBe(false)
  })

  it('log streams and exec terminals are independent maps', async () => {
    const { host, state } = createFakeHost()
    installExecRoutes(state, { hangAttach: true })
    svc = new DockerService(host)
    const owner = fakeOwner(6)
    const tid = await svc.startContainerExec(owner, 'sess-a', 'ctr1', {
      shell: 'bash',
      requestId: RID,
      cols: 80,
      rows: 24,
    })
    // Start logs for same container (separate ownership)
    const streamId = await svc.startContainerLogs(owner, 'sess-a', 'ctr1', {
      tail: 200,
      follow: true,
      requestId: 'd'.repeat(32),
    })
    expect(svc.getExecTerminalCount()).toBe(1)
    expect(svc.getLogStreamCount()).toBe(1)
    svc.stopContainerExec(owner, tid)
    expect(svc.getExecTerminalCount()).toBe(0)
    expect(svc.getLogStreamCount()).toBe(1)
    svc.stopContainerLogs(owner, streamId)
    expect(svc.getLogStreamCount()).toBe(0)
  })
})
