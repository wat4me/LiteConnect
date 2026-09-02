import { describe, expect, it } from 'vitest'
import {
  clampTemperature,
  extractAiUsage,
  getAiChatCompletionsUrl,
  normalizeAiBaseUrl,
  normalizeAiContent,
  sanitizeGeneratedTitle,
  validateAiMessages,
} from './providerHttp'

describe('normalizeAiBaseUrl', () => {
  it('strips trailing slash', () => {
    expect(normalizeAiBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1')
  })

  it('rejects non-http protocols', () => {
    expect(() => normalizeAiBaseUrl('ftp://x')).toThrow(/http or https/)
  })
})

describe('getAiChatCompletionsUrl', () => {
  it('appends chat/completions when missing', () => {
    expect(getAiChatCompletionsUrl('https://api.example.com/v1')).toBe(
      'https://api.example.com/v1/chat/completions',
    )
  })

  it('keeps an already complete URL', () => {
    expect(getAiChatCompletionsUrl('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions',
    )
  })
})

describe('validateAiMessages', () => {
  it('caps content length and keeps valid roles', () => {
    const out = validateAiMessages([{ role: 'user', content: 'hi' }])
    expect(out).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('rejects empty content', () => {
    expect(() => validateAiMessages([{ role: 'user', content: '  ' }])).toThrow()
  })
})

describe('extractAiUsage / normalizeAiContent', () => {
  it('maps snake_case usage', () => {
    expect(extractAiUsage({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 })).toEqual({
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      reasoningTokens: undefined,
    })
  })

  it('joins array content parts', () => {
    expect(normalizeAiContent([{ text: 'a' }, { content: 'b' }])).toBe('a\nb')
  })
})

describe('clampTemperature / sanitizeGeneratedTitle', () => {
  it('clamps temperature to 0–2', () => {
    expect(clampTemperature(9)).toBe(2)
    expect(clampTemperature(-1)).toBe(0)
    expect(clampTemperature('x')).toBe(0.7)
  })

  it('strips title prefixes and quotes', () => {
    expect(sanitizeGeneratedTitle('标题：磁盘检查')).toBe('磁盘检查')
    expect(sanitizeGeneratedTitle('新对话')).toBe('')
  })
})
