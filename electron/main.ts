import { app, BrowserWindow } from 'electron'
import { CredentialStore } from './store/credentialStore'
import { SettingsStore } from './store/settingsStore'
import { DbConnectionStore } from './store/dbConnectionStore'
import { DbQueryHistoryStore } from './store/dbQueryHistoryStore'
import { ShellCommandHistoryStore } from './store/shellCommandHistoryStore'
import { DatabaseManager } from './db/manager'
import { SSHManager } from './ssh/manager'
import { DockerService } from './docker/service'
import { DockerSshSessionHost } from './docker/sshSessionHost'
import { MonitorCollector } from './ssh/monitor'
import { KnownHostsStore } from './ssh/knownHosts'
import { createWindow } from './window/createWindow'
import { registerStoreHandlers } from './ipc/registerStoreHandlers'
import { registerShellCommandHistoryHandlers } from './ipc/registerShellCommandHistoryHandlers'
import { registerSshHandlers, clearLatencyTimers } from './ipc/registerSshHandlers'
import { registerDockerHandlers } from './ipc/registerDockerHandlers'
import { registerDbHandlers } from './ipc/registerDbHandlers'
import { registerAiHandlers } from './ipc/registerAiHandlers'
import { registerUpdaterHandlers } from './ipc/registerUpdaterHandlers'
import { safeSend } from './utils/validation'

let mainWindow: BrowserWindow | null = null
const getMainWindow = () => mainWindow
const knownHosts = new KnownHostsStore()
const credentialStore = new CredentialStore()
const settingsStore = new SettingsStore()
const dbConnectionStore = new DbConnectionStore()
const dbQueryHistoryStore = new DbQueryHistoryStore()
const shellCommandHistoryStore = new ShellCommandHistoryStore()
const dbManager = new DatabaseManager()
const sshManager = new SSHManager(knownHosts)
const dockerSessionHost = new DockerSshSessionHost(sshManager)
const dockerService = new DockerService(dockerSessionHost)
const monitorCollector = new MonitorCollector(sshManager, (sessionId: string, data: any) => {
  safeSend(mainWindow, `monitor:data:${sessionId}`, data)
})

function openMainWindow() {
  const theme = settingsStore.getTheme()
  const customColors = theme === 'custom' ? settingsStore.getCustomColors() : null
  mainWindow = createWindow(theme, customColors)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  // IPC first so renderer can call handlers as soon as the window loads.
  registerStoreHandlers(getMainWindow, credentialStore, settingsStore)
  registerShellCommandHistoryHandlers(shellCommandHistoryStore)
  registerSshHandlers(getMainWindow, sshManager, settingsStore, monitorCollector, credentialStore, knownHosts)
  registerDockerHandlers(dockerService)
  dbManager.setTunnelDeps(credentialStore, knownHosts)
  registerDbHandlers(
    dbConnectionStore,
    dbManager,
    dbQueryHistoryStore,
    credentialStore,
    getMainWindow,
  )
  registerAiHandlers(settingsStore)
  registerUpdaterHandlers(getMainWindow, settingsStore)

  // Theme only blocks first paint; remaining stores init in parallel after show.
  try {
    await settingsStore.init()
  } catch (err) {
    console.error('[Main Settings Init]', err)
  }

  try {
    const { configureX11ServerOptions } = await import('./ssh/x11Server')
    configureX11ServerOptions({
      autoStart: settingsStore.getX11AutoStartEnabled(),
      executablePath: settingsStore.getX11ServerPath(),
    })
  } catch (err) {
    console.error('[Main X11 Config]', err)
  }

  openMainWindow()

  void Promise.all([
    knownHosts.init(),
    credentialStore.init(),
    dbConnectionStore.init(),
    dbQueryHistoryStore.init(),
    shellCommandHistoryStore.init(),
  ]).catch((err) => {
    console.error('[Main Store Init]', err)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  clearLatencyTimers()
  monitorCollector.stopAll()
  dockerService.closeAll()
  sshManager.forceDisconnectAll()
  dbManager.disconnectAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('browser-window-blur', () => {
  credentialStore.clearDecryptedCache()
})

app.on('before-quit', () => {
  clearLatencyTimers()
  monitorCollector.stopAll()
  dockerService.closeAll()
  sshManager.forceDisconnectAll()
  dbManager.disconnectAll()
})

process.on('unhandledRejection', (reason) => {
  console.error('[Main Unhandled Promise]', reason)
})
