import { ipcMain } from 'electron'
import { isValidUUID } from '../utils/validation'
import { MonitorCollector } from '../ssh/monitor/monitor'
import { SettingsStore } from '../store/settingsStore'

export function registerMonitorHandlers(
  settingsStore: SettingsStore,
  monitorCollector: MonitorCollector,
): void {
  const ensureSettingsStoreReady = () => settingsStore.init()

  ipcMain.handle('monitor:start', async (_event, connectionId: string, sessionId: string) => {
    if (!isValidUUID(connectionId)) {
      throw new Error('Invalid connection id')
    }
    if (!isValidUUID(sessionId)) {
      throw new Error('Invalid session id')
    }
    await ensureSettingsStoreReady()
    const interval = settingsStore.getMonitorIntervalMs()
    monitorCollector.start(connectionId, sessionId, interval)
  })

  ipcMain.handle('monitor:stop', (_event, connectionId: string) => {
    if (!isValidUUID(connectionId)) return
    monitorCollector.stop(connectionId)
  })
}
