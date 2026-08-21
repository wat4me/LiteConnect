import { describe, expect, it } from 'vitest'
import {
  clampContextWindowTokens,
  estimateTokens,
  firstAiModelId,
  formatTokenCount,
  inferContextWindowTokens,
  isContextLengthError,
  packAiMessages,
  parseAiModels,
  resolveContextWindowTokens,
  resolveModelContextWindow,
  truncateToTokenBudget,
} from './aiContext'

describe('estimateTokens', () => {
  it('counts CJK near 1:1 and latin near 4 chars', () => {
    expect(estimateTokens('你好世界')).toBe(4)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcdefgh')).toBe(2)
  })
})

describe('formatTokenCount', () => {
  it('formats compact counts', () => {
    expect(formatTokenCount(12)).toBe('12')
    expect(formatTokenCount(1200)).toBe('1.2k')
    expect(formatTokenCount(12_400)).toBe('12k')
  })
})

describe('inferContextWindowTokens', () => {
  it('uses the models.dev snapshot, then a name suffix, then 300000', () => {
    expect(inferContextWindowTokens('gpt-4o')).toBe(128_000)
    expect(inferContextWindowTokens('openai/gpt-4o')).toBe(128_000)
    expect(inferContextWindowTokens('deepseek-chat')).toBe(1_000_000)
    expect(inferContextWindowTokens('qwen2.5-72b-128k')).toBe(128_000)
    expect(inferContextWindowTokens('unknown-model')).toBe(300_000)
  })
})

describe('clampContextWindowTokens / resolveContextWindowTokens', () => {
  it('treats empty as auto and clamps custom values', () => {
    expect(clampContextWindowTokens(undefined)).toBeUndefined()
    expect(clampContextWindowTokens(0)).toBeUndefined()
    expect(clampContextWindowTokens(8_000)).toBe(8_000)
    expect(clampContextWindowTokens(100)).toBe(4_096)
    expect(resolveContextWindowTokens('gpt-3.5-turbo')).toBe(16_385)
    expect(resolveContextWindowTokens('gpt-3.5-turbo', 64_000)).toBe(64_000)
  })
})

describe('isContextLengthError', () => {
  it('detects common provider wordings', () => {
    expect(isContextLengthError('This model maximum context length is 8192 tokens')).toBe(true)
    expect(isContextLengthError('prompt is too long')).toBe(true)
    expect(isContextLengthError('authentication failed')).toBe(false)
  })
})

describe('packAiMessages', () => {
  it('always keeps the system prompt and the latest user turn', () => {
    const pack = packAiMessages({
      systemPrompt: 'You are a helper',
      messages: [
        { role: 'user', content: 'old' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'latest question' },
      ],
      budgetTokens: 8_000,
    })
    expect(pack.messages[0]).toEqual({ role: 'system', content: 'You are a helper' })
    expect(pack.messages[pack.messages.length - 1].content).toContain('latest question')
    expect(pack.droppedCount).toBe(0)
  })

  it('drops oldest turns when the window is tight', () => {
    const messages = []
    for (let i = 0; i < 20; i++) {
      messages.push({ role: 'user' as const, content: `问${'题'.repeat(40)}${i}` })
      messages.push({ role: 'assistant' as const, content: `答${'案'.repeat(40)}${i}` })
    }
    const pack = packAiMessages({
      systemPrompt: 'sys',
      messages,
      budgetTokens: 2_000,
      reserveOutputTokens: 200,
    })
    expect(pack.droppedCount).toBeGreaterThan(0)
    expect(pack.messages.some((m) => m.role === 'user')).toBe(true)
    expect(pack.promptTokens).toBeLessThanOrEqual(pack.budgetTokens)
    const lastUser = [...pack.messages].reverse().find((m) => m.role === 'user')
    expect(lastUser?.content).toContain('19')
  })

  it('truncates a single oversized message instead of dropping it', () => {
    const pack = packAiMessages({
      messages: [{ role: 'user', content: '错'.repeat(20_000) }],
      budgetTokens: 4_000,
      reserveOutputTokens: 500,
      maxMessageTokens: 200,
    })
    expect(pack.messages).toHaveLength(1)
    expect(pack.truncatedCount).toBeGreaterThan(0)
    expect(pack.messages[0].content.includes('…')).toBe(true)
    expect(estimateTokens(pack.messages[0].content)).toBeLessThan(400)
  })
})

describe('parseAiModels / resolveModelContextWindow', () => {
  it('accepts legacy string models and object models', () => {
    expect(parseAiModels([' gpt-4o ', '', 'gpt-4o'])).toEqual([{ id: 'gpt-4o' }])
    expect(
      parseAiModels([{ id: 'deepseek-v4-flash', contextWindowTokens: 64_000 }, { name: 'mini' }]),
    ).toEqual([
      { id: 'deepseek-v4-flash', contextWindowTokens: 64_000 },
      { id: 'mini' },
    ])
    expect(firstAiModelId(['a', 'b'])).toBe('a')
  })

  it('uses the matching model window, then fallback, then the name', () => {
    const models = [
      { id: 'short', contextWindowTokens: 8_000 },
      { id: 'gpt-3.5-turbo' },
    ]
    expect(resolveModelContextWindow({ model: 'short', models })).toBe(8_000)
    expect(resolveModelContextWindow({ model: 'gpt-3.5-turbo', models })).toBe(16_385)
    expect(resolveModelContextWindow({ model: 'missing', models, fallback: 128_000 })).toBe(128_000)
  })
})

describe('truncateToTokenBudget', () => {
  it('keeps head and tail', () => {
    const text = `HEAD${'中'.repeat(200)}TAIL`
    const out = truncateToTokenBudget(text, 40)
    expect(out.startsWith('HEAD')).toBe(true)
    expect(out.endsWith('TAIL')).toBe(true)
    expect(out.includes('…')).toBe(true)
  })
})
