import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiChatStreamPayload, AiHistoryRecord, AiResolvedConfig } from '../../../shared/types/ai'
import { compactAiLiveMessages, maybeCompactAiContext } from './contextCompaction'
import { setMainLocale } from '../../i18n'

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

afterEach(() => { vi.unstubAllGlobals(); setMainLocale('zh-CN') })

describe('maybeCompactAiContext', () => {
  it('sends the English compaction instruction after changing the interface language', async () => {
    setMainLocale('en-US')
    const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '## User goals and intent\n- Continue inspecting the server.' }, finish_reason: 'stop' }] }))
    vi.stubGlobal('fetch', fetcher)
    await maybeCompactAiContext({ records: records(), settings, signal: new AbortController().signal, emit: () => {}, saveCheckpoint: async () => {} })
    expect(fetcher).toHaveBeenCalled()
    const request = JSON.parse(fetcher.mock.calls[0][1].body)
    const instruction = request.messages.at(-1).content
    expect(instruction).toContain('## User goals and intent')
    expect(instruction).not.toMatch(/\p{Script=Han}/u)
  })
  it.each([false, true])('retains a new completion event outside the durable history when summarization fails: %s', async fail => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: fail ? '' : '用户正在检查日志，后台统计已启动。' }, finish_reason: 'stop' }] }))
      vi.stubGlobal('fetch', fetcher)
      const history = records()
      history.push({ id: 'wake', role: 'assistant', content: '', status: 'running', createdAt: 5, backgroundNotice: 'not yet delivered' })
      const original = structuredClone(history)
      const event = { role: 'user' as const, content: 'Application background-task completion. job=count status=completed journal=19704363' }
      const saveCheckpoint = vi.fn()
      const result = await maybeCompactAiContext({ records: history, continuation: [event], settings, signal: new AbortController().signal, emit: () => {}, saveCheckpoint })
      expect(fetcher).toHaveBeenCalledOnce()
      expect(result.messages.at(-1)).toEqual(event)
      expect(result.messages.filter(message => message.content === event.content)).toHaveLength(1)
      expect(result.messages.some(message => message.content === 'not yet delivered')).toBe(false)
      expect(history).toEqual(original)
      expect(saveCheckpoint).toHaveBeenCalledTimes(fail ? 0 : 1)
    } finally { warning.mockRestore() }
  })
  it('persists manual compaction of a single completed exchange so the next request benefits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '目标：检查主机；检查已完成。' }, finish_reason: 'stop' }] })))
    const saved = vi.fn()
    const history: AiHistoryRecord[] = [
      { id: 'u1', role: 'user', content: '检查主机配置。'.repeat(100), createdAt: 1 },
      { id: 'a1', role: 'assistant', content: '已读取配置，检查已完成。'.repeat(100), status: 'completed', createdAt: 2 },
    ]
    const result = await maybeCompactAiContext({ force: true, records: history, settings: { ...settings, contextWindowTokens: 300000 }, signal: new AbortController().signal, emit: () => {}, saveCheckpoint: saved })
    expect(result.compacted).toBe(true)
    expect(result.checkpoint?.throughMessageId).toBe('a1')
    expect(result.messages).toHaveLength(1)
    expect(saved).toHaveBeenCalledOnce()
    expect(history).toHaveLength(2)
  })
  it('manually summarizes useful older history below the automatic threshold', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '目标：继续检查' }, finish_reason: 'stop' }] }))
    vi.stubGlobal('fetch', fetcher)
    const saved = vi.fn()
    const history: AiHistoryRecord[] = [
      { id: 'u1', role: 'user', content: '检查主机配置并保留当前环境。'.repeat(100), createdAt: 1 },
      { id: 'a1', role: 'assistant', content: '已读取配置，尚未修改。'.repeat(100), status: 'completed', createdAt: 2 },
      { id: 'u2', role: 'user', content: '继续', createdAt: 3 },
    ]
    const result = await maybeCompactAiContext({ force: true, records: history, settings: { ...settings, contextWindowTokens: 300000 }, signal: new AbortController().signal, emit: () => {}, saveCheckpoint: saved })
    expect(result.compacted).toBe(true)
    expect(result.checkpoint?.throughMessageId).toBe('a1')
    expect(saved).toHaveBeenCalledOnce()
    expect(history).toHaveLength(3)
  })

  it('keeps live tool calls paired and leaves the audit transcript untouched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '目标：继续检查；前两次读取已完成。' }, finish_reason: 'stop' }] })))
    const messages = [
      { role: 'user' as const, content: '检查'.repeat(100) },
      ...Array.from({ length: 3 }, (_, index) => [
        { role: 'assistant' as const, content: '', toolCalls: [{ id: `c${index}`, type: 'function' as const, function: { name: 'read_file', arguments: '{}' } }] },
        { role: 'tool' as const, toolCallId: `c${index}`, content: '结果'.repeat(1500) },
      ]).flat(),
    ]
    const original = structuredClone(messages)
    const result = await compactAiLiveMessages({ messages, force: true, settings: { ...settings, contextWindowTokens: 16000, compactionRetainTokens: 3500 }, signal: new AbortController().signal, emit: () => {} })
    expect(result[0].content).toContain('<compacted-summary>')
    expect(result.filter(message => message.role === 'tool').map(message => message.toolCallId)).toEqual(['c2'])
    expect(result.find(message => message.role === 'assistant')?.toolCalls?.[0].id).toBe('c2')
    expect(messages).toEqual(original)
  })
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
        { role: 'tool', toolCallId: 't', content: 'x'.repeat(28000) },
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
