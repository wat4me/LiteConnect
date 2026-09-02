import { app, ipcMain, shell } from 'electron'
import { mkdir } from 'fs/promises'
import type { SettingsAllPatch } from '../../store/settingsStore'
import type { SettingsIpcCtx } from './ctx'
import { clearWallpaperDir, persistWallpaperFromToken } from './wallpaper'

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

    const nextPatch: SettingsAllPatch = { ...patch }
    if (patch.appBackground && typeof patch.appBackground === 'object') {
      const dir = settingsStore.getAppBackgroundDir()
      const bg = patch.appBackground
      if (bg.clear) {
        await mkdir(dir, { recursive: true })
        await clearWallpaperDir(dir)
        nextPatch.appBackground = { fileName: '', fit: bg.fit, overlay: bg.overlay }
      } else if (typeof bg.token === 'string' && bg.token) {
        const fileName = await persistWallpaperFromToken(dir, bg.token)
        nextPatch.appBackground = { fileName, fit: bg.fit, overlay: bg.overlay }
      } else {
        nextPatch.appBackground = { fit: bg.fit, overlay: bg.overlay }
      }
    }

    const saved = await settingsStore.applyMany(nextPatch)
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
