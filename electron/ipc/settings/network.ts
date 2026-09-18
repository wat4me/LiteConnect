import { ipcMain } from 'electron'
import { isValidUUID } from '../../utils/validation'
import type { SettingsIpcCtx } from './ctx'

export function registerNetworkSettingsHandlers(ctx: SettingsIpcCtx): void {
  const {
    settingsStore,
    credentialStore,
    ensureSettingsStoreReady,
    ensureStoresReady,
    getRecentConnectionsSnapshot,
  } = ctx

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
      if (settingsStore.getConnectionUsageStatsEnabled()) {
        await credentialStore.recordConnectionUsage(connectionId)
      }
    }
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

  ipcMain.handle('settings:getConnectionUsageStatsEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getConnectionUsageStatsEnabled()
  })

  ipcMain.handle('settings:setConnectionUsageStatsEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid value')
    }
    await settingsStore.setConnectionUsageStatsEnabled(enabled)
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
}
