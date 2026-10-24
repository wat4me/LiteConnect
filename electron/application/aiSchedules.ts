import { AiScheduler } from '../ai/schedules/scheduler'
import { AiScheduleNotifier, type StoredAiNotification } from '../ai/schedules/notifications'
import { createScheduleExecutor } from '../ipc/aiScheduleExecutor'
import { getAppDatabase } from '../store/appDatabase'
import { encryptSettingsSecret, decryptSettingsSecret } from '../store/settingsSecrets'
import type { AiScheduleSnapshot } from '../../shared/aiSchedules'
import type { AiExecutionService } from '../ai/execution/executionService'
import type { SSHManager } from '../ssh/manager'
import type { CredentialStore } from '../store/credentialStore'
import type { SettingsStore } from '../store/settingsStore'

export function createAiScheduleServices(execution: AiExecutionService, ssh: SSHManager, credentials: CredentialStore,
  settings: SettingsStore, changed: (state: AiScheduleSnapshot) => void) {
  for (const key of getAppDatabase().listSingletonKeys('ai-session:schedule:')) getAppDatabase().deleteSingleton(key)
  const notifier = new AiScheduleNotifier({
    read: () => getAppDatabase().getSingleton<StoredAiNotification>('ai-inspection-notifications'),
    save: value => getAppDatabase().setSingleton('ai-inspection-notifications', value),
    seal: encryptSettingsSecret, unseal: decryptSettingsSecret,
  })
  const scheduler = new AiScheduler({
    read: () => getAppDatabase().getSingleton<AiScheduleSnapshot>('ai-schedules') || { plans: [], runs: [] },
    save: state => getAppDatabase().setSingleton('ai-schedules', state),
    execute: createScheduleExecutor(execution, ssh, credentials, plan => settings.resolveAiConfig(plan?.providerId, plan?.model)),
    notify: (plan, run, signal) => notifier.notify(plan, run, signal),
    changed, onError: error => console.error('[AI schedules]', error),
  })
  return { scheduler, notifier }
}
