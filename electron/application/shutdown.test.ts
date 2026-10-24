import { afterEach, expect, it, vi } from 'vitest'
import { createShutdown, installGracefulQuit } from './shutdown'

afterEach(() => vi.useRealTimers())
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

it('stops admission before draining and closes storage only after services finish', async () => {
  const calls: string[] = []
  const work = deferred()
  const shutdown = createShutdown({
    stopServices: () => { expect(shutdown.stopping).toBe(true); calls.push('cancel'); return work.promise },
    stopMonitors: [() => { calls.push('monitors') }], sealServices: () => { calls.push('seal') },
    closeTransports: [() => { calls.push('transports') }], closeStorage: () => { calls.push('storage') }, onError: vi.fn(),
  })
  const stopping = shutdown.stop()
  expect(shutdown.stop()).toBe(stopping)
  expect(calls).toEqual(['cancel', 'monitors'])
  work.resolve()
  await stopping
  expect(calls).toEqual(['cancel', 'monitors', 'seal', 'transports', 'storage'])
})

it('bounds stalled work, seals it before closing storage and isolates teardown failures', async () => {
  vi.useFakeTimers()
  const calls: string[] = []
  const onError = vi.fn()
  const shutdown = createShutdown({
    stopServices: () => new Promise(() => {}), stopMonitors: [() => { throw new Error('monitor') }],
    sealServices: () => { calls.push('seal'); throw new Error('seal') },
    closeTransports: [() => { calls.push('transports'); throw new Error('transport') }, () => { calls.push('db') }],
    closeStorage: () => { calls.push('storage') }, onError, timeoutMs: 50,
  })
  const stopping = shutdown.stop()
  await vi.advanceTimersByTimeAsync(49)
  expect(calls).toEqual([])
  await vi.advanceTimersByTimeAsync(1)
  await stopping
  expect(calls).toEqual(['seal', 'transports', 'db', 'storage'])
  expect(onError.mock.calls.map(([error]) => error.message)).toEqual(['monitor', 'Application shutdown drain timed out', 'seal', 'transport'])
  expect(vi.getTimerCount()).toBe(0)
})

it('honors the update guard and prevents repeated quit events from bypassing the drain', async () => {
  let beforeQuit!: (event: { defaultPrevented: boolean; preventDefault(): void }) => void
  const app = { on: vi.fn((_name, listener) => { beforeQuit = listener }), quit: vi.fn() }
  const work = deferred()
  const shutdown = { stop: vi.fn(() => work.promise) }
  const mark = vi.fn()
  installGracefulQuit(app, shutdown, mark, vi.fn())
  const blocked = { defaultPrevented: true, preventDefault: vi.fn() }
  beforeQuit(blocked)
  expect(shutdown.stop).not.toHaveBeenCalled()
  expect(mark).not.toHaveBeenCalled()
  const event = () => ({ defaultPrevented: false, preventDefault: vi.fn() })
  const first = event(), repeated = event()
  beforeQuit(first); beforeQuit(repeated)
  expect(first.preventDefault).toHaveBeenCalledOnce()
  expect(repeated.preventDefault).toHaveBeenCalledOnce()
  expect(shutdown.stop).toHaveBeenCalledOnce()
  expect(mark).toHaveBeenCalledOnce()
  expect(app.quit).not.toHaveBeenCalled()
  work.resolve()
  await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())
  const final = event()
  beforeQuit(final)
  expect(final.preventDefault).not.toHaveBeenCalled()
})
