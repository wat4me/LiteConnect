import { CredentialStore } from '../store/credentialStore'
import { SettingsStore } from '../store/settingsStore'
import type { SettingsIpcCtx } from './settings/ctx'
import { registerAppearanceSettingsHandlers } from './settings/appearance'
import { registerDatabaseSettingsHandlers } from './settings/database'
import { registerNetworkSettingsHandlers } from './settings/network'
import { registerTerminalSettingsHandlers } from './settings/terminal'
import { registerWorkspaceSettingsHandlers } from './settings/workspace'
import { registerX11SettingsHandlers } from './settings/x11'

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
  getRecentConnectionsSnapshot: () => Promise<ReturnType<CredentialStore['getConnections']>>
): void {
  const ctx: SettingsIpcCtx = {
    credentialStore,
    settingsStore,
    ensureSettingsStoreReady,
    ensureStoresReady,
    getRecentConnectionsSnapshot,
  }
  registerNetworkSettingsHandlers(ctx)
  registerTerminalSettingsHandlers(ctx)
  registerDatabaseSettingsHandlers(ctx)
  registerWorkspaceSettingsHandlers(ctx)
  registerAppearanceSettingsHandlers(ctx)
  registerX11SettingsHandlers(ctx)
}
