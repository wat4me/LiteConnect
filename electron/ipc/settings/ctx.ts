import type { CredentialStore } from '../../store/credentialStore'
import type { SettingsStore } from '../../store/settingsStore'

export type SettingsIpcCtx = {
  credentialStore: CredentialStore
  settingsStore: SettingsStore
  ensureSettingsStoreReady: () => Promise<void>
  ensureStoresReady: () => Promise<unknown>
  getRecentConnectionsSnapshot: () => Promise<ReturnType<CredentialStore['getConnections']>>
}
