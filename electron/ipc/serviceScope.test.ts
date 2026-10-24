import { expect, it, vi } from 'vitest'
import { ServiceIpcScope } from './serviceScope'

const mocks = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: mocks }))

it('removes only owned handlers, rejects queued/late calls and waits for accepted calls', async () => {
  const scope = new ServiceIpcScope()
  let finish!: () => void
  const handler = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  scope.handle('service:run', handler)
  const invoke = mocks.handle.mock.calls.at(-1)![1]
  const pending = invoke({})
  await Promise.resolve()
  let drained = false
  scope.dispose()
  scope.dispose()
  expect(scope.signal.aborted).toBe(true)
  expect(mocks.removeHandler).toHaveBeenCalledExactlyOnceWith('service:run')
  expect(() => invoke({})).toThrow('stopping')
  expect(() => scope.handle('other', handler)).toThrow('stopping')
  const idle = scope.waitForIdle().then(() => { drained = true })
  await Promise.resolve()
  expect(drained).toBe(false)
  finish()
  await pending; await idle
  expect(drained).toBe(true)

  const queued = new ServiceIpcScope()
  queued.handle('service:queued', handler)
  const call = mocks.handle.mock.calls.at(-1)![1]({})
  queued.dispose()
  await expect(call).rejects.toThrow('stopping')
  expect(handler).toHaveBeenCalledOnce()
})
