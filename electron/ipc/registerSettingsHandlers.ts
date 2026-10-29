import { CredentialStore } from '../store/credentialStore'
import { SettingsStore } from '../store/settingsStore'
import type { SettingsIpcCtx } from './settings/ctx'
import { registerAppearanceSettingsHandlers } from './settings/appearance'
import { registerDatabaseSettingsHandlers } from './settings/database'
import { registerNetworkSettingsHandlers } from './settings/network'
import { registerTerminalSettingsHandlers } from './settings/terminal'
import { registerWorkspaceSettingsHandlers } from './settings/workspace'
import { registerX11SettingsHandlers } from './settings/x11'
import { BrowserWindow } from 'electron'
import type { AppRuntimeSettings } from '../../shared/types/settings'

/**
 * Settings IPC composition root.
 * New persisted settings: add the field to AppSettingsAll + SettingsStore.getAll/applyMany,
 * then the settings UI. Avoid a new one-off getX/setX IPC pair.
 */
export function registerSettingsHandlers(
  credentialStore: CredentialStore,
  settingsStore: SettingsStore,
  ensureSettingsStoreReady: () => Promise<void>,
  ensureStoresReady: () => Promise<unknown>,
  getRecentConnectionsSnapshot: () => Promise<ReturnType<CredentialStore['getConnections']>>,
  onMonitorIntervalChanged?: (intervalMs: number) => void,
): void {
  const ctx: SettingsIpcCtx = {
    credentialStore,
    settingsStore,
    ensureSettingsStoreReady,
    ensureStoresReady,
    getRecentConnectionsSnapshot,
    onMonitorIntervalChanged,
    notifySettingsChanged: (changed, sourceId) => {
      if (!changed.length) return
      const settings = settingsStore.getAll()
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && (sourceId === undefined || win.webContents.id !== sourceId)) {
          win.webContents.send('settings:changed', { settings, changed })
        }
      }
    },
    notifyRuntimeSettingsChanged: () => {
      const settings: AppRuntimeSettings = {
        monitorEnabled: settingsStore.getMonitorEnabled(),
        autoReconnectEnabled: settingsStore.getAutoReconnectEnabled(),
        autoReconnectMaxRetries: settingsStore.getAutoReconnectMaxRetries(),
      }
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('settings:runtimeChanged', settings)
      }
    },
  }
  registerNetworkSettingsHandlers(ctx)
  registerTerminalSettingsHandlers(ctx)
  registerDatabaseSettingsHandlers(ctx)
  registerWorkspaceSettingsHandlers(ctx)
  registerAppearanceSettingsHandlers(ctx)
  registerX11SettingsHandlers(ctx)
}
