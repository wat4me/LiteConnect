import { BrowserWindow, ipcMain } from 'electron'
import type { AiExecutionService } from '../ai/execution/executionService'
import type { SSHManager } from '../ssh/manager'
import type { CredentialStore } from '../store/credentialStore'
import { getAppDatabase } from '../store/appDatabase'
import { AiScheduler } from '../ai/schedules/scheduler'
import { createScheduleExecutor } from './aiScheduleExecutor'
import { aiScheduleConnectionIds, validateAiSchedule, type AiScheduleInput, type AiScheduleSnapshot } from '../../shared/aiSchedules'
import { isValidUUID } from '../utils/validation'
import type { SettingsStore } from '../store/settingsStore'
import { AiScheduleNotifier, type StoredAiNotification } from '../ai/schedules/notifications'
import { encryptSettingsSecret, decryptSettingsSecret } from '../store/settingsSecrets'
import type { AiNotificationInput } from '../../shared/aiNotifications'

export function registerAiScheduleHandlers(service: AiExecutionService, ssh: SSHManager, credentials: CredentialStore, settings: SettingsStore) {
  for (const key of getAppDatabase().listSingletonKeys('ai-session:schedule:')) getAppDatabase().deleteSingleton(key)
  const notifier = new AiScheduleNotifier({ read: () => getAppDatabase().getSingleton<StoredAiNotification>('ai-inspection-notifications'),
    save: value => getAppDatabase().setSingleton('ai-inspection-notifications', value), seal: encryptSettingsSecret, unseal: decryptSettingsSecret })
  const scheduler = new AiScheduler({
    read: () => getAppDatabase().getSingleton<AiScheduleSnapshot>('ai-schedules') || { plans: [], runs: [] },
    save: state => getAppDatabase().setSingleton('ai-schedules', state),
    execute: createScheduleExecutor(service, ssh, credentials, plan => settings.resolveAiConfig(plan?.providerId, plan?.model)),
    notify: (plan, run, signal) => notifier.notify(plan, run, signal),
    changed: state => {
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('ai:schedulesChanged', state)
    },
    onError: error => console.error('[AI schedules]', error),
  })
  ipcMain.handle('ai:listSchedules', () => scheduler.snapshot())
  ipcMain.handle('ai:saveSchedule', async (_event, input: AiScheduleInput) => {
    const value = validateAiSchedule(input)
    await credentials.init()
    if (aiScheduleConnectionIds(value).some(id => !isValidUUID(id) || !credentials.getConnection(id))) throw new Error('请选择已保存的服务器。')
    return scheduler.save(value)
  })
  ipcMain.handle('ai:removeSchedule', (_event, id: string) => scheduler.remove(id))
  ipcMain.handle('ai:runSchedule', (_event, id: string) => scheduler.runNow(id))
  ipcMain.handle('ai:stopScheduleRun', (_event, id: string) => scheduler.stop(id))
  ipcMain.handle('ai:getNotificationSettings', () => notifier.settings())
  ipcMain.handle('ai:saveNotificationSettings', (_event, input: AiNotificationInput) => notifier.save(input))
  ipcMain.handle('ai:testNotification', () => notifier.test())
  scheduler.start()
  return scheduler
}
