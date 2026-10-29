import { app, BrowserWindow, ipcMain, shell } from 'electron'
import type { SettingsAllPatch } from '../../store/settingsStore'
import type { SettingsIpcCtx } from './ctx'
import { commitSettings } from './commitSettings'

/**
 * Bulk get/set plus workspace restore / updater / app info.
 * New settings should go through settings:getAll / settings:setMany
 * instead of adding another one-off IPC pair.
 */
export function registerWorkspaceSettingsHandlers(ctx: SettingsIpcCtx): void {
  const { settingsStore, ensureSettingsStoreReady } = ctx

  ipcMain.handle('settings:getAll', async () => {
    await ensureSettingsStoreReady()
    await settingsStore.initMigrations()
    return settingsStore.getAll()
  })

  ipcMain.handle('settings:setMany', async (_event, patch: SettingsAllPatch & { appBackground?: { token?: string; clear?: boolean; fit?: 'cover' | 'contain' | 'fill'; overlay?: number; fileName?: string } }) => {
    await ensureSettingsStoreReady()
    await settingsStore.initMigrations()
    if (!patch || typeof patch !== 'object') throw new Error('Invalid settings')

    const previousLocale = settingsStore.getLocale()
    const previousMonitorInterval = settingsStore.getMonitorIntervalMs()
    const saved = await commitSettings(ctx, patch)
    if (saved.monitorIntervalMs !== previousMonitorInterval) {
      ctx.onMonitorIntervalChanged?.(saved.monitorIntervalMs)
    }
    if (patch.monitorEnabled !== undefined || patch.autoReconnectEnabled !== undefined || patch.autoReconnectMaxRetries !== undefined) {
      ctx.notifyRuntimeSettingsChanged()
    }
    ctx.notifySettingsChanged(Object.keys(patch) as (keyof SettingsAllPatch)[], _event.sender?.id)
    if (saved.locale !== previousLocale) {
      const { setMainLocale } = await import('../../i18n')
      const { syncTrayFromSettings } = await import('../../window/tray')
      setMainLocale(saved.locale)
      syncTrayFromSettings(settingsStore)
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('app:localeChanged', saved.locale)
      }
    }
    if (patch.x11AutoStartEnabled !== undefined || patch.x11ServerPath !== undefined) {
      const { configureX11ServerOptions } = await import('../../ssh/x11/x11Server')
      configureX11ServerOptions({
        autoStart: settingsStore.getX11AutoStartEnabled(),
        executablePath: settingsStore.getX11ServerPath(),
      })
    }
    if (
      patch.closeToTrayEnabled !== undefined
      || patch.globalHotkeyEnabled !== undefined
      || patch.globalHotkey !== undefined
    ) {
      const { syncTrayFromSettings } = await import('../../window/tray')
      syncTrayFromSettings(settingsStore)
    }
    return saved
  })

  ipcMain.handle('app:getInfo', () => ({
    version: app.getVersion(),
    electron: process.versions.electron || '',
    platform: `${process.platform}-${process.arch}`,
  }))

  ipcMain.handle('sessionLog:openDir', async () => {
    const { SessionLogManager } = await import('../../ssh/sessionLog')
    const error = await shell.openPath(new SessionLogManager().getLogDir())
    return { ok: !error }
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

  ipcMain.handle('settings:getWorkspaceRestoreEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getWorkspaceRestoreEnabled()
  })

  ipcMain.handle('settings:setWorkspaceRestoreEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    await settingsStore.setWorkspaceRestoreEnabled(!!enabled)
  })

  ipcMain.handle('settings:getWorkspaceTabs', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getWorkspaceTabs()
  })

  ipcMain.handle('settings:setWorkspaceTabs', async (_event, state: unknown) => {
    await ensureSettingsStoreReady()
    if (state == null) {
      await settingsStore.setWorkspaceTabs(null)
      return
    }
    if (!state || typeof state !== 'object') throw new Error('Invalid workspace')
    await settingsStore.setWorkspaceTabs(state as any)
  })
}
