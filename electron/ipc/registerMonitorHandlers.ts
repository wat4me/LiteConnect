import { ipcMain } from 'electron'
import { isValidUUID } from '../utils/validation'
import { MonitorCollector } from '../ssh/monitor/monitor'
import { SettingsStore } from '../store/settingsStore'
import type { MonitorAlerts } from '../ssh/monitor/monitorAlerts'

export function registerMonitorHandlers(
  settingsStore: SettingsStore,
  monitorCollector: MonitorCollector,
  monitorAlerts?: MonitorAlerts,
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
    if (monitorAlerts) monitorAlerts.startPanel(connectionId, sessionId)
    else monitorCollector.start(connectionId, sessionId, interval)
  })

  ipcMain.handle('monitor:stop', (_event, connectionId: string) => {
    if (!isValidUUID(connectionId)) return
    if (monitorAlerts) monitorAlerts.stopPanel(connectionId)
    else monitorCollector.stop(connectionId)
  })

  if (monitorAlerts) {
    ipcMain.handle('monitor:getAlertRule', async (_event, connectionId: string) => {
      if (!isValidUUID(connectionId)) throw new Error('Invalid connection id')
      await ensureSettingsStoreReady()
      return monitorAlerts.getRule(connectionId)
    })
    ipcMain.handle('monitor:setAlertRule', async (_event, connectionId: string, rule: unknown) => {
      if (!isValidUUID(connectionId)) throw new Error('Invalid connection id')
      await ensureSettingsStoreReady()
      return monitorAlerts.setRule(connectionId, rule)
    })
  }
}
