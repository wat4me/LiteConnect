import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiChatResult, AiChatStreamPayload, AiHistoryRecord } from '../../shared/types/ai'
import { runPersistedAiReply } from './streamPersistence'

vi.mock('../i18n', () => ({ t: (key: string) => key }))
afterEach(() => vi.useRealTimers())
const target = { sessionId: 'session', threadId: 'thread', assistantMessageId: 'reply', createdAt: 1 }

describe('main-process stream persistence', () => {
  it('saves continuous output and tool boundaries even when publishing throws', async () => {
    vi.useFakeTimers()
    const records: AiHistoryRecord[] = []
    let emit!: (event: AiChatStreamPayload) => void
    let boundary!: () => Promise<void>
    let finish!: (reply: AiChatResult) => void
    const pending = runPersistedAiReply({
      target, save: async r => { records.push(r) },
      publish: () => { throw new Error('renderer destroyed') },
      run: async (send, checkpoint) => {
        emit = send; boundary = checkpoint
        return new Promise<AiChatResult>(resolve => { finish = resolve })
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(records).toHaveLength(1)
    emit({ type: 'tool', value: { id: 't', name: 'grep', args: '{"pattern":"DOCKER|copy"}', phase: 'running' } })
    await boundary()
    expect(records.at(-1)?.toolRuns?.[0]).toMatchObject({ status: 'running', args: '{"pattern":"DOCKER|copy"}' })
    for (let i = 0; i < 24; i++) {
      emit({ type: 'reasoning', value: 'x' })
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(records.some(r => r.reasoningContent?.length === 12)).toBe(true)
    emit({ type: 'tool', value: { id: 't', name: 'grep', content: 'found', phase: 'done' } })
    await boundary()
    emit({ type: 'content', value: 'answer' })
    finish({ content: 'answer', apiMessages: [{ role: 'assistant', content: 'answer' }] })
    const reply = await pending
    expect(records.at(-1)).toMatchObject({ content: 'answer', reasoningContent: 'x'.repeat(24) })
    expect(reply.toolRuns?.[0]).toMatchObject({ status: 'done', content: 'found' })
    expect(reply.segments?.map(s => s.kind)).toEqual(['tool', 'reasoning', 'content'])
    expect(records.every(r => r.id === 'reply')).toBe(true)
    expect(records[1].toolRuns?.[0].status).toBe('running') // Snapshots never mutate later.
    const count = records.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(records).toHaveLength(count)
  })

  it('keeps saving the original target after the live UI session changes', async () => {
    const live = { sessionId: 'session-a', threadId: 'thread-a' }
    const target = { sessionId: 'session-a', threadId: 'thread-a', assistantMessageId: 'reply', createdAt: 1 }
    const saved: string[] = []
    await runPersistedAiReply({
      target,
      save: async (record) => { saved.push(`${target.sessionId}:${record.id}`) },
      publish: () => {},
      run: async (emit) => {
        live.sessionId = 'session-b'
        live.threadId = 'thread-b'
        emit({ type: 'content', value: 'kept' })
        return { content: 'kept' }
      },
    })
    expect(saved.length).toBeGreaterThan(0)
    expect(saved.every((row) => row === 'session-a:reply')).toBe(true)
  })

  it.each(['failed', 'aborted'])('retains partial output when the stream is %s', async (mode) => {
    const records: AiHistoryRecord[] = []
    const result = await runPersistedAiReply({
      target, save: async r => { records.push(r) }, publish: () => {},
      run: async emit => {
        emit({ type: 'content', value: 'partial' })
        if (mode === 'aborted') return { content: '', aborted: true }
        throw new Error('connection lost')
      },
    })
    expect(result.content).toContain('partial')
    expect(records.at(-1)?.content).toBe(result.content)
    if (mode === 'failed') {
      expect(result.error).toBe(true)
      expect(result.segments?.at(-1)).toMatchObject({ text: 'partial\n\nconnection lost' })
    } else expect(result.aborted).toBe(true)
  })
})
