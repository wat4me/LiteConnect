/**
 * Composition root (main process).
 *
 * Construction order (do not casually reorder):
 * 1. Core stores + SSH/DB services needed for the first window
 * 2. Register first-window IPC (store / window / SSH / DB / updater stubs)
 * 3. Open the migrated SQLite store, read the theme, then open the first window.
 * 4. After show: AI key migrations, X11 options, Docker/MCP/AI handler modules
 * 5. Quit: stop admission/cancel → bounded AI/scheduler/HTTP drain → transports → storage
 *
 * Three intentional SSH-related modes (keep separate):
 * - Interactive: SSHManager (shell / SFTP / transfer / X11 / monitor)
 * - Docker host: DockerSshSessionHost → DockerService (socket proxy only)
 * - DB tunnel: DatabaseManager + db/tunnel (dedicated ssh2 client, not shell sessions)
 *
 * See ARCHITECTURE.md.
 */
import { t } from './i18n'
import { app, BrowserWindow, dialog } from 'electron'
import { windowAppId } from './window/appIcon'
import { registerDevelopmentTaskbarShortcut } from './window/developmentTaskbar'
import { registerAppBackgroundScheme, installAppBackgroundProtocol } from './window/appBackgroundProtocol'

registerAppBackgroundScheme()
import { CredentialStore } from './store/credentialStore'
import { SettingsStore } from './store/settingsStore'
import { DbConnectionStore } from './store/dbConnectionStore'
import { DbQueryHistoryStore } from './store/dbQueryHistoryStore'
import { ShellCommandHistoryStore } from './store/shellCommandHistoryStore'
import { DatabaseManager } from './db/manager'
import { SSHManager } from './ssh/manager'
import { MonitorCollector } from './ssh/monitor/monitor'
import { MonitorAlerts } from './ssh/monitor/monitorAlerts'
import { BackgroundMonitor } from './ssh/monitor/backgroundMonitor'
import { KnownHostsStore } from './ssh/trust/knownHosts'
import { SessionLogManager } from './ssh/sessionLog'
import { closeAppDatabase, initializeAppDatabase } from './store/appDatabase'
import { configureDevelopmentUserDataPath } from './store/developmentUserData'
import { createWindow } from './window/createWindow'
import { aiHistoryIdForHost } from './ai/history/historyScope'
import { installCloseToTray, markQuitting, showMainWindow, syncTrayFromSettings } from './window/tray'
import { installSingleInstance } from './window/singleInstance'
import { installUpdateGuard } from './window/updateGuard'
import { registerStoreHandlers } from './ipc/registerStoreHandlers'
import { registerShellCommandHistoryHandlers } from './ipc/registerShellCommandHistoryHandlers'
import { registerSshHandlers, clearLatencyTimers } from './ipc/registerSshHandlers'
import { registerDbHandlers } from './ipc/registerDbHandlers'
import { registerUpdaterHandlers } from './ipc/registerUpdaterHandlers'
import { registerWindowHandlers } from './ipc/registerWindowHandlers'
import { registerAppResourceHandlers } from './ipc/registerAppResourceHandlers'
import {
  broadcast,
  clearOwnersForWebContents,
  getDbWindow,
  getPrimaryWindow,
} from './window/windowRegistry'
import { DeferredServices } from './application/deferredServices'
import { createShutdown, installGracefulQuit } from './application/shutdown'

configureDevelopmentUserDataPath()
const isPrimaryInstance = installSingleInstance(showMainWindow)

// Keep development windows grouped under LiteConnect instead of electron.exe;
// Windows also uses this identity when resolving the taskbar icon.
if (process.platform === 'win32') {
  if (!app.isPackaged) app.setName('LiteConnect Dev')
  app.setAppUserModelId(windowAppId(app.isPackaged))
}

const getMainWindow = () => getPrimaryWindow()
const knownHosts = new KnownHostsStore()
const sessionLog = new SessionLogManager()
const credentialStore = new CredentialStore()
const settingsStore = new SettingsStore()
const dbConnectionStore = new DbConnectionStore()
const dbQueryHistoryStore = new DbQueryHistoryStore()
const shellCommandHistoryStore = new ShellCommandHistoryStore()
const dbManager = new DatabaseManager()
const sshManager = new SSHManager(knownHosts)
let monitorAlerts: MonitorAlerts
let backgroundMonitor: BackgroundMonitor
const monitorCollector = new MonitorCollector(sshManager, (connectionId, data, updated) => {
  if (monitorAlerts?.isPanelOpen(connectionId)) broadcast(`monitor:data:${connectionId}`, data)
  backgroundMonitor?.onSample(connectionId, data, updated)
  try {
    monitorAlerts?.onData(connectionId, data, updated)
  } catch (err) {
    console.warn('[Monitor Alert] evaluation failed:', err)
  }
})
monitorAlerts = new MonitorAlerts(monitorCollector, () => settingsStore.getMonitorIntervalMs(),
  (connectionId) => credentialStore.getConnection(connectionId)?.name || t('notice.serverFallback'), getMainWindow)
backgroundMonitor = new BackgroundMonitor(sshManager, credentialStore, monitorAlerts)
sshManager.registerSessionTeardownHook((sessionId) => {
  monitorAlerts.detach(sessionId)
  backgroundMonitor.sessionTeardown(sessionId)
})

const deferredServices = new DeferredServices({
  settings: settingsStore, credentials: credentialStore, ssh: sshManager, monitor: monitorCollector,
  version: app.getVersion() || '1.0.0',
  historyId: sessionId => {
    const snapshot = sshManager.getSessionSnapshot(sessionId)
    const connection = snapshot && credentialStore.getConnection(snapshot.connectionId)
    return connection ? aiHistoryIdForHost(connection.host, connection.port || 22) : undefined
  },
  schedulesChanged: state => broadcast('ai:schedulesChanged', state),
})
let bootstrap: Promise<void> | undefined
let initialStores: Promise<unknown> | undefined
const shutdown = createShutdown({
  stopServices: () => {
    const services = deferredServices.stop()
    return Promise.allSettled([services, bootstrap, initialStores]).then(() => undefined)
  },
  stopMonitors: [() => backgroundMonitor.dispose(), clearLatencyTimers, () => monitorCollector.stopAll()],
  sealServices: () => deferredServices.seal(),
  closeTransports: [() => sshManager.forceDisconnectAll(), () => dbManager.disconnectAll(), () => sessionLog.endAll()],
  // Keep storage available for the final window-close events. will-quit runs
  // only after the accepted quit resumes, following the bounded drain above.
  closeStorage: () => { app.once('will-quit', closeAppDatabase) },
  onError: error => console.error('[Main Shutdown]', error),
})

// Register this before the general before-quit cleanup below. When an update
// download is active, the guard must get the first chance to cancel quitting.
if (isPrimaryInstance) installUpdateGuard(() => shutdown.stopping)

function openMainWindow(theme?: string, customColors?: { fontColor: string; bgColor: string } | null) {
  if (shutdown.stopping) return
  const resolvedTheme = theme ?? settingsStore.getTheme()
  const resolvedColors =
    customColors !== undefined
      ? customColors
      : resolvedTheme === 'custom'
        ? settingsStore.getCustomColors()
        : null
  createWindow({ theme: resolvedTheme, customColors: resolvedColors, primary: true })
}

function cleanupSessionsForClosedWindow(webContentsId: number) {
  const owned = clearOwnersForWebContents(webContentsId)
  for (const sessionId of owned) {
    try {
      sshManager.disconnect(sessionId)
    } catch (err) {
      console.warn('[Main] disconnect on window close failed:', sessionId, err)
    }
  }
}

app.whenReady().then(() => {
  if (!isPrimaryInstance || shutdown.stopping) return
  bootstrap = initializeMain()
  return bootstrap
}).catch(error => console.error('[Main Init]', error))

async function initializeMain(): Promise<void> {
  registerDevelopmentTaskbarShortcut()
  // This is deliberately the first data operation. Existing JSON/JSONL files are
  // migrated transactionally before any store can read or write the new database.
  try {
    await initializeAppDatabase()
  } catch (error) {
    if (shutdown.stopping) return
    const detail = error instanceof Error ? error.message : String(error)
    console.error('[Main Storage Migration]', error)
    dialog.showErrorBox(
      t('notice.migrationTitle'),
      t('notice.migrationBody', { detail }),
    )
    app.quit()
    return
  }
  if (shutdown.stopping) { closeAppDatabase(); return }
  installAppBackgroundProtocol(() => settingsStore.getAppBackgroundDir())
  // First-window IPC so the renderer can call as soon as the window loads.
  registerStoreHandlers(getMainWindow, credentialStore, settingsStore,
    (connectionId) => {
      monitorAlerts.deleteConnection(connectionId)
      backgroundMonitor.refresh(connectionId)
    },
    (connectionId) => backgroundMonitor.connectionChanged(connectionId))
  registerWindowHandlers(credentialStore, settingsStore, {
    // DB sessions can only be created from the dedicated DB window; drop them
    // when that window closes so they do not leak in the main process.
    onDbWindowClosed: () => {
      try {
        void dbManager.disconnectAll()
      } catch (err) {
        console.warn('[Main] db disconnect on DB window close failed:', err)
      }
    },
    reopenMainWindow: () => openMainWindow(),
  })
  registerShellCommandHistoryHandlers(shellCommandHistoryStore, settingsStore)
  registerSshHandlers(getMainWindow, sshManager, settingsStore, monitorCollector, credentialStore, knownHosts, sessionLog, monitorAlerts, backgroundMonitor)
  dbManager.setTunnelDeps(credentialStore, knownHosts)
  registerDbHandlers(
    dbConnectionStore,
    dbManager,
    dbQueryHistoryStore,
    credentialStore,
    // DB UI lives in the dedicated DB window: route db events / dialogs there.
    () => getDbWindow() ?? getPrimaryWindow(),
  )
  registerAppResourceHandlers({ ssh: sshManager, db: dbManager })
  registerUpdaterHandlers(getMainWindow, settingsStore)

  const themeReady = settingsStore.readThemeForWindow()
  const storesReady = initialStores = Promise.all([
    knownHosts.init(),
    credentialStore.init(),
    dbConnectionStore.init(),
    dbQueryHistoryStore.init(),
    shellCommandHistoryStore.init(),
  ])
  void storesReady.catch(error => console.error('[Main Store Init]', error))

  app.on('browser-window-created', (_e, win) => {
    const webContentsId = win.webContents.id
    win.on('closed', () => {
      cleanupSessionsForClosedWindow(webContentsId)
    })
  })

  let theme = 'dark'
  let customColors: { fontColor: string; bgColor: string } | null = null
  try {
    const peeked = await themeReady
    theme = peeked.theme
    customColors = peeked.customColors
  } catch (err) {
    console.error('[Main Settings Init]', err)
  }

  if (shutdown.stopping) return

  openMainWindow(theme, customColors)
  void storesReady.then(() => { if (!shutdown.stopping) backgroundMonitor.start() }).catch((err) => {
    console.error('[Background Monitor Init]', err)
  })
  void deferredServices.start()

  // Tray / close-to-tray / global hotkey (reacts to settings via syncTrayFromSettings)
  installCloseToTray(settingsStore, () => openMainWindow())
  void settingsStore.init().then(() => {
    if (!shutdown.stopping) syncTrayFromSettings(settingsStore)
  }).catch((err) => {
    console.error('[Main Tray Init]', err)
  })

  app.on('window-all-closed', () => {
    if (shutdown.stopping) return
    backgroundMonitor.stop()
    clearLatencyTimers()
    monitorCollector.stopAll()
    deferredServices.closeWindowSessions()
    sshManager.forceDisconnectAll()
    dbManager.disconnectAll()
    sessionLog.endAll()
    if (process.platform !== 'darwin') {
      app.quit()
    } else {
      void storesReady.then(() => { if (!shutdown.stopping) backgroundMonitor.start() }).catch((err) => {
        console.error('[Background Monitor Restart]', err)
      })
    }
  })

  app.on('activate', () => {
    if (shutdown.stopping) return
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow()
      void storesReady.then(() => { if (!shutdown.stopping) backgroundMonitor.start() })
    } else {
      showMainWindow()
    }
  })
}

app.on('browser-window-blur', () => {
  credentialStore.clearDecryptedCache()
})

installGracefulQuit(app, shutdown, markQuitting, error => console.error('[Main Shutdown]', error))

process.on('unhandledRejection', (reason) => {
  console.error('[Main Unhandled Promise]', reason)
})
