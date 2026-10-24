import { ServiceIpcScope } from './serviceScope'
import type { CredentialStore } from '../store/credentialStore'
import type { AiScheduler } from '../ai/schedules/scheduler'
import { aiScheduleConnectionIds, validateAiSchedule, type AiScheduleInput } from '../../shared/aiSchedules'
import { isValidUUID } from '../utils/validation'
import type { AiScheduleNotifier } from '../ai/schedules/notifications'
import type { AiNotificationInput } from '../../shared/aiNotifications'

export function registerAiScheduleHandlers(scheduler: AiScheduler, notifier: AiScheduleNotifier, credentials: CredentialStore,
  scope = new ServiceIpcScope()): void {
  scope.handle('ai:listSchedules', () => scheduler.snapshot())
  scope.handle('ai:saveSchedule', async (_event, input: AiScheduleInput) => {
    const value = validateAiSchedule(input)
    await credentials.init()
    scope.assertOpen()
    if (aiScheduleConnectionIds(value).some(id => !isValidUUID(id) || !credentials.getConnection(id))) throw new Error('请选择已保存的服务器。')
    return scheduler.save(value)
  })
  scope.handle('ai:removeSchedule', (_event, id: string) => scheduler.remove(id))
  scope.handle('ai:runSchedule', (_event, id: string) => scheduler.runNow(id))
  scope.handle('ai:stopScheduleRun', (_event, id: string) => scheduler.stop(id))
  scope.handle('ai:getNotificationSettings', () => notifier.settings())
  scope.handle('ai:saveNotificationSettings', (_event, input: AiNotificationInput) => notifier.save(input))
  scope.handle('ai:testNotification', () => notifier.test(scope.signal))
}
