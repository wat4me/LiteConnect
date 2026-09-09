import { describe, expect, it } from 'vitest'
import {
  appendFinalAssistantTurn,
  flattenConversationForApi,
  toApiChatMessages,
  validateAiMessages,
} from './aiMessages'

describe('validateAiMessages', () => {
  it('accepts Chat Completions tool turns', () => {
    const out = validateAiMessages([
      { role: 'user', content: 'df' },
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'check disk',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'exec', arguments: '{"command":"df -h"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: '/ 12%' },
      { role: 'assistant', content: '磁盘还够。' },
    ])
    expect(out[1]).toMatchObject({
      role: 'assistant',
      content: '',
      reasoningContent: 'check disk',
      toolCalls: [{ id: 'c1', type: 'function', function: { name: 'exec', arguments: '{"command":"df -h"}' } }],
    })
    expect(out[2]).toEqual({ role: 'tool', toolCallId: 'c1', content: '/ 12%' })
  })

  it('rejects empty user content', () => {
    expect(() => validateAiMessages([{ role: 'user', content: '  ' }])).toThrow()
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
})

describe('flattenConversationForApi', () => {
  it('replays stored wire messages instead of display cards', () => {
    const out = flattenConversationForApi([
      { role: 'user', content: '看看磁盘' },
      {
        role: 'assistant',
        content: '磁盘还够。',
        reasoningContent: 'check disk',
        apiMessages: [
          {
            role: 'assistant',
            content: '',
            reasoningContent: 'check disk',
            toolCalls: [{ id: 'c1', type: 'function', function: { name: 'exec', arguments: '{"command":"df"}' } }],
          },
          { role: 'tool', toolCallId: 'c1', content: 'Use% 12' },
          { role: 'assistant', content: '磁盘还够。' },
        ],
      },
      { role: 'user', content: '再看看内存' },
    ])
    expect(out).toEqual([
      { role: 'user', content: '看看磁盘' },
      {
        role: 'assistant',
        content: '',
        reasoningContent: 'check disk',
        toolCalls: [{ id: 'c1', type: 'function', function: { name: 'exec', arguments: '{"command":"df"}' } }],
      },
      { role: 'tool', toolCallId: 'c1', content: 'Use% 12' },
      { role: 'assistant', content: '磁盘还够。' },
      { role: 'user', content: '再看看内存' },
    ])
  })
})

describe('appendFinalAssistantTurn', () => {
  it('appends the text-only tail after tool results', () => {
    const generated = appendFinalAssistantTurn(
      [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', type: 'function', function: { name: 'exec', arguments: '{}' } }],
        },
        { role: 'tool', content: 'ok', toolCallId: 'c1' },
      ],
      { content: 'done', reasoningContent: 'wrap' },
    )
    expect(generated[generated.length - 1]).toEqual({
      role: 'assistant',
      content: 'done',
      reasoningContent: 'wrap',
    })
  })
})
