import { ipcMain } from 'electron'
import { isValidUUID } from '../utils/validation'
import { MonitorCollector } from '../ssh/monitor/monitor'
import { SettingsStore } from '../store/settingsStore'

export function registerMonitorHandlers(
  settingsStore: SettingsStore,
  monitorCollector: MonitorCollector,
): void {
  const ensureSettingsStoreReady = () => settingsStore.init()

  ipcMain.handle('monitor:start', async (_event, sessionId: string) => {
    if (!isValidUUID(sessionId)) {
      throw new Error('Invalid session id')
    }
    await ensureSettingsStoreReady()
    const interval = settingsStore.getMonitorIntervalMs()
    monitorCollector.start(sessionId, interval)
  })

  ipcMain.handle('monitor:stop', (_event, sessionId: string) => {
    if (!isValidUUID(sessionId)) return
    monitorCollector.stop(sessionId)
  })
}
