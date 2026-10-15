import { describe, expect, it } from 'vitest'
import {
  appendFinalAssistantTurn,
  flattenConversationForApi,
  limitAiMessagesPreservingToolProtocol,
  sanitizeAiToolProtocol,
  validateAiMessages,
} from './aiMessages'

it('replays application background results once without inventing a second tool response', () => {
  const messages = flattenConversationForApi([
    { role: 'user', content: 'restart the container' },
    { role: 'assistant', status: 'completed', content: 'healthy', backgroundNotice: 'Application result: exit code 0, healthy',
      apiMessages: [{ role: 'assistant', content: 'healthy' }] },
  ])
  expect(messages).toEqual([
    { role: 'user', content: 'restart the container' },
    { role: 'user', content: 'Application result: exit code 0, healthy' },
    { role: 'assistant', content: 'healthy' },
  ])
  expect(flattenConversationForApi([{ role: 'assistant', status: 'running', content: '', backgroundNotice: 'not yet delivered' }])).toEqual([])
  expect(flattenConversationForApi([{ role: 'assistant', error: true, content: 'API failed', backgroundNotice: 'result retained' }])).toEqual([{ role: 'user', content: 'result retained' }])
})

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

describe('tool protocol repair', () => {
  const calls = [
    { id: 'c1', type: 'function' as const, function: { name: 'exec', arguments: '{}' } },
    { id: 'c2', type: 'function' as const, function: { name: 'exec', arguments: '{}' } },
  ]

  it('keeps complete calls and orders their results by call id', () => {
    const repaired = sanitizeAiToolProtocol([
      { role: 'assistant', content: '', toolCalls: calls },
      { role: 'tool', toolCallId: 'c2', content: 'two' },
      { role: 'tool', toolCallId: 'c1', content: 'one' },
    ])
    expect(repaired.map((message) => message.role === 'tool' ? message.toolCallId : message.role)).toEqual([
      'assistant', 'c1', 'c2',
    ])
  })

  it('never applies a message limit through the middle of a tool unit', () => {
    const source = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '', toolCalls: calls },
      { role: 'tool', toolCallId: 'c1', content: 'one' },
      { role: 'tool', toolCallId: 'c2', content: 'two' },
    ]
    expect(limitAiMessagesPreservingToolProtocol(source, 3)).toEqual([{ role: 'user', content: 'q' }])
    expect(limitAiMessagesPreservingToolProtocol(source, 4)).toHaveLength(4)
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

  it('does not replay interrupted or unfinished assistant output', () => {
    expect(flattenConversationForApi([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'partial', status: 'aborted' },
      { role: 'assistant', content: 'still running', status: 'running' },
      { role: 'assistant', content: 'complete', status: 'completed' },
    ])).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'complete' },
    ])
  })
})

describe('appendFinalAssistantTurn', () => {
  it('retains the live reply and original provider metadata without history truncation', () => {
    const content = 'x'.repeat(200_001)
    const anthropicContent = [{ type: 'thinking' as const, thinking: '', signature: 'opaque+/==' }]
    const tail = appendFinalAssistantTurn([], { content, anthropicContent }).at(-1)!
    expect(tail.content.length).toBe(content.length)
    expect(tail.content).toBe(content)
    expect(tail.anthropicContent).toEqual(anthropicContent)
    expect(appendFinalAssistantTurn([], { content: '', anthropicContent })).toHaveLength(1)
  })
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
