import type { CredentialStore } from '../../store/credentialStore'
import type { SettingsStore } from '../../store/settingsStore'
import type { AppSettingsAllPatch } from '../../../shared/types/settings'

export type SettingsIpcCtx = {
  credentialStore: CredentialStore
  settingsStore: SettingsStore
  ensureSettingsStoreReady: () => Promise<void>
  ensureStoresReady: () => Promise<unknown>
  getRecentConnectionsSnapshot: () => Promise<ReturnType<CredentialStore['getConnections']>>
  onMonitorIntervalChanged?: (intervalMs: number) => void
  notifyRuntimeSettingsChanged: () => void
  notifySettingsChanged: (changed: Array<keyof AppSettingsAllPatch>, sourceId?: number) => void
}
