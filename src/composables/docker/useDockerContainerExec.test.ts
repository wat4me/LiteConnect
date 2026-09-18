import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import {
  createDockerExecRequestId,
  dockerExecStateI18nKey,
  isDockerExecShell,
  isDockerExecRequestId,
  useDockerContainerExec,
} from './useDockerContainerExec'

function rid(): string {
  return 'a'.repeat(32)
}

describe('dockerExec helpers', () => {
  it('creates valid request ids and validates shell enum', () => {
    expect(createDockerExecRequestId()).toMatch(/^[a-f0-9]{32}$/)
    expect(isDockerExecRequestId(rid())).toBe(true)
    expect(isDockerExecRequestId('short')).toBe(false)
    expect(isDockerExecShell('bash')).toBe(true)
    expect(isDockerExecShell('sh')).toBe(true)
    expect(isDockerExecShell('zsh')).toBe(false)
  })

  it('maps state/error codes to i18n keys', () => {
    expect(dockerExecStateI18nKey('idle')).toBe('docker.terminal.state.idle')
    expect(dockerExecStateI18nKey('connecting')).toBe('docker.terminal.state.connecting')
    expect(dockerExecStateI18nKey('attached', null, 'bash')).toBe(
      'docker.terminal.state.attachedBash',
    )
    expect(dockerExecStateI18nKey('attached', null, 'sh')).toBe(
      'docker.terminal.state.attachedSh',
    )
    expect(dockerExecStateI18nKey('error', 'container-not-running')).toBe(
      'docker.terminal.error.containerNotRunning',
    )
    expect(dockerExecStateI18nKey('error', 'output-overflow')).toBe(
      'docker.terminal.error.outputOverflow',
    )
  })
})

describe('useDockerContainerExec handshake', () => {
  const start = vi.fn()
  const stop = vi.fn()
  const write = vi.fn()
  const resize = vi.fn()
  let dataCb: ((p: unknown) => void) | null = null
  let stateCb: ((p: unknown) => void) | null = null

  beforeEach(() => {
    start.mockReset()
    stop.mockReset()
    write.mockReset()
    resize.mockReset()
    dataCb = null
    stateCb = null
    // @ts-expect-error test stub
    globalThis.window = {
      LiteConnect: {
        dockerStartContainerExec: start,
        dockerStopContainerExec: stop,
        dockerWriteContainerExec: write,
        dockerResizeContainerExec: resize,
        onDockerContainerExecData: (cb: (p: unknown) => void) => {
          dataCb = cb
          return () => {
            dataCb = null
          }
        },
        onDockerContainerExecState: (cb: (p: unknown) => void) => {
          stateCb = cb
          return () => {
            stateCb = null
          }
        },
      },
    }
  })

  afterEach(() => {
    // @ts-expect-error cleanup
    delete globalThis.window
  })

  it('default activate uses bash and requestId; early data is accepted', async () => {
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerExec(sessionId)
    const received: Uint8Array[] = []
    api.setDataHandler((d) => received.push(d))

    let resolveStart: (v: unknown) => void = () => {}
    start.mockImplementation(
      () =>
        new Promise((r) => {
          resolveStart = r
        }),
    )

    const p = api.activate('ctr1', { cols: 80, rows: 24 })
    // wait microtask so start is called
    await Promise.resolve()
    expect(start).toHaveBeenCalled()
    const opts = start.mock.calls[0][2]
    expect(opts.shell).toBe('bash')
    expect(opts.requestId).toMatch(/^[a-f0-9]{32}$/)

    const requestId = opts.requestId
    const early = new TextEncoder().encode('early')
    dataCb?.({
      requestId,
      terminalId: 'pending',
      sequence: 1,
      data: early.buffer.slice(early.byteOffset, early.byteOffset + early.byteLength),
    })
    stateCb?.({
      requestId,
      terminalId: null,
      state: 'attached',
    })

    resolveStart({ ok: true, terminalId: 'e'.repeat(32), requestId })
    await p

    expect(api.live.value).toBe(true)
    expect(api.terminalId.value).toBe('e'.repeat(32))
    expect(received.length).toBeGreaterThanOrEqual(1)
    expect(new TextDecoder().decode(received[0])).toBe('early')
  })

  it('pending deactivate stops late success terminalId', async () => {
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerExec(sessionId)
    let resolveStart: (v: unknown) => void = () => {}
    start.mockImplementation(
      () =>
        new Promise((r) => {
          resolveStart = r
        }),
    )
    stop.mockResolvedValue({ ok: true })

    const p = api.activate('ctr1')
    await Promise.resolve()
    await api.deactivate()
    resolveStart({ ok: true, terminalId: 'f'.repeat(32), requestId: rid() })
    await p
    expect(stop).toHaveBeenCalledWith('f'.repeat(32))
    expect(api.live.value).toBe(false)
  })

  it('write only when attached/live; stale terminal ignored', async () => {
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerExec(sessionId)
    start.mockImplementation(async (_s, _c, opts: { requestId: string }) => ({
      ok: true as const,
      terminalId: '1'.repeat(32),
      requestId: opts.requestId,
    }))
    write.mockResolvedValue({ ok: true })

    await api.activate('ctr1')
    const usedRid = start.mock.calls[0][2].requestId as string
    stateCb?.({
      requestId: usedRid,
      terminalId: '1'.repeat(32),
      state: 'attached',
    })
    expect(api.live.value).toBe(true)

    api.writeInput('ls\n')
    expect(write).toHaveBeenCalledWith('1'.repeat(32), 'ls\n')

    await api.deactivate()
    write.mockClear()
    api.writeInput('nope')
    expect(write).not.toHaveBeenCalled()
  })

  it('retryWithSh uses shell sh only after explicit call', async () => {
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerExec(sessionId)
    start.mockResolvedValue({ ok: true, terminalId: '2'.repeat(32), requestId: rid() })
    await api.activate('ctr1')
    expect(start.mock.calls[0][2].shell).toBe('bash')
    start.mockResolvedValue({ ok: true, terminalId: '3'.repeat(32), requestId: rid() })
    await api.retryWithSh(80, 24)
    expect(start.mock.calls.at(-1)?.[2].shell).toBe('sh')
  })

  it('stale requestId events do not apply', async () => {
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerExec(sessionId)
    const received: Uint8Array[] = []
    api.setDataHandler((d) => received.push(d))
    start.mockResolvedValue({ ok: true, terminalId: '4'.repeat(32), requestId: rid() })
    await api.activate('ctr1')
    const bad = new TextEncoder().encode('stale')
    dataCb?.({
      requestId: '9'.repeat(32),
      terminalId: '9'.repeat(32),
      sequence: 1,
      data: bad.buffer.slice(bad.byteOffset, bad.byteOffset + bad.byteLength),
    })
    expect(received.length).toBe(0)
  })

  it('pending early overflow -> output-overflow error, no truncated flush, late tid stopped', async () => {
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerExec(sessionId)
    const received: Uint8Array[] = []
    api.setDataHandler((d) => received.push(d))

    let resolveStart: (v: unknown) => void = () => {}
    start.mockImplementation(
      () =>
        new Promise((r) => {
          resolveStart = r
        }),
    )
    stop.mockResolvedValue({ ok: true })

    const p = api.activate('ctr1', { cols: 80, rows: 24 })
    await Promise.resolve()
    const opts = start.mock.calls[0][2]
    const requestId = opts.requestId as string

    // Push data exceeding EARLY_MAX_BYTES (512_000) in chunks while still pending.
    const big = new Uint8Array(600_000)
    dataCb?.({
      requestId,
      terminalId: 'pending',
      sequence: 1,
      data: big.buffer.slice(big.byteOffset, big.byteOffset + big.byteLength),
    })

    // State must already be error/output-overflow; UI must not stay connecting.
    expect(api.execState.value).toBe('error')
    expect(api.execErrorCode.value).toBe('output-overflow')
    expect(api.live.value).toBe(false)

    // Late attached event must NOT override the overflow error.
    stateCb?.({ requestId, terminalId: null, state: 'attached' })
    expect(api.execState.value).toBe('error')
    expect(api.execErrorCode.value).toBe('output-overflow')

    // Late success terminalId must be stopped immediately.
    const lateTid = '5'.repeat(32)
    resolveStart({ ok: true, terminalId: lateTid, requestId })
    await p
    await Promise.resolve()
    expect(stop).toHaveBeenCalledWith(lateTid)

    // No truncated/partial bytes were flushed to the data handler.
    expect(received.length).toBe(0)
    expect(api.terminalId.value).toBeNull()
    expect(api.live.value).toBe(false)

    // Late data/state events for the overflow-terminated tid are rejected.
    dataCb?.({
      requestId,
      terminalId: lateTid,
      sequence: 2,
      data: new Uint8Array([1, 2, 3]).buffer,
    })
    stateCb?.({ requestId, terminalId: lateTid, state: 'disconnected' })
    expect(received.length).toBe(0)
    expect(api.execState.value).toBe('error')
    expect(api.execErrorCode.value).toBe('output-overflow')
  })

  it('after overflow, a fresh start can succeed and old events do not pollute', async () => {
    const sessionId = ref<string | null>('sess-1')
    const api = useDockerContainerExec(sessionId)
    const received: Uint8Array[] = []
    api.setDataHandler((d) => received.push(d))

    let resolveFirst: (v: unknown) => void = () => {}
    start.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFirst = r
        }),
    )
    stop.mockResolvedValue({ ok: true })

    const p1 = api.activate('ctr1', { cols: 80, rows: 24 })
    await Promise.resolve()
    const opts1 = start.mock.calls[0][2]
    const rid1 = opts1.requestId as string
    const big = new Uint8Array(600_000)
    dataCb?.({
      requestId: rid1,
      terminalId: 'pending',
      sequence: 1,
      data: big.buffer.slice(big.byteOffset, big.byteOffset + big.byteLength),
    })
    resolveFirst({ ok: true, terminalId: '6'.repeat(32), requestId: rid1 })
    await p1
    await Promise.resolve()
    expect(api.execState.value).toBe('error')
    expect(api.execErrorCode.value).toBe('output-overflow')

    // Fresh start with a new requestId
    start.mockResolvedValue({ ok: true, terminalId: '7'.repeat(32), requestId: rid() })
    await api.retry(80, 24)
    const rid2 = start.mock.calls[1][2].requestId as string
    stateCb?.({ requestId: rid2, terminalId: '7'.repeat(32), state: 'attached' })
    expect(api.execState.value).toBe('attached')
    expect(api.live.value).toBe(true)
    expect(api.terminalId.value).toBe('7'.repeat(32))

    // Old overflow-terminated tid events still rejected
    dataCb?.({
      requestId: rid1,
      terminalId: '6'.repeat(32),
      sequence: 2,
      data: new Uint8Array([9]).buffer,
    })
    expect(received.length).toBe(0)
  })

  it('dispose pairs subscriptions and late events cannot apply after 20 cycles', async () => {
    let dataSubscriptions = 0
    let stateSubscriptions = 0
    let dataUnsubscriptions = 0
    let stateUnsubscriptions = 0
    ;(globalThis as any).window.LiteConnect.onDockerContainerExecData = () => {
      dataSubscriptions += 1
      return () => { dataUnsubscriptions += 1 }
    }
    ;(globalThis as any).window.LiteConnect.onDockerContainerExecState = () => {
      stateSubscriptions += 1
      return () => { stateUnsubscriptions += 1 }
    }
    start.mockImplementation(async (_s, _c, opts: { requestId: string }) => ({
      ok: true, terminalId: 'a'.repeat(32), requestId: opts.requestId,
    }))
    stop.mockResolvedValue({ ok: true })
    const api = useDockerContainerExec(ref<string | null>('sess-1'))
    for (let i = 0; i < 20; i += 1) {
      await api.activate(`ctr${i}`)
      await api.deactivate()
    }
    expect(dataSubscriptions).toBe(1)
    expect(stateSubscriptions).toBe(1)
    api.dispose()
    api.dispose()
    expect(dataUnsubscriptions).toBe(1)
    expect(stateUnsubscriptions).toBe(1)
    expect(api.live.value).toBe(false)
  })
})
