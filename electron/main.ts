/**
 * Composition root (main process).
 *
 * Construction order (do not casually reorder):
 * 1. Core stores + SSH/DB services needed for the first window
 * 2. Register first-window IPC (store / window / SSH / DB / updater stubs)
 * 3. Open the migrated SQLite store, read the theme, then open the first window.
 * 4. After show: AI key migrations, X11 options, Docker/MCP/AI handler modules
 * 5. Quit / window-close teardown: monitors → docker → ssh sessions → db → MCP HTTP
 *
 * Three intentional SSH-related modes (keep separate):
 * - Interactive: SSHManager (shell / SFTP / transfer / X11 / monitor)
 * - Docker host: DockerSshSessionHost → DockerService (socket proxy only)
 * - DB tunnel: DatabaseManager + db/tunnel (dedicated ssh2 client, not shell sessions)
 *
 * See ARCHITECTURE.md.
 */
import { app, BrowserWindow, dialog } from 'electron'
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
import { KnownHostsStore } from './ssh/trust/knownHosts'
import { SessionLogManager } from './ssh/sessionLog'
import { closeAppDatabase, initializeAppDatabase } from './store/appDatabase'
import { configureDevelopmentUserDataPath } from './store/developmentUserData'
import { createWindow } from './window/createWindow'
import { aiHistoryIdForHost } from './ai/historyScope'
import { installCloseToTray, markQuitting, syncTrayFromSettings } from './window/tray'
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
import type { McpHttpGateway } from './mcp/httpGateway'

configureDevelopmentUserDataPath()

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
const monitorCollector = new MonitorCollector(sshManager, (sessionId: string, data: any) => {
  broadcast(`monitor:data:${sessionId}`, data)
})

let dockerCloser: { closeAll: () => void } | null = null
let mcpHttpGateway: McpHttpGateway | null = null
let deferredMain: Promise<void> | null = null

function openMainWindow(theme?: string, customColors?: { fontColor: string; bgColor: string } | null) {
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

function startDeferredMain(): Promise<void> {
  if (!deferredMain) {
    deferredMain = loadDeferredMain().catch((err) => {
      console.error('[Main Deferred]', err)
    })
  }
  return deferredMain
}

async function loadDeferredMain(): Promise<void> {
  try {
    await settingsStore.initMigrations()
  } catch (err) {
    console.error('[Main Settings Migration]', err)
  }

  const x11P = (async () => {
    try {
      const { configureX11ServerOptions } = await import('./ssh/x11/x11Server')
      configureX11ServerOptions({
        autoStart: settingsStore.getX11AutoStartEnabled(),
        executablePath: settingsStore.getX11ServerPath(),
      })
    } catch (err) {
      console.error('[Main X11 Config]', err)
    }
  })()

  // The command classifier gets its AST engine here. Without it the classifier
  // silently falls back to text splitting, which cannot see inside `$()`,
  // `bash -c` or heredocs — so a failure is worth a loud log.
  const bashAstP = (async () => {
    try {
      const { initBashAst } = await import('./mcp/bashParser')
      const status = await initBashAst()
      if (!status.ok) console.error('[Main Bash AST] classifier degraded to text mode:', status.reason)
    } catch (err) {
      console.error('[Main Bash AST]', err)
    }
  })()

  const dockerP = (async () => {
    const { DockerSshSessionHost } = await import('./docker/sshSessionHost')
    const { DockerService } = await import('./docker/service')
    const { registerDockerHandlers } = await import('./ipc/registerDockerHandlers')
    const dockerService = new DockerService(new DockerSshSessionHost(sshManager))
    dockerCloser = dockerService
    registerDockerHandlers(dockerService)
  })()

  const mcpAiP = (async () => {
    const { bindSshMcpRuntime } = await import('./mcp/bind')
    const { createMcpAuditLog } = await import('./mcp/auditLog')
    const { McpHttpGateway } = await import('./mcp/httpGateway')
    const { registerMcpHandlers } = await import('./ipc/registerMcpHandlers')
    const { registerAiHandlers } = await import('./ipc/registerAiHandlers')

    const sshMcpRuntime = bindSshMcpRuntime(sshManager, credentialStore, monitorCollector)
    const gateway = new McpHttpGateway(
      sshMcpRuntime,
      settingsStore,
      { name: 'liteconnect-ssh', version: app.getVersion() || '1.0.0' },
      createMcpAuditLog(),
    )
    mcpHttpGateway = gateway
    registerMcpHandlers(sshMcpRuntime, gateway)
    registerAiHandlers(settingsStore, sshMcpRuntime, (sessionId) => {
      const snapshot = sshManager.getSessionSnapshot(sessionId)
      if (!snapshot) return undefined
      const connection = credentialStore.getConnection(snapshot.connectionId)
      if (!connection) return undefined
      return aiHistoryIdForHost(connection.host, connection.port || 22)
    })

    try {
      await gateway.applyFromSettings()
    } catch (err) {
      console.error('[Main MCP HTTP]', err)
    }
  })()

  await Promise.all([x11P, dockerP, mcpAiP, bashAstP])
}

app.whenReady().then(async () => {
  // This is deliberately the first data operation. Existing JSON/JSONL files are
  // migrated transactionally before any store can read or write the new database.
  try {
    await initializeAppDatabase()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('[Main Storage Migration]', error)
    dialog.showErrorBox(
      'LiteConnect 数据迁移失败',
      `旧数据没有被删除。请检查数据目录和磁盘空间后重试。\n\n${detail}`,
    )
    app.quit()
    return
  }
  installAppBackgroundProtocol(() => settingsStore.getAppBackgroundDir())
  // First-window IPC so the renderer can call as soon as the window loads.
  registerStoreHandlers(getMainWindow, credentialStore, settingsStore)
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
  registerShellCommandHistoryHandlers(shellCommandHistoryStore)
  registerSshHandlers(getMainWindow, sshManager, settingsStore, monitorCollector, credentialStore, knownHosts, sessionLog)
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
  const storesReady = Promise.all([
    knownHosts.init(),
    credentialStore.init(),
    dbConnectionStore.init(),
    dbQueryHistoryStore.init(),
    shellCommandHistoryStore.init(),
  ])

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

  openMainWindow(theme, customColors)
  void storesReady.catch((err) => {
    console.error('[Main Store Init]', err)
  })
  void startDeferredMain()

  // Tray / close-to-tray / global hotkey (reacts to settings via syncTrayFromSettings)
  installCloseToTray(settingsStore, () => openMainWindow())
  // Ask before quitting while an update is still downloading.
  installUpdateGuard()
  void settingsStore.init().then(() => {
    syncTrayFromSettings(settingsStore)
  }).catch((err) => {
    console.error('[Main Tray Init]', err)
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
  dockerCloser?.closeAll()
  sshManager.forceDisconnectAll()
  dbManager.disconnectAll()
  sessionLog.endAll()
  void mcpHttpGateway?.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('browser-window-blur', () => {
  credentialStore.clearDecryptedCache()
})

app.on('before-quit', () => {
  markQuitting()
  clearLatencyTimers()
  monitorCollector.stopAll()
  dockerCloser?.closeAll()
  sshManager.forceDisconnectAll()
  dbManager.disconnectAll()
  sessionLog.endAll()
  void mcpHttpGateway?.stop()
})

app.on('will-quit', () => {
  closeAppDatabase()
})

process.on('unhandledRejection', (reason) => {
  console.error('[Main Unhandled Promise]', reason)
})
