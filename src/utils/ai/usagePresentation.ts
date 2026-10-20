import type { AiUsage } from '@shared/types/ai'

/** A partial cache breakdown cannot describe the hit rate for the whole turn. */
export function usageCacheHitRate(usage: AiUsage): number | undefined {
  if (usage.usageIncomplete || usage.cacheUsageIncomplete) return undefined
  const input = usage.promptTokens
  const cached = usage.cachedPromptTokens
  if (input === undefined || input <= 0 || cached === undefined || cached < 0 || cached > input) return undefined
  return cached / input
}
