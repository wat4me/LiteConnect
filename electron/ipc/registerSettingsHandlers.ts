import { app, ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { CredentialStore } from '../store/credentialStore'
import { SettingsStore } from '../store/settingsStore'
import { isValidUUID } from '../utils/validation'

const BUNDLED_VCXSRV_INSTALLER = 'vcxsrv-64.1.20.14.0.installer.exe'

function bundledX11InstallerPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'third-party', BUNDLED_VCXSRV_INSTALLER)
    : join(process.cwd(), 'build', 'third-party', BUNDLED_VCXSRV_INSTALLER)
}

export function registerSettingsHandlers(
  credentialStore: CredentialStore,
  settingsStore: SettingsStore,
  ensureSettingsStoreReady: () => Promise<void>,
  ensureStoresReady: () => Promise<unknown>,
  getRecentConnectionsSnapshot: () => Promise<ReturnType<CredentialStore['getConnections']>>
): void {
  ipcMain.handle('settings:getRecentConnections', async () => {
    return await getRecentConnectionsSnapshot()
  })

  ipcMain.handle('settings:recordRecentConnection', async (_event, connectionId: string) => {
    await ensureStoresReady()
    if (!isValidUUID(connectionId)) {
      throw new Error('Invalid connection id')
    }
    if (credentialStore.getConnection(connectionId)) {
      await settingsStore.recordRecentConnection(connectionId)
    }
  })

  ipcMain.handle('settings:getTerminalFontSize', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalFontSize()
  })

  ipcMain.handle('settings:getTerminalFontFamily', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalFontFamily()
  })

  ipcMain.handle('settings:setTerminalFontFamily', async (_event, family: string) => {
    await ensureSettingsStoreReady()
    await settingsStore.setTerminalFontFamily(family)
  })

  ipcMain.handle('settings:getDbFontFamily', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbFontFamily()
  })

  ipcMain.handle('settings:setDbFontFamily', async (_event, family: string) => {
    await ensureSettingsStoreReady()
    if (typeof family !== 'string') throw new Error('Invalid font family')
    await settingsStore.setDbFontFamily(family)
  })

  ipcMain.handle('settings:getDbFontSize', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbFontSize()
  })

  ipcMain.handle('settings:setDbFontSize', async (_event, size: number) => {
    await ensureSettingsStoreReady()
    if (typeof size !== 'number' || Number.isNaN(size)) throw new Error('Invalid font size')
    await settingsStore.setDbFontSize(size)
  })

  ipcMain.handle('settings:getDbPageSize', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbPageSize()
  })

  ipcMain.handle('settings:getDbConfirmDangerousSql', async () => {
    await settingsStore.init()
    return settingsStore.getDbConfirmDangerousSql()
  })

  ipcMain.handle('settings:setDbConfirmDangerousSql', async (_event, enabled: boolean) => {
    await settingsStore.init()
    await settingsStore.setDbConfirmDangerousSql(!!enabled)
  })

  ipcMain.handle('settings:setDbPageSize', async (_event, size: number) => {
    await ensureSettingsStoreReady()
    if (typeof size !== 'number' || Number.isNaN(size)) throw new Error('Invalid page size')
    await settingsStore.setDbPageSize(size)
  })

  ipcMain.handle('settings:getDbDefaultMaxRows', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbDefaultMaxRows()
  })

  ipcMain.handle('settings:setDbDefaultMaxRows', async (_event, n: number) => {
    await ensureSettingsStoreReady()
    if (typeof n !== 'number' || Number.isNaN(n)) throw new Error('Invalid default max rows')
    await settingsStore.setDbDefaultMaxRows(n)
  })

  ipcMain.handle('settings:getDbDefaultQueryTimeoutSec', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbDefaultQueryTimeoutSec()
  })

  ipcMain.handle('settings:setDbDefaultQueryTimeoutSec', async (_event, sec: number) => {
    await ensureSettingsStoreReady()
    if (typeof sec !== 'number' || Number.isNaN(sec)) throw new Error('Invalid default query timeout')
    await settingsStore.setDbDefaultQueryTimeoutSec(sec)
  })

  ipcMain.handle('settings:getDbDefaultRunScope', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbDefaultRunScope()
  })

  ipcMain.handle('settings:setDbDefaultRunScope', async (_event, scope: string) => {
    await ensureSettingsStoreReady()
    if (typeof scope !== 'string') throw new Error('Invalid default run scope')
    await settingsStore.setDbDefaultRunScope(scope)
  })

  ipcMain.handle('settings:getTerminalPalette', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalPalette()
  })

  ipcMain.handle('settings:setTerminalPalette', async (_event, palette: string) => {
    await ensureSettingsStoreReady()
    await settingsStore.setTerminalPalette(palette)
  })

  ipcMain.handle('settings:getTerminalScrollback', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalScrollback()
  })

  ipcMain.handle('settings:setTerminalScrollback', async (_event, n: number) => {
    await ensureSettingsStoreReady()
    if (typeof n !== 'number' || Number.isNaN(n)) throw new Error('Invalid scrollback')
    await settingsStore.setTerminalScrollback(n)
  })

  ipcMain.handle('settings:getTerminalPasteConfirmEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalPasteConfirmEnabled()
  })

  ipcMain.handle('settings:setTerminalPasteConfirmEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    await settingsStore.setTerminalPasteConfirmEnabled(!!enabled)
  })

  ipcMain.handle('settings:getTerminalPasteConfirmMaxChars', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalPasteConfirmMaxChars()
  })

  ipcMain.handle('settings:setTerminalPasteConfirmMaxChars', async (_event, n: number) => {
    await ensureSettingsStoreReady()
    if (typeof n !== 'number' || Number.isNaN(n)) throw new Error('Invalid paste confirm threshold')
    if (
      !(SettingsStore.TERMINAL_PASTE_CONFIRM_MAX_CHARS_OPTIONS as readonly number[]).includes(n)
    ) {
      throw new Error('Invalid paste confirm threshold')
    }
    await settingsStore.setTerminalPasteConfirmMaxChars(n)
  })

  ipcMain.handle('settings:setTerminalFontSize', async (_event, size: number) => {
    await ensureSettingsStoreReady()
    if (typeof size !== 'number' || size < 10 || size > 24) {
      throw new Error('Invalid font size')
    }
    await settingsStore.setTerminalFontSize(size)
  })

  ipcMain.handle('settings:getCredentialAutoFillEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getCredentialAutoFillEnabled()
  })

  ipcMain.handle('settings:setCredentialAutoFillEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid value')
    }
    await settingsStore.setCredentialAutoFillEnabled(enabled)
  })

  ipcMain.handle('settings:getLatencyEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getLatencyEnabled()
  })

  ipcMain.handle('settings:setLatencyEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid value')
    }
    await settingsStore.setLatencyEnabled(enabled)
  })

  ipcMain.handle('settings:getLatencyIntervalMs', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getLatencyIntervalMs()
  })

  ipcMain.handle('settings:setLatencyIntervalMs', async (_event, intervalMs: number) => {
    await ensureSettingsStoreReady()
    if (typeof intervalMs !== 'number' || intervalMs < 1000 || intervalMs > 60000) {
      throw new Error('Invalid interval')
    }
    await settingsStore.setLatencyIntervalMs(intervalMs)
  })

  ipcMain.handle('settings:getAutoReconnectEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getAutoReconnectEnabled()
  })

  ipcMain.handle('settings:setAutoReconnectEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    await settingsStore.setAutoReconnectEnabled(!!enabled)
  })

  ipcMain.handle('settings:getAutoReconnectMaxRetries', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getAutoReconnectMaxRetries()
  })

  ipcMain.handle('settings:setAutoReconnectMaxRetries', async (_event, n: number) => {
    await ensureSettingsStoreReady()
    if (typeof n !== 'number') throw new Error('Invalid retries')
    await settingsStore.setAutoReconnectMaxRetries(n)
  })

  ipcMain.handle('settings:getX11AutoStartEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getX11AutoStartEnabled()
  })

  ipcMain.handle('settings:setX11AutoStartEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    await settingsStore.setX11AutoStartEnabled(!!enabled)
    const { configureX11ServerOptions } = await import('../ssh/x11Server')
    configureX11ServerOptions({
      autoStart: settingsStore.getX11AutoStartEnabled(),
      executablePath: settingsStore.getX11ServerPath(),
    })
  })

  ipcMain.handle('settings:getX11ServerPath', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getX11ServerPath()
  })

  ipcMain.handle('settings:setX11ServerPath', async (_event, path: string) => {
    await ensureSettingsStoreReady()
    if (typeof path !== 'string') throw new Error('Invalid path')
    await settingsStore.setX11ServerPath(path)
    const { configureX11ServerOptions } = await import('../ssh/x11Server')
    configureX11ServerOptions({
      autoStart: settingsStore.getX11AutoStartEnabled(),
      executablePath: settingsStore.getX11ServerPath(),
    })
  })

  ipcMain.handle('settings:getX11ServerStatus', async (_event, draftExecutablePath?: string) => {
    await ensureSettingsStoreReady()
    const { configureX11ServerOptions, getX11ServerStatus } = await import('../ssh/x11Server')
    configureX11ServerOptions({
      autoStart: settingsStore.getX11AutoStartEnabled(),
      executablePath: settingsStore.getX11ServerPath(),
    })
    return getX11ServerStatus(
      typeof draftExecutablePath === 'string' ? draftExecutablePath : undefined,
    )
  })

  ipcMain.handle('settings:getBundledX11InstallerStatus', () => ({
    available: existsSync(bundledX11InstallerPath()),
  }))

  ipcMain.handle('settings:installBundledX11Server', async () => {
    const installer = bundledX11InstallerPath()
    if (!existsSync(installer)) {
      throw new Error('Bundled VcXsrv installer is unavailable')
    }
    const error = await shell.openPath(installer)
    if (error) throw new Error(error)
    return { started: true }
  })

  ipcMain.handle('settings:selectX11ServerExecutable', async () => {
    const { dialog, BrowserWindow } = await import('electron')
    const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: (await import('../i18n')).t('x11.selectExeTitle'),
      filters: [
        { name: 'Executable', extensions: ['exe'] },
        { name: 'All', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('settings:getMonitorEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getMonitorEnabled()
  })

  ipcMain.handle('settings:setMonitorEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid value')
    }
    await settingsStore.setMonitorEnabled(enabled)
  })

  ipcMain.handle('settings:getMonitorIntervalMs', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getMonitorIntervalMs()
  })

  ipcMain.handle('settings:setMonitorIntervalMs', async (_event, intervalMs: number) => {
    await ensureSettingsStoreReady()
    if (typeof intervalMs !== 'number' || intervalMs < 2000 || intervalMs > 30000) {
      throw new Error('Invalid interval')
    }
    await settingsStore.setMonitorIntervalMs(intervalMs)
  })

  ipcMain.handle('settings:getAutoUpdateEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getAutoUpdateEnabled()
  })

  ipcMain.handle('settings:setAutoUpdateEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    await settingsStore.setAutoUpdateEnabled(enabled)
  })

  ipcMain.handle('settings:getSkippedUpdateVersion', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getSkippedUpdateVersion()
  })

  ipcMain.handle('settings:setSkippedUpdateVersion', async (_event, version: string) => {
    await ensureSettingsStoreReady()
    if (!version || typeof version !== 'string') {
      throw new Error('Invalid version')
    }
    await settingsStore.setSkippedUpdateVersion(version)
  })
}
