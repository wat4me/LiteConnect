import { describe, expect, it } from 'vitest'
import { normalizeAiUsage } from '@shared/aiUsage'
import { usageCacheHitRate } from './usagePresentation'

describe('usageCacheHitRate', () => {
  it('uses input tokens as the denominator, without adding output or cache writes', () => {
    expect(usageCacheHitRate({ promptTokens: 1000, cachedPromptTokens: 800, cacheCreationPromptTokens: 100, completionTokens: 500 })).toBe(0.8)
    expect(usageCacheHitRate({ promptTokens: 1000, cachedPromptTokens: 0 })).toBe(0)
  })

  it('accepts a complete normalized breakdown inferred from cache misses', () => {
    expect(usageCacheHitRate(normalizeAiUsage({ promptTokens: 1000, uncachedPromptTokens: 250 })!)).toBe(0.75)
  })

  it.each([
    { promptTokens: 0, cachedPromptTokens: 0 },
    { promptTokens: 1000 },
    { cachedPromptTokens: 500 },
    { promptTokens: 1000, cachedPromptTokens: 1001 },
    { promptTokens: 1000, cachedPromptTokens: 500, usageIncomplete: true },
    { promptTokens: 1000, cachedPromptTokens: 500, cacheUsageIncomplete: true },
  ])('keeps unknown or partial hit rates unknown: %j', usage => {
    expect(usageCacheHitRate(usage)).toBeUndefined()
  })
})
