import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, ((...args: any[]) => void)[]>(), initialize: vi.fn(), theme: vi.fn(),
  createWindow: vi.fn(), closeStorage: vi.fn(), registerStore: vi.fn(), registerWindow: vi.fn(),
  monitorStart: vi.fn(), monitorDispose: vi.fn(), sshClose: vi.fn(), dbClose: vi.fn(), logEnd: vi.fn(),
  deferredStart: vi.fn(), deferredStop: vi.fn(), deferredSeal: vi.fn(), tray: vi.fn(), markQuitting: vi.fn(), quit: vi.fn(),
  stores: vi.fn(async () => {}),
}))
vi.mock('electron', () => ({
  app: { whenReady: async () => {}, on: (name: string, listener: (...args: any[]) => void) => {
    const group = mocks.handlers.get(name) || []; group.push(listener); mocks.handlers.set(name, group)
  }, once: (name: string, listener: (...args: any[]) => void) => {
    const group = mocks.handlers.get(name) || []; group.push(listener); mocks.handlers.set(name, group)
  }, getVersion: () => 'test', setName: vi.fn(), setAppUserModelId: vi.fn(), quit: mocks.quit },
  BrowserWindow: { getAllWindows: () => [] }, dialog: { showErrorBox: vi.fn() }, ipcMain: {},
}))
vi.mock('./window/appIcon', () => ({ windowAppId: () => 'test' }))
vi.mock('./window/developmentTaskbar', () => ({ registerDevelopmentTaskbarShortcut: vi.fn() }))
vi.mock('./window/appBackgroundProtocol', () => ({ registerAppBackgroundScheme: vi.fn(), installAppBackgroundProtocol: vi.fn() }))
vi.mock('./store/credentialStore', () => ({ CredentialStore: class { init = mocks.stores } }))
vi.mock('./store/settingsStore', () => ({ SettingsStore: class { readThemeForWindow = mocks.theme; init = async () => {} } }))
vi.mock('./store/dbConnectionStore', () => ({ DbConnectionStore: class { init = mocks.stores } }))
vi.mock('./store/dbQueryHistoryStore', () => ({ DbQueryHistoryStore: class { init = mocks.stores } }))
vi.mock('./store/shellCommandHistoryStore', () => ({ ShellCommandHistoryStore: class { init = mocks.stores } }))
vi.mock('./store/developmentUserData', () => ({ configureDevelopmentUserDataPath: vi.fn() }))
vi.mock('./store/appDatabase', () => ({ initializeAppDatabase: mocks.initialize, closeAppDatabase: mocks.closeStorage }))
vi.mock('./db/manager', () => ({ DatabaseManager: class { disconnectAll = mocks.dbClose; setTunnelDeps = vi.fn() } }))
vi.mock('./ssh/manager', () => ({ SSHManager: class { forceDisconnectAll = mocks.sshClose; registerSessionTeardownHook = vi.fn() } }))
vi.mock('./ssh/trust/knownHosts', () => ({ KnownHostsStore: class { init = mocks.stores } }))
vi.mock('./ssh/sessionLog', () => ({ SessionLogManager: class { endAll = mocks.logEnd } }))
vi.mock('./ssh/monitor/monitor', () => ({ MonitorCollector: class { stopAll = vi.fn() } }))
vi.mock('./ssh/monitor/monitorAlerts', () => ({ MonitorAlerts: class {} }))
vi.mock('./ssh/monitor/backgroundMonitor', () => ({ BackgroundMonitor: class {
  start = mocks.monitorStart; dispose = mocks.monitorDispose; stop = vi.fn()
} }))
vi.mock('./window/createWindow', () => ({ createWindow: mocks.createWindow }))
vi.mock('./window/tray', () => ({ installCloseToTray: mocks.tray, markQuitting: mocks.markQuitting, showMainWindow: vi.fn(), syncTrayFromSettings: vi.fn() }))
vi.mock('./window/singleInstance', () => ({ installSingleInstance: () => true }))
vi.mock('./window/updateGuard', () => ({ installUpdateGuard: () => {
  mocks.handlers.set('before-quit', [(event) => { if (event.blocked) event.defaultPrevented = true }])
} }))
vi.mock('./window/windowRegistry', () => ({ broadcast: vi.fn(), clearOwnersForWebContents: () => [], getDbWindow: vi.fn(), getPrimaryWindow: vi.fn() }))
vi.mock('./ipc/registerStoreHandlers', () => ({ registerStoreHandlers: mocks.registerStore }))
vi.mock('./ipc/registerWindowHandlers', () => ({ registerWindowHandlers: mocks.registerWindow }))
vi.mock('./ipc/registerShellCommandHistoryHandlers', () => ({ registerShellCommandHistoryHandlers: vi.fn() }))
vi.mock('./ipc/registerSshHandlers', () => ({ registerSshHandlers: vi.fn(), clearLatencyTimers: vi.fn() }))
vi.mock('./ipc/registerDbHandlers', () => ({ registerDbHandlers: vi.fn() }))
vi.mock('./ipc/registerUpdaterHandlers', () => ({ registerUpdaterHandlers: vi.fn() }))
vi.mock('./ipc/registerAppResourceHandlers', () => ({ registerAppResourceHandlers: vi.fn() }))
vi.mock('./application/deferredServices', () => ({ DeferredServices: class {
  start = mocks.deferredStart; stop = mocks.deferredStop; seal = mocks.deferredSeal
} }))

let rejectionListeners: NodeJS.UnhandledRejectionListener[]
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.handlers.clear()
  mocks.initialize.mockResolvedValue(undefined)
  mocks.theme.mockResolvedValue({ theme: 'dark', customColors: null })
  mocks.deferredStop.mockResolvedValue(undefined)
  mocks.stores.mockResolvedValue(undefined)
  rejectionListeners = process.listeners('unhandledRejection')
})
afterEach(() => {
  for (const listener of process.listeners('unhandledRejection')) if (!rejectionListeners.includes(listener)) process.removeListener('unhandledRejection', listener)
})
function quit(blocked = false) {
  const event = { blocked, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
  for (const listener of mocks.handlers.get('before-quit') || []) listener(event)
  return event
}

it('does not register handlers or open a window when quitting during database initialization', async () => {
  let finish!: () => void
  mocks.initialize.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  await import('./main')
  await vi.waitFor(() => expect(mocks.initialize).toHaveBeenCalledOnce())
  expect(quit().defaultPrevented).toBe(true)
  expect(mocks.closeStorage).not.toHaveBeenCalled()
  finish()
  await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledOnce())
  expect(mocks.createWindow).not.toHaveBeenCalled()
  expect(mocks.registerStore).not.toHaveBeenCalled()
  expect(mocks.deferredStart).not.toHaveBeenCalled()
})

it('cannot start a window, tray or background monitor from a theme response arriving during shutdown', async () => {
  let finish!: () => void
  mocks.theme.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ theme: 'dark', customColors: null }) }))
  await import('./main')
  await vi.waitFor(() => expect(mocks.theme).toHaveBeenCalledOnce())
  quit()
  finish()
  await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledOnce())
  expect(mocks.createWindow).not.toHaveBeenCalled()
  expect(mocks.tray).not.toHaveBeenCalled()
  expect(mocks.monitorStart).not.toHaveBeenCalled()
  expect(mocks.deferredStart).not.toHaveBeenCalled()
})

it('honors the earlier update guard and drains services before independent transport and storage teardown', async () => {
  let finish!: () => void
  mocks.deferredStop.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  await import('./main')
  await vi.waitFor(() => expect(mocks.createWindow).toHaveBeenCalledOnce())
  quit(true)
  expect(mocks.deferredStop).not.toHaveBeenCalled()
  expect(mocks.markQuitting).not.toHaveBeenCalled()
  quit(); quit()
  expect(mocks.deferredStop).toHaveBeenCalledOnce()
  expect(mocks.sshClose).not.toHaveBeenCalled()
  expect(mocks.closeStorage).not.toHaveBeenCalled()
  finish()
  await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledOnce())
  expect(mocks.sshClose).toHaveBeenCalledOnce()
  expect(mocks.dbClose).toHaveBeenCalledOnce()
  expect(mocks.logEnd).toHaveBeenCalledOnce()
  expect(mocks.closeStorage).not.toHaveBeenCalled()
  for (const listener of mocks.handlers.get('will-quit') || []) listener()
  expect(mocks.closeStorage).toHaveBeenCalledOnce()
  expect(mocks.deferredSeal.mock.invocationCallOrder[0]).toBeLessThan(mocks.sshClose.mock.invocationCallOrder[0])
  expect(mocks.logEnd.mock.invocationCallOrder[0]).toBeLessThan(mocks.closeStorage.mock.invocationCallOrder.at(-1)!)
  expect(quit().defaultPrevented).toBe(false)
  mocks.registerWindow.mock.calls[0][2].reopenMainWindow()
  for (const listener of mocks.handlers.get('activate') || []) listener()
  expect(mocks.createWindow).toHaveBeenCalledOnce()
})
