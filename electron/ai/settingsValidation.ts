import { normalizeAiProviderProtocol } from '../../shared/aiProviderProtocol'
import { normalizeAiToolRounds } from '../../shared/aiToolLimits'
import { clampContextWindowTokens, parseAiModels } from '../../shared/aiContext'
import { sanitizeAiToolPermission } from '../../shared/aiToolPolicy'
import { normalizeAiHistoryMaxMessages, normalizeAiHistoryMaxThreads } from '../../shared/aiHistoryLimits'
import { normalizeAiBaseUrl } from './providers/http'
import { t } from '../i18n'

export function clampTemperature(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isNaN(n)) return 0.7
  return Math.max(0, Math.min(2, Math.round(n * 100) / 100))
}

export function validateAiSettings(settings: any): {
  providers: any[]
  activeProviderId: string | null
  activeModel: string
  systemPrompt: string
  temperature: number
  contextWindowTokens?: number
  maxToolRounds: number
  toolPermission: ReturnType<typeof sanitizeAiToolPermission>
  approvalNotifications: boolean
  historyMaxThreads: number
  historyMaxMessages: number
} {
  if (!settings || typeof settings !== 'object') {
    throw new Error('Invalid AI settings')
  }
  const rawProviders = Array.isArray(settings.providers) ? settings.providers : []
  const providers = rawProviders.map((p: any, i: number) => {
    if (!p || typeof p !== 'object') throw new Error(`Invalid AI provider at index ${i}`)
    const baseUrl = normalizeAiBaseUrl(p.baseUrl)
    return {
      id: typeof p.id === 'string' && p.id ? p.id : `provider-${Date.now()}-${i}`,
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : t('common.unnamedProvider'),
      baseUrl,
      protocol: normalizeAiProviderProtocol(p.protocol),
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
      models: parseAiModels(p.models),
    }
  })
  return {
    providers,
    activeProviderId: typeof settings.activeProviderId === 'string' ? settings.activeProviderId : (providers[0]?.id ?? null),
    activeModel: typeof settings.activeModel === 'string' ? settings.activeModel.trim() : '',
    systemPrompt: typeof settings.systemPrompt === 'string' ? settings.systemPrompt : '',
    temperature: clampTemperature(settings.temperature),
    maxToolRounds: normalizeAiToolRounds(settings.maxToolRounds),
    contextWindowTokens: clampContextWindowTokens(settings.contextWindowTokens),
    toolPermission: sanitizeAiToolPermission(settings.toolPermission),
    approvalNotifications: settings.approvalNotifications !== false,
    historyMaxThreads: normalizeAiHistoryMaxThreads(settings.historyMaxThreads),
    historyMaxMessages: normalizeAiHistoryMaxMessages(settings.historyMaxMessages),
  }
}
