import { describe, expect, it } from 'vitest'
import { lookupModelsDevContext } from './modelsDevContext'

describe('lookupModelsDevContext', () => {
  it('matches full ids and short names', () => {
    expect(lookupModelsDevContext('openai/gpt-4o')).toBe(128_000)
    expect(lookupModelsDevContext('GPT-4o')).toBe(128_000)
    expect(lookupModelsDevContext('deepseek/deepseek-chat')).toBe(1_000_000)
    expect(lookupModelsDevContext('unknown-model')).toBeUndefined()
    expect(lookupModelsDevContext('')).toBeUndefined()
  })
})
