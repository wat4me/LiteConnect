import { randomBytes } from 'crypto'
import { getDefaultAiSystemPrompt, LEGACY_AI_SYSTEM_PROMPT } from '../utils/constants'
import { t } from '../i18n'
import {
  clampContextWindowTokens,
  firstAiModelId,
  parseAiModels,
  resolveModelContextWindow,
} from '../../shared/aiContext'
import { normalizeAiToolRounds, DEFAULT_AI_TOOL_ROUNDS } from '../../shared/aiToolLimits'
import { sanitizeAiToolPermission, type AiToolPermissionMode } from '../../shared/aiToolPolicy'
import { normalizeAiHistoryMaxMessages, normalizeAiHistoryMaxThreads } from '../../shared/aiHistoryLimits'

export type AiSettingsSnapshot = {
  maxToolRounds: number
  providers: any[]
  activeProviderId: string | null
  activeModel: string
  systemPrompt: string
  temperature: number
  contextWindowTokens?: number
  toolPermission: AiToolPermissionMode
  approvalNotifications: boolean
  historyMaxThreads: number
  historyMaxMessages: number
}

export type AiResolvedSettings = {
  maxToolRounds: number
  baseUrl: string
  model: string
  apiKey: string
  systemPrompt: string
  temperature: number
  contextWindowTokens?: number
  toolPermission: AiToolPermissionMode
}

type Secrets = {
  encrypt: (value: string) => string
  decryptOrEmpty: (value: string) => string
  encryptionAvailable: () => boolean
}

/** AI settings projection and persistence rules; the parent store owns the actual write. */
export class AiSettingsService {
  constructor(
    private readonly storedSettings: () => Record<string, any>,
    private readonly save: () => Promise<void>,
    private readonly secrets: Secrets,
  ) {}

  getAiSettings(): AiSettingsSnapshot {
    const ai = this.storedSettings().ai
    if (!ai || !Array.isArray(ai.providers) || ai.providers.length === 0) {
      return this.getDefaultAiSettings()
    }
    const providers = ai.providers.map((p: any) => this.normalizeAiProvider(p))
    const activeProviderId = typeof ai.activeProviderId === 'string' && ai.activeProviderId
      ? ai.activeProviderId
      : (providers[0]?.id ?? null)
    const activeProvider = providers.find((p: any) => p.id === activeProviderId) || providers[0]
    const activeModel = typeof ai.activeModel === 'string' && ai.activeModel.trim()
      ? ai.activeModel
      : (firstAiModelId(activeProvider?.models) || 'gpt-4o-mini')
    return {
      providers,
      activeProviderId,
      activeModel,
      systemPrompt: typeof ai.systemPrompt === 'string' && ai.systemPrompt !== LEGACY_AI_SYSTEM_PROMPT
        ? ai.systemPrompt
        : getDefaultAiSystemPrompt(),
      temperature: this.clampAiTemperature(ai.temperature),
      maxToolRounds: normalizeAiToolRounds(ai.maxToolRounds),
      contextWindowTokens: clampContextWindowTokens(ai.contextWindowTokens),
      toolPermission: sanitizeAiToolPermission(ai.toolPermission),
      approvalNotifications: ai.approvalNotifications !== false,
      historyMaxThreads: normalizeAiHistoryMaxThreads(ai.historyMaxThreads),
      historyMaxMessages: normalizeAiHistoryMaxMessages(ai.historyMaxMessages),
    }
  }

  async setAiSettings(settings: any): Promise<void> {
    const stored = this.storedSettings()
    const providers = Array.isArray(settings.providers) ? settings.providers : []
    stored.ai = {
      providers: providers.map((p: any) => ({
        id: typeof p.id === 'string' && p.id ? p.id : randomBytes(6).toString('hex'),
        name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : t('common.unnamedProvider'),
        baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl.trim() : '',
        apiKey: this.secrets.encrypt(typeof p.apiKey === 'string' ? p.apiKey : ''),
        apiKeyEncrypted: this.secrets.encryptionAvailable() && !!p.apiKey,
        models: parseAiModels(p.models),
      })),
      activeProviderId: typeof settings.activeProviderId === 'string' ? settings.activeProviderId : (providers[0]?.id ?? null),
      activeModel: typeof settings.activeModel === 'string' ? settings.activeModel.trim() : '',
      systemPrompt: typeof settings.systemPrompt === 'string' ? settings.systemPrompt : getDefaultAiSystemPrompt(),
      temperature: this.clampAiTemperature(settings.temperature),
      maxToolRounds: normalizeAiToolRounds(settings.maxToolRounds ?? stored.ai?.maxToolRounds),
      // Keep reading leftover global value; new saves omit it when unset.
      contextWindowTokens: clampContextWindowTokens(settings.contextWindowTokens),
      toolPermission: sanitizeAiToolPermission(settings.toolPermission ?? stored.ai?.toolPermission),
      approvalNotifications:
        typeof settings.approvalNotifications === 'boolean'
          ? settings.approvalNotifications
          : stored.ai?.approvalNotifications !== false,
      historyMaxThreads: normalizeAiHistoryMaxThreads(
        settings.historyMaxThreads ?? stored.ai?.historyMaxThreads,
      ),
      historyMaxMessages: normalizeAiHistoryMaxMessages(
        settings.historyMaxMessages ?? stored.ai?.historyMaxMessages,
      ),
    }
    await this.save()
  }

  async switchAiModel(providerId: string, model: string): Promise<AiSettingsSnapshot> {
    const ai = this.storedSettings().ai
    if (!ai || !Array.isArray(ai.providers)) return this.getAiSettings()
    const provider = ai.providers.find((p: any) => p.id === providerId)
    if (!provider) return this.getAiSettings()
    ai.activeProviderId = providerId
    ai.activeModel = model.trim() || firstAiModelId(provider.models)
    await this.save()
    return this.getAiSettings()
  }

  getAiResolvedConfig(): AiResolvedSettings {
    const settings = this.getAiSettings()
    const provider = settings.providers.find((p: any) => p.id === settings.activeProviderId) || settings.providers[0]
    if (!provider) {
      return {
        baseUrl: '',
        model: '',
        apiKey: '',
        systemPrompt: settings.systemPrompt,
        temperature: settings.temperature,
        maxToolRounds: settings.maxToolRounds,
        contextWindowTokens: settings.contextWindowTokens,
        toolPermission: settings.toolPermission,
      }
    }
    const model = settings.activeModel || firstAiModelId(provider.models)
    return {
      baseUrl: provider.baseUrl,
      model,
      apiKey: provider.apiKey,
      systemPrompt: settings.systemPrompt,
      temperature: settings.temperature,
      maxToolRounds: settings.maxToolRounds,
      contextWindowTokens: resolveModelContextWindow({
        model,
        models: provider.models,
        fallback: settings.contextWindowTokens,
      }),
      toolPermission: settings.toolPermission,
    }
  }

  private clampAiTemperature(raw: unknown): number {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isNaN(n)) return 0.7
    return Math.max(0, Math.min(2, Math.round(n * 100) / 100))
  }

  private getDefaultAiSettings(): AiSettingsSnapshot {
    return {
      providers: [],
      activeProviderId: null,
      activeModel: '',
      systemPrompt: getDefaultAiSystemPrompt(),
      temperature: 0.7,
      maxToolRounds: DEFAULT_AI_TOOL_ROUNDS,
      toolPermission: sanitizeAiToolPermission(undefined),
      approvalNotifications: true,
      historyMaxThreads: normalizeAiHistoryMaxThreads(undefined),
      historyMaxMessages: normalizeAiHistoryMaxMessages(undefined),
    }
  }

  private normalizeAiProvider(p: any): any {
    const rawApiKey = typeof p.apiKey === 'string' ? p.apiKey : ''
    const apiKey = p.apiKeyEncrypted ? this.secrets.decryptOrEmpty(rawApiKey) : rawApiKey
    return {
      id: typeof p.id === 'string' && p.id ? p.id : randomBytes(6).toString('hex'),
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : t('common.unnamedProvider'),
      baseUrl: typeof p.baseUrl === 'string' && p.baseUrl.trim() ? p.baseUrl.trim() : 'https://api.openai.com/v1',
      apiKey,
      models: parseAiModels(p.models),
    }
  }
}
