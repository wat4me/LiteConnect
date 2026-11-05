import { describe, expect, it } from 'vitest'
import { lookupModelsDevContext, lookupModelsDevOutput } from './modelsDevContext'

describe('lookupModelsDevContext', () => {
  it('matches full ids and short names', () => {
    expect(lookupModelsDevContext('openai/gpt-4o')).toBe(128_000)
    expect(lookupModelsDevContext('GPT-4o')).toBe(128_000)
    expect(lookupModelsDevContext('deepseek/deepseek-chat')).toBe(1_000_000)
    expect(lookupModelsDevContext('unknown-model')).toBeUndefined()
    expect(lookupModelsDevContext('')).toBeUndefined()
  })
})

describe('lookupModelsDevOutput', () => {
  it('matches advertised per-reply output limits', () => {
    expect(lookupModelsDevOutput('openai/gpt-4o')).toBe(16_384)
    expect(lookupModelsDevOutput('gpt-4o')).toBe(16_384)
    expect(lookupModelsDevOutput('deepseek/deepseek-chat')).toBe(384_000)
    expect(lookupModelsDevOutput('unknown-model')).toBeUndefined()
    expect(lookupModelsDevOutput('')).toBeUndefined()
  })
})
