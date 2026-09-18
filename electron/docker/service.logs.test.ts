import { afterEach, describe, expect, it, vi } from 'vitest'
import { Duplex } from 'stream'
import { DockerService, isValidDockerLogStreamId } from './service'
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

function muxFrame(type: 1 | 2, text: string): Buffer {
  const p = Buffer.from(text, 'utf8')
  const h = Buffer.alloc(8)
  h[0] = type
  h.writeUInt32BE(p.length, 4)
  return Buffer.concat([h, p])
}

/**
 * openImpl: inspect/json answers immediately; logs hang (keeps ownership for lifecycle tests)
 * unless hangLogs is false.
 */
function installInspectAndLogs(
  state: FakeHostState,
  opts?: {
    inspectStatus?: number
    tty?: boolean
    logsBody?: Buffer
    initialLogBody?: Buffer
    logsStatus?: number
    hangLogs?: boolean
  },
) {
  const inspectStatus = opts?.inspectStatus ?? 200
  const tty = opts?.tty ?? false
  const logsStatus = opts?.logsStatus ?? 200
  const hangLogs = opts?.hangLogs !== false
  const logsBody =
    opts?.logsBody ?? muxFrame(1, '2024-01-01T00:00:00Z hello\n')
  const initialLogBody = opts?.initialLogBody

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
        if (/\/containers\/[^/]+\/json/.test(line)) {
          answered = true
          const res =
            inspectStatus !== 200
              ? { status: inspectStatus, body: Buffer.from('{}') }
              : {
                  status: 200,
                  body: Buffer.from(
                    JSON.stringify({
                      Id: 'ctr1',
                      Config: { Tty: tty },
                    }),
                  ),
                }
          const statusText = res.status === 404 ? 'Not Found' : 'OK'
          this.push(
            Buffer.concat([
              Buffer.from(
                `HTTP/1.1 ${res.status} ${statusText}\r\nContent-Length: ${res.body.length}\r\nConnection: close\r\n\r\n`,
              ),
              res.body,
            ]),
          )
          this.push(null)
          cb()
          return
        }
        if (/\/logs\?/.test(line)) {
          if (hangLogs) {
            // Keep connection open (follow); ownership stays until stop.
            answered = true
            const hdr =
              `HTTP/1.1 ${logsStatus} OK\r\n` +
              `Transfer-Encoding: chunked\r\n` +
              `Connection: close\r\n\r\n`
            if (logsStatus >= 400) {
              this.push(
                Buffer.from(
                  `HTTP/1.1 ${logsStatus} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
                ),
              )
              this.push(null)
            } else {
              this.push(Buffer.from(hdr))
              if (initialLogBody?.length) {
                this.push(
                  Buffer.concat([
                    Buffer.from(`${initialLogBody.length.toString(16)}\r\n`),
                    initialLogBody,
                    Buffer.from('\r\n'),
                  ]),
                )
              }
              // do not end — hang
            }
            cb()
            return
          }
          answered = true
          const bodyBuf = logsBody
          this.push(
            Buffer.concat([
              Buffer.from(
                `HTTP/1.1 ${logsStatus} OK\r\nContent-Length: ${bodyBuf.length}\r\nConnection: close\r\n\r\n`,
              ),
              bodyBuf,
            ]),
          )
          this.push(null)
          cb()
          return
        }
        answered = true
        this.push(Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK'))
        this.push(null)
        cb()
      },
    }) as NodeJS.ReadWriteStream
  }
}

function createOwner(id: number): WebContents {
  const handlers = new Map<string, Function[]>()
  return {
    id,
    isDestroyed: () => false,
    once(event: string, fn: Function) {
      const list = handlers.get(event) || []
      list.push(fn)
      handlers.set(event, list)
    },
    removeListener(event: string, fn: Function) {
      const list = handlers.get(event) || []
      handlers.set(
        event,
        list.filter((x) => x !== fn),
      )
    },
    send: vi.fn(),
  } as unknown as WebContents
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

describe('isValidDockerLogStreamId', () => {
  it('accepts 32 lowercase hex only', () => {
    expect(isValidDockerLogStreamId('a'.repeat(32))).toBe(true)
    expect(isValidDockerLogStreamId('A'.repeat(32))).toBe(false)
    expect(isValidDockerLogStreamId('short')).toBe(false)
  })
})

describe('DockerService container logs lifecycle', () => {
  it('start returns streamId; stop is idempotent; resources clear', async () => {
    const { host, state } = createFakeHost()
    installInspectAndLogs(state)
    const svc = new DockerService(host)
    services.push(svc)
    const owner = createOwner(1)

    const streamId = await svc.startContainerLogs(owner, 'sess-a', 'ctr1', {
      tail: 200,
      follow: false,
      requestId: 'a'.repeat(32),
    })
    expect(streamId).toMatch(/^[a-f0-9]{32}$/)
    expect(svc.getLogStreamCount()).toBe(1)

    expect(svc.stopContainerLogs(owner, streamId)).toBe(true)
    expect(svc.stopContainerLogs(owner, streamId)).toBe(true)
    expect(svc.getLogStreamCount()).toBe(0)
  })

  it('clears a queued log flush on close so no late data/state is sent', async () => {
    const { host, state } = createFakeHost()
    installInspectAndLogs(state, { initialLogBody: muxFrame(1, 'queued\n') })
    const svc = new DockerService(host)
    services.push(svc)
    const owner = createOwner(99)
    const streamId = await svc.startContainerLogs(owner, 'sess-a', 'ctr1', {
      tail: 200,
      follow: true,
      requestId: '9'.repeat(32),
    })
    // Give the HTTP parser a microtask to enqueue the batch timer, then close it.
    await Promise.resolve()
    expect(svc.stopContainerLogs(owner, streamId)).toBe(true)
    // stop emits one terminal state synchronously; the queued data timer must not emit later.
    const sendsAfterClose = (owner.send as ReturnType<typeof vi.fn>).mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect((owner.send as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(sendsAfterClose)
    expect(svc.getLogStreamCount()).toBe(0)
  })

  it('replacing stream for same container closes old stream', async () => {
    const { host, state } = createFakeHost()
    installInspectAndLogs(state)
    const svc = new DockerService(host)
    services.push(svc)
    const owner = createOwner(2)

    const id1 = await svc.startContainerLogs(owner, 'sess-a', 'ctr1', {
      tail: 100,
      follow: false,
      requestId: 'b'.repeat(32),
    })
    const id2 = await svc.startContainerLogs(owner, 'sess-a', 'ctr1', {
      tail: 500,
      follow: false,
      requestId: 'c'.repeat(32),
    })
    expect(id1).not.toBe(id2)
    expect(svc.getLogStreamCount()).toBe(1)
    svc.stopContainerLogs(owner, id2)
    expect(svc.getLogStreamCount()).toBe(0)
  })

  it('A/B containers concurrent; stop A does not affect B', async () => {
    const { host, state } = createFakeHost()
    installInspectAndLogs(state)
    const svc = new DockerService(host)
    services.push(svc)
    const owner = createOwner(3)

    const a = await svc.startContainerLogs(owner, 'sess-a', 'ctrA', {
      tail: 200,
      follow: false,
      requestId: 'd'.repeat(32),
    })
    const b = await svc.startContainerLogs(owner, 'sess-a', 'ctrB', {
      tail: 200,
      follow: false,
      requestId: 'e'.repeat(32),
    })
    expect(svc.getLogStreamCount()).toBe(2)
    svc.stopContainerLogs(owner, a)
    expect(svc.getLogStreamCount()).toBe(1)
    svc.stopContainerLogs(owner, b)
    expect(svc.getLogStreamCount()).toBe(0)
  })

  it('rejects cross-owner stop', async () => {
    const { host, state } = createFakeHost()
    installInspectAndLogs(state)
    const svc = new DockerService(host)
    services.push(svc)
    const o1 = createOwner(10)
    const o2 = createOwner(11)
    const id = await svc.startContainerLogs(o1, 'sess-a', 'ctr1', {
      tail: 200,
      follow: false,
      requestId: 'f'.repeat(32),
    })
    expect(svc.stopContainerLogs(o2, id)).toBe(false)
    expect(svc.getLogStreamCount()).toBe(1)
    svc.stopContainerLogs(o1, id)
  })

  it('session teardown and closeAll clear log streams', async () => {
    const { host, state } = createFakeHost()
    installInspectAndLogs(state)
    const svc = new DockerService(host)
    services.push(svc)
    const owner = createOwner(4)
    await svc.startContainerLogs(owner, 'sess-a', 'ctr1', {
      tail: 200,
      follow: false,
      requestId: '1'.repeat(32),
    })
    expect(svc.getLogStreamCount()).toBe(1)

    state.sessions.delete('sess-a')
    for (const h of state.hooks) h('sess-a')
    expect(svc.getLogStreamCount()).toBe(0)

    state.sessions.add('sess-a')
    await svc.startContainerLogs(owner, 'sess-a', 'ctr1', {
      tail: 200,
      follow: false,
      requestId: '2'.repeat(32),
    })
    expect(svc.getLogStreamCount()).toBe(1)
    svc.closeAll()
    expect(svc.getLogStreamCount()).toBe(0)
  })

  it('start failure (container not found) leaves no residual stream', async () => {
    const { host, state } = createFakeHost()
    installInspectAndLogs(state, { inspectStatus: 404 })
    const svc = new DockerService(host)
    services.push(svc)
    const owner = createOwner(5)
    await expect(
      svc.startContainerLogs(owner, 'sess-a', 'missing', {
        tail: 200,
        follow: false,
        requestId: '3'.repeat(32),
      }),
    ).rejects.toMatchObject({ code: 'container-not-found' })
    expect(svc.getLogStreamCount()).toBe(0)
  })

  it('invalid options throw before ownership', async () => {
    const { host } = createFakeHost()
    const svc = new DockerService(host)
    services.push(svc)
    const owner = createOwner(6)
    await expect(
      svc.startContainerLogs(owner, 'sess-a', 'ctr1', {
        tail: 50 as any,
        follow: true,
        requestId: '4'.repeat(32),
      }),
    ).rejects.toBeInstanceOf(DockerTransportError)
    expect(svc.getLogStreamCount()).toBe(0)
  })
})
