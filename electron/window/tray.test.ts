import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appHandlers: new Map<string, (...args: any[]) => any>(),
  windows: [] as FakeWindow[],
}))

class FakeWindow {
  handlers = new Map<string, (...args: any[]) => any>()
  hide = vi.fn()
  isDestroyed = vi.fn(() => false)

  on(name: string, handler: (...args: any[]) => any) {
    this.handlers.set(name, handler)
  }
}

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    on: (name: string, fn: (...args: any[]) => any) => mocks.appHandlers.set(name, fn),
  },
  BrowserWindow: {
    getAllWindows: () => mocks.windows,
  },
  globalShortcut: {
    isRegistered: vi.fn(() => false),
    register: vi.fn(() => true),
    unregister: vi.fn(),
  },
  Menu: { buildFromTemplate: vi.fn(() => ({})) },
  nativeImage: { createEmpty: vi.fn(() => ({})), createFromPath: vi.fn(() => ({})) },
  Tray: class {},
}))
vi.mock('../i18n', () => ({ t: (key: string) => key }))

beforeEach(() => {
  vi.resetModules()
  mocks.appHandlers.clear()
  mocks.windows = []
})

it('installs close-to-tray on a window that already exists', async () => {
  const window = new FakeWindow()
  mocks.windows = [window]
  const store = { getCloseToTrayEnabled: () => true }
  const { installCloseToTray } = await import('./tray')

  installCloseToTray(store as any, vi.fn())

  const preventDefault = vi.fn()
  window.handlers.get('close')!({ preventDefault })
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(window.hide).toHaveBeenCalledOnce()
})

it('installs close-to-tray on windows created later', async () => {
  const store = { getCloseToTrayEnabled: () => true }
  const { installCloseToTray } = await import('./tray')
  installCloseToTray(store as any, vi.fn())

  const window = new FakeWindow()
  mocks.appHandlers.get('browser-window-created')!({}, window)
  const preventDefault = vi.fn()
  window.handlers.get('close')!({ preventDefault })

  expect(preventDefault).toHaveBeenCalledOnce()
  expect(window.hide).toHaveBeenCalledOnce()
})

it('allows the window to close when the setting is disabled', async () => {
  const window = new FakeWindow()
  mocks.windows = [window]
  const store = { getCloseToTrayEnabled: () => false }
  const { installCloseToTray } = await import('./tray')
  installCloseToTray(store as any, vi.fn())

  const preventDefault = vi.fn()
  window.handlers.get('close')!({ preventDefault })

  expect(preventDefault).not.toHaveBeenCalled()
  expect(window.hide).not.toHaveBeenCalled()
})

it('allows the window to close during a real app quit', async () => {
  const window = new FakeWindow()
  mocks.windows = [window]
  const store = { getCloseToTrayEnabled: () => true }
  const { installCloseToTray, markQuitting } = await import('./tray')
  installCloseToTray(store as any, vi.fn())
  markQuitting()

  const preventDefault = vi.fn()
  window.handlers.get('close')!({ preventDefault })

  expect(preventDefault).not.toHaveBeenCalled()
  expect(window.hide).not.toHaveBeenCalled()
})
