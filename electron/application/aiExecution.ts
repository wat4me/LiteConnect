import { AiExecutionService } from '../ai/execution/executionService'
import { readAiSessionStore, upsertAiHistoryRecord, writeAiContextCheckpoint } from '../ai/history/historyStore'
import { hydrateAiImages } from '../ai/history/imageStore'
import { workspaceScopes } from '../ai/workspace/workspaceScopes'
import type { SshMcpRuntime } from '../mcp/runtime'
import type { SettingsStore } from '../store/settingsStore'

export function createAiExecutionService(settings: SettingsStore, runtime?: SshMcpRuntime): AiExecutionService {
  return new AiExecutionService({
    settings: {
      ready: () => settings.init().then(() => settings.initMigrations()),
      config: () => settings.getAiResolvedConfig(),
      limits: () => {
        const value = settings.getAiSettings()
        return { maxThreads: value.historyMaxThreads, maxMessages: value.historyMaxMessages }
      },
    },
    history: { read: readAiSessionStore, save: upsertAiHistoryRecord, checkpoint: writeAiContextCheckpoint, hydrate: hydrateAiImages },
    runtime,
    workspaceOwned: (id, owner) => {
      if (!id.startsWith('workspace:')) return false
      try { workspaceScopes.owned(id, owner); return true } catch { return false }
    },
    workspaceTargets: (id, owner) => workspaceScopes.targets(id, owner),
    onError: error => console.warn('Could not deliver AI background results', error),
  })
}
