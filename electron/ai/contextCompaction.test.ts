import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiChatStreamPayload, AiHistoryRecord, AiResolvedConfig } from '../../shared/types/ai'
import { maybeCompactAiContext } from './contextCompaction'

const settings: AiResolvedConfig = {
  baseUrl: 'https://example.test/v1',
  apiKey: 'secret',
  model: 'test-model',
  systemPrompt: '',
  temperature: 0.7,
  contextWindowTokens: 10_000,
}

function records(): AiHistoryRecord[] {
  const long = 'x'.repeat(12_000)
  return [
    { id: 'u1', role: 'user', content: long, createdAt: 1 },
    { id: 'a1', role: 'assistant', content: long, status: 'completed', createdAt: 2 },
    { id: 'u2', role: 'user', content: long, createdAt: 3 },
    { id: 'a2', role: 'assistant', content: long, status: 'completed', createdAt: 4 },
  ]
}

afterEach(() => vi.unstubAllGlobals())

describe('maybeCompactAiContext', () => {
  it('uses native Claude requests and accounts for summary cache writes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ type: 'message', content: [{ type: 'text', text: '## 用户目标与意图\n- 继续部署' }], stop_reason: 'end_turn', usage: { input_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 50, output_tokens: 20 } }))
    vi.stubGlobal('fetch', fetchMock)
    const onUsage = vi.fn()
    const saved = vi.fn(async () => {})
    const result = await maybeCompactAiContext({ records: records(), settings: { ...settings, protocol: 'anthropic' }, signal: new AbortController().signal, emit: () => {}, saveCheckpoint: saved, onUsage })
    expect(saved).toHaveBeenCalledOnce()
    expect(result.checkpoint?.throughMessageId).toBe('a1')
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/v1/messages')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.system[0].text).toContain('context compaction engine')
    expect(body.messages.every((message: any) => ['user', 'assistant'].includes(message.role))).toBe(true)
    expect(body.tools).toBeUndefined()
    expect(body.stream).toBe(false)
    expect(onUsage).toHaveBeenCalledWith({ promptTokens: 350, cachedPromptTokens: 200, uncachedPromptTokens: 150, cacheCreationPromptTokens: 50, completionTokens: 20, totalTokens: 370 })
  })
  it('does nothing below the pressure threshold', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const events: AiChatStreamPayload[] = []
    const saved = vi.fn()
    const result = await maybeCompactAiContext({
      records: [{ id: 'u1', role: 'user', content: 'hello', createdAt: 1 }],
      settings,
      signal: new AbortController().signal,
      emit: event => events.push(event),
      saveCheckpoint: saved,
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(saved).not.toHaveBeenCalled()
    expect(events).toEqual([])
    expect(result.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('summarizes old turns, persists the checkpoint, and reports pressure reduction', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: '## 用户目标与意图\n- 继续任务' } }],
      usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 800 } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const onUsage = vi.fn()
    const events: AiChatStreamPayload[] = []
    const saved = vi.fn(async () => {})
    const result = await maybeCompactAiContext({
      records: records(),
      settings,
      signal: new AbortController().signal,
      emit: event => events.push(event),
      saveCheckpoint: saved,
      onUsage,
    })
    expect(onUsage).toHaveBeenCalledWith({ promptTokens: 1000, cachedPromptTokens: 800, uncachedPromptTokens: 200, completionTokens: 100, totalTokens: 1100 })
    expect(onUsage).toHaveBeenCalledTimes(1)
    expect(saved).toHaveBeenCalledOnce()
    expect(result.checkpoint?.throughMessageId).toBe('a1')
    expect(result.checkpoint?.compactionCount).toBe(1)
    expect(result.messages[0].content).toContain('<compacted-summary>')
    expect(events.map(event => event.type === 'compaction' && event.value.phase))
      .toEqual(['start', 'done'])
    const done = events[1]
    expect(done.type === 'compaction' && done.value.afterTokens).toBeLessThan(
      done.type === 'compaction' ? done.value.beforeTokens : 0,
    )
  })

  it('falls back without saving when summarization fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: '' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const events: AiChatStreamPayload[] = []
    const saved = vi.fn()
    const result = await maybeCompactAiContext({
      records: records(),
      settings,
      signal: new AbortController().signal,
      emit: event => events.push(event),
      saveCheckpoint: saved,
    })
    expect(saved).not.toHaveBeenCalled()
    expect(result.checkpoint).toBeUndefined()
    expect(events.at(-1)).toMatchObject({ type: 'compaction', value: { phase: 'failed' } })
    warning.mockRestore()
  })

  it('counts one successful checkpoint, even when summary generation takes multiple chunks', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '## 关键约定\n- 保留操作结论' } }] })))
    vi.stubGlobal('fetch', fetcher)
    const saved = vi.fn(async () => {})
    const events: AiChatStreamPayload[] = []
    const history: AiHistoryRecord[] = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(12000), createdAt: i }))
    const result = await maybeCompactAiContext({ records: history, compactionCount: 2, settings, signal: new AbortController().signal, emit: event => events.push(event), saveCheckpoint: saved })
    expect(fetcher.mock.calls.length).toBeGreaterThan(1)
    expect(saved).toHaveBeenCalledOnce()
    expect(result.checkpoint?.compactionCount).toBe(3)
    expect(events.at(-1)).toMatchObject({ type: 'compaction', value: { phase: 'done', compactionCount: 3 } })
  })

  it('does not count tool-output pruning as another conversation summary', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const saved = vi.fn()
    const events: AiChatStreamPayload[] = []
    const history: AiHistoryRecord[] = [
      { id: 'u', role: 'user', content: '查看日志', createdAt: 1 },
      { id: 'a', role: 'assistant', content: '结果', createdAt: 2, apiMessages: [
        { role: 'assistant', content: '', toolCalls: [{ id: 't', type: 'function', function: { name: 'exec', arguments: '{}' } }] },
        { role: 'tool', toolCallId: 't', content: 'x'.repeat(24000) },
        { role: 'assistant', content: '结果' },
      ] },
    ]
    await maybeCompactAiContext({ records: history, compactionCount: 2, settings, signal: new AbortController().signal, emit: event => events.push(event), saveCheckpoint: saved })
    expect(fetcher).not.toHaveBeenCalled()
    expect(saved).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ type: 'compaction', value: { phase: 'done', compactedMessages: 0 } })
    expect(events.at(-1)).not.toHaveProperty('value.compactionCount')
  })
})
