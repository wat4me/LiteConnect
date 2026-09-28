import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => void>(),
  lockGranted: true,
  quit: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: () => mocks.lockGranted,
    quit: mocks.quit,
    on: (name: string, handler: (...args: any[]) => void) => mocks.handlers.set(name, handler),
  },
}))

beforeEach(() => {
  vi.resetModules()
  mocks.handlers.clear()
  mocks.lockGranted = true
  mocks.quit.mockClear()
})

it('restores the existing window when another launch reaches the primary instance', async () => {
  const { installSingleInstance } = await import('./singleInstance')
  const restore = vi.fn()

  expect(installSingleInstance(restore)).toBe(true)
  mocks.handlers.get('second-instance')!()

  expect(restore).toHaveBeenCalledOnce()
  expect(mocks.quit).not.toHaveBeenCalled()
})

it('quits a second process before it can create a window', async () => {
  mocks.lockGranted = false
  const { installSingleInstance } = await import('./singleInstance')
  const restore = vi.fn()

  expect(installSingleInstance(restore)).toBe(false)
  expect(mocks.quit).toHaveBeenCalledOnce()
  expect(mocks.handlers.has('second-instance')).toBe(false)
})
