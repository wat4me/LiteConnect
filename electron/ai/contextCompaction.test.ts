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
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const events: AiChatStreamPayload[] = []
    const saved = vi.fn(async () => {})
    const result = await maybeCompactAiContext({
      records: records(),
      settings,
      signal: new AbortController().signal,
      emit: event => events.push(event),
      saveCheckpoint: saved,
    })
    expect(saved).toHaveBeenCalledOnce()
    expect(result.checkpoint?.throughMessageId).toBe('a1')
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
})
