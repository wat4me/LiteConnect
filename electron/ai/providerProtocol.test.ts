import { describe, expect, it } from 'vitest'
import { normalizeAiBaseUrl, readAiStream } from './providers/http'
import { extractAiUsage, getAiChatCompletionsUrl, normalizeAiContent, toApiChatMessages } from './providers/openai'
import { clampTemperature } from './settingsValidation'
import { validateAiMessages } from '../../shared/aiMessages'


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

  it('keeps assistant reasoning for tool-mode round-trips', () => {
    const out = validateAiMessages([
      { role: 'assistant', content: 'ok', reasoning_content: 'plan' },
    ])
    expect(out).toEqual([{ role: 'assistant', content: 'ok', reasoningContent: 'plan' }])
  })

  it('accepts tool results', () => {
    const out = validateAiMessages([
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    ])
    expect(out).toEqual([{ role: 'tool', content: 'ok', toolCallId: 'c1' }])
  })
})

describe('toApiChatMessages', () => {
  it('emits reasoning_content only when tools are on', () => {
    const msgs = [{ role: 'assistant', content: 'ok', reasoningContent: 'plan' }]
    expect(toApiChatMessages(msgs, true)).toEqual([
      { role: 'assistant', content: 'ok', reasoning_content: 'plan' },
    ])
    expect(toApiChatMessages(msgs, false)).toEqual([{ role: 'assistant', content: 'ok' }])
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

  it('reads OpenAI cache details and derives uncached input', () => {
    expect(extractAiUsage({ prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 800 }, completion_tokens_details: { reasoning_tokens: 60 } })).toEqual({
      promptTokens: 1000, completionTokens: 100, totalTokens: 1100, cachedPromptTokens: 800, uncachedPromptTokens: 200, reasoningTokens: 60,
    })
  })
  it('reads DeepSeek cache hit and miss fields, including zero hits', () => {
    expect(extractAiUsage({ prompt_tokens: 10, completion_tokens: 2, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10 })).toMatchObject({ cachedPromptTokens: 0, uncachedPromptTokens: 10, totalTokens: 12 })
    expect(extractAiUsage({ prompt_cache_hit_tokens: 8, prompt_cache_miss_tokens: 2, completion_tokens: 1 })).toMatchObject({ promptTokens: 10, cachedPromptTokens: 8, uncachedPromptTokens: 2, totalTokens: 11 })
  })
  it('keeps unknown cache usage unknown and rejects malformed numbers', () => {
    expect(extractAiUsage({ prompt_tokens: 10 })).toEqual({ promptTokens: 10 })
    expect(extractAiUsage({ prompt_tokens: -1, total_tokens: Infinity })).toBeUndefined()
  })

  it('joins array content parts', () => {
    expect(normalizeAiContent([{ text: 'a' }, { content: 'b' }])).toBe('a\nb')
  })
})

describe('clampTemperature', () => {
  it('clamps temperature to 0–2', () => {
    expect(clampTemperature(9)).toBe(2)
    expect(clampTemperature(-1)).toBe(0)
    expect(clampTemperature('x')).toBe(0.7)
  })
})

describe('readAiStream', () => {
  it('flushes a final SSE event without a trailing blank line', async () => {
    const events: any[] = []
    const response = new Response('data: {"choices":[{"delta":{"content":"tail"}}]}')
    await readAiStream(response, event => events.push(event))
    expect(events[0]?.choices?.[0]?.delta?.content).toBe('tail')
  })
})

describe('toApiChatMessages', () => {
  it('emits reasoning_content and tool_calls only when tools are on', () => {
    const msgs = [
      { role: 'user' as const, content: 'q' },
      {
        role: 'assistant' as const,
        content: '',
        reasoningContent: 'plan',
        toolCalls: [{ id: 'c1', type: 'function' as const, function: { name: 'exec', arguments: '{}' } }],
      },
      { role: 'tool' as const, content: 'ok', toolCallId: 'c1' },
      { role: 'assistant' as const, content: 'done', reasoningContent: 'end' },
    ]
    expect(toApiChatMessages(msgs, true)).toEqual([
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'plan',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'exec', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
      { role: 'assistant', content: 'done', reasoning_content: 'end' },
    ])
    expect(toApiChatMessages(msgs, false)).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'done' },
    ])
  })

  it('drops incomplete tool protocol before sending', () => {
    const out = toApiChatMessages([
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'c1', type: 'function', function: { name: 'exec', arguments: '{}' } },
          { id: 'c2', type: 'function', function: { name: 'exec', arguments: '{}' } },
        ],
      },
      { role: 'tool', toolCallId: 'c1', content: 'only one result' },
      { role: 'assistant', content: 'later answer' },
      { role: 'tool', toolCallId: 'orphan', content: 'orphan result' },
    ], true)
    expect(out).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'later answer' },
    ])
  })
})
