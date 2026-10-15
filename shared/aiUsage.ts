import type { AiUsage } from './types/ai'

const tokenKeys = ['promptTokens', 'cachedPromptTokens', 'uncachedPromptTokens', 'cacheCreationPromptTokens', 'completionTokens', 'totalTokens', 'reasoningTokens'] as const
export function aiTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** Keep IPC/history values plain; missing provider statistics remain unknown. */
export function normalizeAiUsage(value: unknown): AiUsage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as AiUsage
  const usage: AiUsage = {}
  for (const key of tokenKeys) {
    const count = aiTokenCount(raw[key])
    if (count !== undefined) usage[key] = count
  }
  if (!raw.cacheUsageIncomplete && usage.promptTokens === undefined && usage.cachedPromptTokens !== undefined && usage.uncachedPromptTokens !== undefined) {
    usage.promptTokens = aiTokenCount(usage.cachedPromptTokens + usage.uncachedPromptTokens)
  }
  if (usage.promptTokens !== undefined && !raw.cacheUsageIncomplete && !raw.usageIncomplete) {
    const { promptTokens, cachedPromptTokens, uncachedPromptTokens } = usage
    if ((cachedPromptTokens !== undefined && cachedPromptTokens > promptTokens) ||
      (uncachedPromptTokens !== undefined && uncachedPromptTokens > promptTokens) ||
      (cachedPromptTokens !== undefined && uncachedPromptTokens !== undefined && cachedPromptTokens + uncachedPromptTokens !== promptTokens)) {
      delete usage.cachedPromptTokens
      delete usage.uncachedPromptTokens
    } else if (cachedPromptTokens !== undefined && uncachedPromptTokens === undefined) {
      usage.uncachedPromptTokens = promptTokens - cachedPromptTokens
    } else if (uncachedPromptTokens !== undefined && cachedPromptTokens === undefined) {
      usage.cachedPromptTokens = promptTokens - uncachedPromptTokens
    }
  }
  if (usage.totalTokens === undefined && usage.promptTokens !== undefined && usage.completionTokens !== undefined) {
    usage.totalTokens = aiTokenCount(usage.promptTokens + usage.completionTokens)
  }
  const requestCount = aiTokenCount(raw.requestCount)
  if (requestCount !== undefined && requestCount > 0) usage.requestCount = requestCount
  if (raw.usageIncomplete === true) usage.usageIncomplete = true
  if (raw.cacheUsageIncomplete === true) usage.cacheUsageIncomplete = true
  return Object.keys(usage).length ? usage : undefined
}

/** Sum request snapshots, never stream deltas. Partial data is explicitly marked. */
export function aggregateAiUsage(requests: readonly (AiUsage | undefined)[]): AiUsage | undefined {
  if (!requests.length) return undefined
  const normalized = requests.map(normalizeAiUsage)
  const result: AiUsage = { requestCount: normalized.reduce((sum, usage) => sum + (usage?.requestCount || 1), 0) }
  for (const key of tokenKeys) {
    const counts = normalized.flatMap(usage => usage?.[key] === undefined ? [] : [usage[key]!])
    if (counts.length) result[key] = counts.reduce((sum, count) => sum + count, 0)
  }
  if (normalized.some(usage => !usage || usage.usageIncomplete || usage.promptTokens === undefined || usage.completionTokens === undefined || usage.totalTokens === undefined)) result.usageIncomplete = true
  if (normalized.some(usage => !usage || usage.cacheUsageIncomplete || usage.cachedPromptTokens === undefined || usage.uncachedPromptTokens === undefined)) result.cacheUsageIncomplete = true
  return result
}
