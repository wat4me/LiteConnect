import { describe, expect, it } from 'vitest'
import { aggregateAiUsage, normalizeAiUsage } from './aiUsage'

describe('AI usage accounting', () => {
  it('splits cached input and counts reasoning only inside output', () => {
    expect(normalizeAiUsage({ promptTokens: 1000, cachedPromptTokens: 800, completionTokens: 100, reasoningTokens: 60 })).toEqual({
      promptTokens: 1000, cachedPromptTokens: 800, uncachedPromptTokens: 200, completionTokens: 100, reasoningTokens: 60, totalTokens: 1100,
    })
  })
  it('retains explicit zero hits without inventing cache data for older providers', () => {
    expect(normalizeAiUsage({ promptTokens: 10, cachedPromptTokens: 0 })).toMatchObject({ cachedPromptTokens: 0, uncachedPromptTokens: 10 })
    expect(normalizeAiUsage({ promptTokens: 10, completionTokens: 2 })).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12 })
  })
  it('rejects invalid counts and contradictory cache breakdowns', () => {
    expect(normalizeAiUsage({ promptTokens: -1, completionTokens: Infinity, cachedPromptTokens: NaN, totalTokens: '12', reasoningTokens: 1.5 })).toBeUndefined()
    expect(normalizeAiUsage({ promptTokens: 10, cachedPromptTokens: 20, completionTokens: 2 })).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12 })
    expect(normalizeAiUsage({ promptTokens: 10, cachedPromptTokens: 8, uncachedPromptTokens: 8 })).toEqual({ promptTokens: 10 })
  })
  it('derives input from explicit hit/miss data and supports misses without hits', () => {
    expect(normalizeAiUsage({ cachedPromptTokens: 8, uncachedPromptTokens: 2, completionTokens: 1 })).toMatchObject({ promptTokens: 10, totalTokens: 11 })
    expect(normalizeAiUsage({ promptTokens: 10, uncachedPromptTokens: 2 })).toMatchObject({ cachedPromptTokens: 8 })
  })
  it('aggregates tool rounds without discarding missing-provider information', () => {
    const usage = aggregateAiUsage([
      { promptTokens: 1000, cachedPromptTokens: 800, completionTokens: 100, reasoningTokens: 60 },
      { promptTokens: 2000, completionTokens: 200 },
    ])!
    expect(usage).toEqual({ requestCount: 2, promptTokens: 3000, cachedPromptTokens: 800, uncachedPromptTokens: 200, completionTokens: 300, reasoningTokens: 60, totalTokens: 3300, cacheUsageIncomplete: true })
    expect(normalizeAiUsage(usage)).toEqual(usage) // IPC and reload cannot turn the unknown input into cache misses.
  })
  it('marks interrupted or missing request statistics as partial and retains known totals', () => {
    const usage = aggregateAiUsage([{ promptTokens: 10, cachedPromptTokens: 0, completionTokens: 2 }, undefined])!
    expect(usage).toMatchObject({ totalTokens: 12, requestCount: 2, usageIncomplete: true, cacheUsageIncomplete: true })
    expect(normalizeAiUsage(usage)).toEqual(usage)
    expect(aggregateAiUsage([undefined])).toEqual({ requestCount: 1, usageIncomplete: true, cacheUsageIncomplete: true })
    expect(aggregateAiUsage([])).toBeUndefined()
  })
})
