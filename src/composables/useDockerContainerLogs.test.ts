import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'
import {
  createDockerLogRequestId,
  dockerLogStateI18nKey,
  useDockerContainerLogs,
} from './useDockerContainerLogs'

const startLogs = vi.fn()
const stopLogs = vi.fn()
let dataCb: ((p: unknown) => void) | null = null
let stateCb: ((p: unknown) => void) | null = null

beforeEach(() => {
  startLogs.mockReset()
  stopLogs.mockReset()
  dataCb = null
  stateCb = null
  ;(globalThis as any).window = {
    LiteConnect: {
      dockerStartContainerLogs: (...a: unknown[]) => startLogs(...a),
      dockerStopContainerLogs: (...a: unknown[]) => stopLogs(...a),
      onDockerContainerLogData: (cb: (p: unknown) => void) => {
        dataCb = cb
        return () => {
          dataCb = null
        }
      },
      onDockerContainerLogState: (cb: (p: unknown) => void) => {
        stateCb = cb
        return () => {
          stateCb = null
        }
      },
    },
  }
  // crypto for requestId
  if (!(globalThis as any).crypto?.getRandomValues) {
    ;(globalThis as any).crypto = {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i + 1
        return arr
      },
    }
  }
})

afterEach(() => {
  delete (globalThis as any).window
})

describe('dockerLogStateI18nKey', () => {
  it('maps states and error codes', () => {
    expect(dockerLogStateI18nKey('streaming')).toBe('docker.logs.state.streaming')
    expect(dockerLogStateI18nKey('disconnected')).toBe('docker.logs.state.disconnected')
    expect(dockerLogStateI18nKey('error', 'container-not-found')).toBe(
      'docker.logs.error.containerNotFound',
    )
  })
})

describe('createDockerLogRequestId', () => {
  it('returns 32 hex', () => {
    expect(createDockerLogRequestId()).toMatch(/^[a-f0-9]{32}$/)
  })
})

describe('useDockerContainerLogs', () => {
  it('defaults to tail 200 + follow and starts with requestId', async () => {
    startLogs.mockImplementation(async (_s, _c, opts: { requestId: string }) => ({
      ok: true,
      streamId: 'a'.repeat(32),
      requestId: opts.requestId,
    }))
    const sessionId = ref<string | null>('s1')
    const api = useDockerContainerLogs(sessionId)
    expect(api.tail.value).toBe(200)
    expect(api.follow.value).toBe(true)
    await api.activate('c1')
    expect(startLogs).toHaveBeenCalled()
    const opts = startLogs.mock.calls[0][2]
    expect(opts.tail).toBe(200)
    expect(opts.follow).toBe(true)
    expect(opts.requestId).toMatch(/^[a-f0-9]{32}$/)
    expect(api.streamId.value).toBe('a'.repeat(32))
  })

  it('accepts streaming+data+ended before start Promise resolves', async () => {
    let resolveStart!: (v: unknown) => void
    startLogs.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        }),
    )
    const sessionId = ref<string | null>('s1')
    const api = useDockerContainerLogs(sessionId)
    const p = api.activate('c1')
    await nextTick()
    const requestId = startLogs.mock.calls[0][2].requestId as string
    // Before resolve: early events
    stateCb?.({
      streamId: 'z'.repeat(32),
      requestId,
      state: 'streaming',
    })
    dataCb?.({
      streamId: 'z'.repeat(32),
      requestId,
      entries: [{ sequence: 1, stream: 'stdout', timestamp: null, text: 'early' }],
      droppedFromMain: 0,
    })
    stateCb?.({
      streamId: 'z'.repeat(32),
      requestId,
      state: 'ended',
    })
    expect(api.entries.value).toHaveLength(0) // still pending buffer

    resolveStart({ ok: true, streamId: 'z'.repeat(32), requestId })
    await p
    expect(api.entries.value.map((e) => e.text)).toEqual(['early'])
    expect(api.streamState.value).toBe('ended')
  })

  it('accepts error before start Promise resolves', async () => {
    let resolveStart!: (v: unknown) => void
    startLogs.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        }),
    )
    const sessionId = ref<string | null>('s1')
    const api = useDockerContainerLogs(sessionId)
    const p = api.activate('c1')
    await nextTick()
    const requestId = startLogs.mock.calls[0][2].requestId as string
    stateCb?.({
      streamId: 'e'.repeat(32),
      requestId,
      state: 'error',
      code: 'permission-denied',
    })
    resolveStart({ ok: true, streamId: 'e'.repeat(32), requestId })
    await p
    expect(api.streamState.value).toBe('error')
    expect(api.streamErrorCode.value).toBe('permission-denied')
  })

  it('old pending request early events do not enter new request', async () => {
    let resolve1!: (v: unknown) => void
    startLogs
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolve1 = resolve
          }),
      )
      .mockImplementationOnce(async (_s, _c, opts: { requestId: string }) => ({
        ok: true,
        streamId: 'n'.repeat(32),
        requestId: opts.requestId,
      }))

    const sessionId = ref<string | null>('s1')
    const api = useDockerContainerLogs(sessionId)
    const p1 = api.activate('c1')
    await nextTick()
    const oldRid = startLogs.mock.calls[0][2].requestId as string

    // Cancel first by starting second (generation bump via setTail after first resolves? use deactivate pattern)
    // Force second start by resolving first then setTail — better: call activate again which bumps gen
    resolve1({ ok: true, streamId: 'o'.repeat(32), requestId: oldRid })
    await p1

    // Start new stream
    await api.setTail(500)
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()

    const newRid = startLogs.mock.calls[1][2].requestId as string
    expect(newRid).not.toBe(oldRid)

    // Late old request data
    dataCb?.({
      streamId: 'o'.repeat(32),
      requestId: oldRid,
      entries: [{ sequence: 9, stream: 'stdout', timestamp: null, text: 'stale' }],
      droppedFromMain: 0,
    })
    // Should not include stale if new stream active with different requestId
    // After setTail, buffer was cleared and new stream id is n...
    expect(api.entries.value.find((e) => e.text === 'stale')).toBeUndefined()
  })

  it('deactivate during pending start stops late stream and does not pollute UI', async () => {
    let resolveStart!: (v: unknown) => void
    startLogs.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        }),
    )
    stopLogs.mockResolvedValue({ ok: true })
    const sessionId = ref<string | null>('s1')
    const api = useDockerContainerLogs(sessionId)
    const p = api.activate('c1')
    await nextTick()
    const requestId = startLogs.mock.calls[0][2].requestId as string
    dataCb?.({
      streamId: 'late'.padEnd(32, '0').slice(0, 32),
      requestId,
      entries: [{ sequence: 1, stream: 'stdout', timestamp: null, text: 'should-not-show' }],
      droppedFromMain: 0,
    })
    await api.deactivate()
    resolveStart({
      ok: true,
      streamId: 'late'.padEnd(32, '0').slice(0, 32),
      requestId,
    })
    await p
    expect(stopLogs).toHaveBeenCalled()
    expect(api.entries.value.find((e) => e.text === 'should-not-show')).toBeUndefined()
    expect(api.active.value).toBe(false)
  })

  it('merges main dropped into UI dropped count; clear resets', async () => {
    startLogs.mockImplementation(async (_s, _c, opts: { requestId: string }) => ({
      ok: true,
      streamId: 'm'.repeat(32),
      requestId: opts.requestId,
    }))
    const sessionId = ref<string | null>('s1')
    const api = useDockerContainerLogs(sessionId)
    await api.activate('c1')
    const requestId = startLogs.mock.calls[0][2].requestId as string
    dataCb?.({
      streamId: 'm'.repeat(32),
      requestId,
      entries: [{ sequence: 1, stream: 'stdout', timestamp: null, text: 'x' }],
      droppedFromMain: 7,
    })
    expect(api.droppedCount.value).toBe(7)
    api.clearLogs()
    expect(api.droppedCount.value).toBe(0)
    expect(api.entries.value).toHaveLength(0)
    expect(stopLogs).not.toHaveBeenCalled()
  })

  it('switching tail restarts with single active stream', async () => {
    startLogs
      .mockImplementationOnce(async (_s, _c, opts: { requestId: string }) => ({
        ok: true,
        streamId: '1'.repeat(32),
        requestId: opts.requestId,
      }))
      .mockImplementationOnce(async (_s, _c, opts: { requestId: string }) => ({
        ok: true,
        streamId: '2'.repeat(32),
        requestId: opts.requestId,
      }))
    stopLogs.mockResolvedValue({ ok: true })
    const sessionId = ref<string | null>('s1')
    const api = useDockerContainerLogs(sessionId)
    await api.activate('c1')
    api.setTail(500)
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()
    expect(stopLogs).toHaveBeenCalledWith('1'.repeat(32))
    expect(api.streamId.value).toBe('2'.repeat(32))
  })

  it('pause auto-scroll still receives logs', async () => {
    startLogs.mockImplementation(async (_s, _c, opts: { requestId: string }) => ({
      ok: true,
      streamId: 'e'.repeat(32),
      requestId: opts.requestId,
    }))
    const sessionId = ref<string | null>('s1')
    const api = useDockerContainerLogs(sessionId)
    await api.activate('c1')
    const requestId = startLogs.mock.calls[0][2].requestId as string
    api.setAutoScroll(false)
    dataCb?.({
      streamId: 'e'.repeat(32),
      requestId,
      entries: [{ sequence: 1, stream: 'stderr', timestamp: null, text: 'x' }],
      droppedFromMain: 0,
    })
    expect(api.entries.value).toHaveLength(1)
    expect(api.autoScroll.value).toBe(false)
  })

  it('dispose pairs subscriptions and 20 activate/deactivate cycles retain no listeners', async () => {
    let dataSubscriptions = 0
    let stateSubscriptions = 0
    let dataUnsubscriptions = 0
    let stateUnsubscriptions = 0
    ;(globalThis as any).window.LiteConnect.onDockerContainerLogData = () => {
      dataSubscriptions += 1
      return () => { dataUnsubscriptions += 1 }
    }
    ;(globalThis as any).window.LiteConnect.onDockerContainerLogState = () => {
      stateSubscriptions += 1
      return () => { stateUnsubscriptions += 1 }
    }
    startLogs.mockImplementation(async (_s, _c, opts: { requestId: string }) => ({
      ok: true, streamId: 'a'.repeat(32), requestId: opts.requestId,
    }))
    stopLogs.mockResolvedValue({ ok: true })
    const api = useDockerContainerLogs(ref<string | null>('s1'))
    for (let i = 0; i < 20; i += 1) {
      await api.activate(`c${i}`)
      await api.deactivate()
    }
    expect(dataSubscriptions).toBe(1)
    expect(stateSubscriptions).toBe(1)
    api.dispose()
    api.dispose()
    expect(dataUnsubscriptions).toBe(1)
    expect(stateUnsubscriptions).toBe(1)
    expect(api.active.value).toBe(false)
  })
})
