import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appHandlers: new Map<string, (...args: any[]) => any>(),
  windows: [] as FakeWindow[],
  mainWindow: null as FakeWindow | null,
  menuItems: [] as any[],
  quit: vi.fn(),
  hotkey: null as (() => void) | null,
}))

class FakeWindow {
  handlers = new Map<string, (...args: any[]) => any>()
  hide = vi.fn()
  show = vi.fn()
  focus = vi.fn()
  restore = vi.fn()
  isMinimized = vi.fn(() => false)
  isDestroyed = vi.fn(() => false)

  on(name: string, handler: (...args: any[]) => any) {
    this.handlers.set(name, handler)
  }
}

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    on: (name: string, fn: (...args: any[]) => any) => mocks.appHandlers.set(name, fn),
    quit: mocks.quit,
  },
  BrowserWindow: {
    getAllWindows: () => mocks.windows,
  },
  globalShortcut: {
    isRegistered: vi.fn(() => false),
    register: vi.fn((_accelerator, callback) => { mocks.hotkey = callback; return true }),
    unregister: vi.fn(),
  },
  Menu: { buildFromTemplate: vi.fn((items) => { mocks.menuItems = items; return {} }) },
  nativeImage: { createEmpty: vi.fn(() => ({})), createFromPath: vi.fn(() => ({})) },
  Tray: class {
    setToolTip() {}
    setContextMenu() {}
    on() {}
    destroy() {}
  },
}))
vi.mock('../i18n', () => ({ t: (key: string) => key }))
vi.mock('./windowRegistry', () => ({ getMainShellWindow: () => mocks.mainWindow }))

beforeEach(() => {
  vi.resetModules()
  mocks.appHandlers.clear()
  mocks.windows = []
  mocks.mainWindow = null
  mocks.menuItems = []
  mocks.quit.mockClear()
  mocks.hotkey = null
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

it('shows and focuses a hidden window instead of creating another one', async () => {
  const window = new FakeWindow()
  window.isMinimized.mockReturnValue(true)
  mocks.windows = [window]
  mocks.mainWindow = window
  const reopen = vi.fn()
  const { installCloseToTray, showMainWindow } = await import('./tray')
  installCloseToTray({ getCloseToTrayEnabled: () => true } as any, reopen)

  showMainWindow()

  expect(window.restore).toHaveBeenCalledOnce()
  expect(window.show).toHaveBeenCalledOnce()
  expect(window.focus).toHaveBeenCalledOnce()
  expect(reopen).not.toHaveBeenCalled()
})

it('opens a main shell when only a detached window remains', async () => {
  const detached = new FakeWindow()
  mocks.windows = [detached]
  const reopen = vi.fn()
  const { installCloseToTray, showMainWindow } = await import('./tray')
  installCloseToTray({ getCloseToTrayEnabled: () => true } as any, reopen)

  showMainWindow()

  expect(reopen).toHaveBeenCalledOnce()
  expect(detached.show).not.toHaveBeenCalled()
  expect(detached.focus).not.toHaveBeenCalled()
})

it('uses the main shell for the global hotkey even when a detached window is focused', async () => {
  const detached = new FakeWindow()
  mocks.windows = [detached]
  const reopen = vi.fn()
  const store = {
    getCloseToTrayEnabled: () => false,
    getGlobalHotkeyEnabled: () => true,
    getGlobalHotkey: () => 'Ctrl+Alt+L',
  }
  const { installCloseToTray, syncTrayFromSettings } = await import('./tray')
  installCloseToTray(store as any, reopen)
  syncTrayFromSettings(store as any)

  mocks.hotkey!()

  expect(reopen).toHaveBeenCalledOnce()
  expect(detached.hide).not.toHaveBeenCalled()
})

it('keeps close-to-tray active when a tray quit is cancelled before window close', async () => {
  const window = new FakeWindow()
  mocks.windows = [window]
  const store = { getCloseToTrayEnabled: () => true, getGlobalHotkeyEnabled: () => false }
  const { installCloseToTray, syncTrayFromSettings } = await import('./tray')
  installCloseToTray(store as any, vi.fn())
  syncTrayFromSettings(store as any)

  mocks.menuItems.find((item) => item.label === 'tray.quit')!.click()
  expect(mocks.quit).toHaveBeenCalledOnce()

  const preventDefault = vi.fn()
  window.handlers.get('close')!({ preventDefault })
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(window.hide).toHaveBeenCalledOnce()
})
