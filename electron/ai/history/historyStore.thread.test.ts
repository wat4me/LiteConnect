import { runPersistedAiReply } from '../execution/streamPersistence'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import {
  createNewConversationAtomic,
  mutateAiSessionStore,
  previewAiHistoryPrune,
  readAiSessionStore,
  readAiSessionStoreAndGc,
  updateAiConversationMetadata,
  upsertAiHistoryRecord,
  writeAiContextCheckpoint,
  writeAiSessionStore,
} from './historyStore'
import { closeAppDatabase, initializeAppDatabase } from '../../store/appDatabase'
import type { AiChatMessage, AiChatSegment, AiToolRun } from '../../../shared/types/ai'

it('persists loaded capabilities across pruning/reload and starts new conversations without them', async () => {
  const session = 'loaded-tool-history'
  await writeAiSessionStore(session, { version: 1, activeThreadId: 'loaded', defaultContextFiles: [], threads: [{
    id: 'loaded', title: '', createdAt: 1, updatedAt: 1, contextFiles: [], messages: [
      { id: 'loader', role: 'assistant', content: '', status: 'completed', createdAt: 1, toolRuns: [{
        id: 'load-call', name: 'load_tools', args: '{"groups":["file_transfer"]}', content: '{}', status: 'done', isError: false,
      }] },
      ...Array.from({ length: 24 }, (_, i) => ({ id: `recent-${i}`, role: 'user' as const, content: 'continue', createdAt: i + 2 })),
    ],
  }] }, { maxMessages: 20 })
  let stored = await readAiSessionStore(session)
  expect(stored.threads[0].messages.some(message => message.id === 'loader')).toBe(false)
  expect(stored.threads[0].toolGroups).toEqual(['file_transfer'])
  await writeAiSessionStore(session, stored)
  stored = await readAiSessionStore(session)
  expect(stored.threads[0].toolGroups).toEqual(['file_transfer'])
  const fresh = await createNewConversationAtomic(session, {})
  expect(fresh.threads.find(thread => thread.id === fresh.activeThreadId)?.toolGroups).toBeUndefined()
  expect(fresh.threads.find(thread => thread.id === 'loaded')?.toolGroups).toEqual(['file_transfer'])
})

it('serializes queued mutations through failures without blocking other sessions', async () => {
  const order: string[] = []
  let releaseFirst!: () => void
  let releaseSecond!: () => void
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
  const secondGate = new Promise<void>(resolve => { releaseSecond = resolve })
  const first = mutateAiSessionStore('queue-session', async () => {
    order.push('first')
    await firstGate
  })
  const second = mutateAiSessionStore('queue-session', async () => {
    order.push('second')
    await secondGate
    throw new Error('failed mutation')
  })
  // Attach the rejection handler before releasing the task.
  const rejected = expect(second).rejects.toThrow('failed mutation')
  await mutateAiSessionStore('other-queue-session', () => { order.push('other') })
  expect(order).toEqual(['first', 'other'])
  releaseFirst()
  await first
  await vi.waitFor(() => expect(order).toEqual(['first', 'other', 'second']))
  const third = mutateAiSessionStore('queue-session', store => {
    order.push('third')
    store.threads[0].messages = [{ id: 'q', role: 'user', content: 'retained', createdAt: 1 }]
  })
  await Promise.resolve()
  expect(order).toEqual(['first', 'other', 'second'])
  releaseSecond()
  await rejected
  await third
  expect(order).toEqual(['first', 'other', 'second', 'third'])
  expect((await readAiSessionStore('queue-session')).threads[0].messages[0].content).toBe('retained')
})

const appPath = vi.hoisted(() => ({ value: '' }))
vi.mock('electron', () => ({ app: { getPath: () => appPath.value } }))
beforeAll(async () => {
  appPath.value = await mkdtemp(join(tmpdir(), 'lite-ai-history-test-'))
  await initializeAppDatabase(appPath.value)
})
afterAll(async () => {
  closeAppDatabase()
  const root = resolve(appPath.value)
  if (!root.startsWith(resolve(tmpdir()) + sep) || !root.includes('lite-ai-history-test-')) throw new Error('Invalid test directory')
  await rm(root, { recursive: true, force: true })
})

it('previews conversation and turn-aware message cleanup without changing stored history', async () => {
  const limits = { maxThreads: 1, maxMessages: 20 }
  const before = await previewAiHistoryPrune(limits)
  const messages = Array.from({ length: 22 }, (_, index) => ({ id: `preview-${index}`, role: index % 2 ? 'assistant' as const : 'user' as const, content: 'preview', createdAt: index + 1 }))
  await writeAiSessionStore('cleanup-preview', {
    version: 1, activeThreadId: 'active', defaultContextFiles: [],
    threads: [
      { id: 'active', title: '', createdAt: 1, updatedAt: 3, messages, contextFiles: [] },
      { id: 'pinned', title: '', createdAt: 1, updatedAt: 2, pinned: true, messages: messages.slice(0, 6), contextFiles: [] },
      { id: 'old', title: '', createdAt: 1, updatedAt: 1, messages: messages.slice(0, 4), contextFiles: [] },
    ],
  }, { maxThreads: 200, maxMessages: 2000 })
  const after = await previewAiHistoryPrune(limits)
  expect(after.conversations - before.conversations).toBe(1)
  expect(after.messages - before.messages).toBe(6)
  const unchanged = await readAiSessionStore('cleanup-preview', { maxThreads: 200, maxMessages: 2000 })
  expect(unchanged.threads).toHaveLength(3)
  expect(unchanged.threads.find(thread => thread.id === 'active')?.messages).toHaveLength(22)
})

it('writes to the original thread after the active thread changes and refuses deleted targets', async () => {
  await writeAiSessionStore('session', {
    version: 1, activeThreadId: 'new',
    threads: [
      { id: 'old', title: '', createdAt: 1, updatedAt: 1, messages: [{ id: 'u', role: 'user', content: 'question', createdAt: 1 }] },
      { id: 'new', title: '', createdAt: 2, updatedAt: 2, messages: [] },
    ],
  })
  const record = { id: 'a', role: 'assistant', content: 'checkpoint', createdAt: 3, completedAt: 4 }
  await upsertAiHistoryRecord('session', record, 'old')
  await upsertAiHistoryRecord('session', { ...record, content: 'final' }, 'old')
  const store = await readAiSessionStore('session')
  expect(store.activeThreadId).toBe('new')
  expect(store.threads.find(t => t.id === 'new')?.messages).toEqual([])
  expect(store.threads.find(t => t.id === 'old')?.messages.map(m => m.content)).toEqual(['question', 'final'])
  expect(store.threads.find(t => t.id === 'old')?.messages.at(-1)?.completedAt).toBe(4)
  await expect(upsertAiHistoryRecord('session', record, 'deleted')).rejects.toThrow('no longer exists')
})

it('re-derives the title from the first user message, ignoring stored titles', async () => {
  await writeAiSessionStore('title-session', {
    version: 1,
    activeThreadId: 't1',
    threads: [
      {
        // Legacy payload: a model-written summary plus the stale flag.
        id: 't1',
        title: '磁盘检查',
        titleGenerated: true,
        createdAt: 1,
        updatedAt: 1,
        messages: [
          { id: 'u', role: 'user', content: '帮我看看这台机器的磁盘占用', createdAt: 1 },
          { id: 'a', role: 'assistant', content: '好的', createdAt: 2 },
        ],
      },
    ],
  })
  const store = await readAiSessionStore('title-session')
  expect(store.threads[0].title).toBe('帮我看看这台机器的磁盘占用')
})

it('adopts the client thread id on the first write when no history exists yet', async () => {
  await upsertAiHistoryRecord(
    'fresh-session',
    { id: 'u', role: 'user', content: 'hi', createdAt: 1 },
    'client-thread',
  )
  const store = await readAiSessionStore('fresh-session')
  expect(store.activeThreadId).toBe('client-thread')
  expect(store.threads.map((thread) => thread.id)).toEqual(['client-thread'])
  expect(store.threads[0].messages.map((m) => m.content)).toEqual(['hi'])
})

it('retains the approval diff through completion and history reload', async () => {
  const diff = { diffSummary: 'changed', diffPreview: '-old\n+new' }
  const reply = await runPersistedAiReply({
    target: { sessionId: 'diff-session', threadId: 'diff-thread', assistantMessageId: 'a', createdAt: 1 },
    save: record => upsertAiHistoryRecord('diff-session', record, 'diff-thread'),
    publish: () => {},
    run: async (emit, checkpoint) => {
      emit({ type: 'tool', value: { id: 'c', name: 'write_file', phase: 'ask', ...diff } })
      await checkpoint()
      const pending = await readAiSessionStore('diff-session')
      expect(pending.threads[0].messages[0].toolRuns?.[0]).toMatchObject({ status: 'ask', ...diff })
      emit({ type: 'tool', value: { id: 'c', name: 'write_file', phase: 'done' } })
      return { content: 'done' }
    },
  })
  expect(reply.toolRuns?.[0]).toMatchObject(diff)
  const store = await readAiSessionStore('diff-session')
  expect(store.threads[0].messages[0].toolRuns?.[0]).toMatchObject({ status: 'done', ...diff })
})

it('keeps custom titles through message writes and protects pinned history from pruning', async () => {
  await writeAiSessionStore('pinned-session', {
    version: 1,
    activeThreadId: 'active',
    defaultContextFiles: [],
    threads: [
      { id: 'old', title: 'Old', createdAt: 1, updatedAt: 1, messages: [{ id: 'u-old', role: 'user', content: 'Old question', createdAt: 1 }], contextFiles: [] },
      { id: 'middle', title: 'Middle', createdAt: 2, updatedAt: 2, messages: [{ id: 'u-middle', role: 'user', content: 'Middle question', createdAt: 2 }], contextFiles: [] },
      { id: 'active', title: 'Active', createdAt: 3, updatedAt: 3, messages: [{ id: 'u-active', role: 'user', content: 'Active question', createdAt: 3 }], contextFiles: [] },
    ],
  })
  await updateAiConversationMetadata('pinned-session', 'old', { customTitle: 'Important host', pinned: true })
  await upsertAiHistoryRecord('pinned-session', { id: 'a-old', role: 'assistant', content: 'Done', createdAt: 4 }, 'old')
  const limited = await readAiSessionStore('pinned-session', { maxThreads: 2 })
  expect(limited.threads.map(thread => thread.id).sort()).toEqual(['active', 'old'])
  expect(limited.threads.find(thread => thread.id === 'old')).toMatchObject({ title: 'Important host', customTitle: 'Important host', pinned: true })
  await updateAiConversationMetadata('pinned-session', 'old', { customTitle: null }, { maxThreads: 2 })
  expect((await readAiSessionStore('pinned-session')).threads.find(thread => thread.id === 'old')?.title).toBe('Old question')
})

it('retains all tool protocol records through the configured 200-round ceiling', async () => {
  const apiMessages: AiChatMessage[] = []
  const toolRuns: AiToolRun[] = []
  const segments: AiChatSegment[] = []
  for (let round = 0; round < 200; round++) {
    const calls = [0, 1].map((offset) => ({
      id: `call-${round}-${offset}`,
      type: 'function' as const,
      function: { name: 'exec', arguments: '{}' },
    }))
    apiMessages.push({ role: 'assistant', content: '', toolCalls: calls })
    for (const call of calls) {
      apiMessages.push({ role: 'tool', toolCallId: call.id, content: 'ok' })
      toolRuns.push({ id: call.id, name: 'exec', args: '{}', content: 'ok', isError: false, status: 'done' })
      segments.push({ kind: 'tool', runId: call.id })
    }
  }
  apiMessages.push({ role: 'assistant', content: 'done' })

  await writeAiSessionStore('long-tool-session', {
    version: 1,
    activeThreadId: 'thread',
    threads: [{
      id: 'thread', title: '', createdAt: 1, updatedAt: 2,
      messages: [{
        id: 'assistant', role: 'assistant', content: 'done', createdAt: 2, status: 'completed',
        apiMessages, toolRuns, segments,
      }],
    }],
  })

  const restored = (await readAiSessionStore('long-tool-session')).threads[0].messages[0]
  expect(restored.apiMessages).toHaveLength(601)
  expect(restored.toolRuns).toHaveLength(400)
  expect(restored.segments).toHaveLength(400)
  expect(restored.apiMessages?.at(-1)).toMatchObject({ role: 'assistant', content: 'done' })
})

it('caps retained threads and messages while keeping the active thread', async () => {
  await writeAiSessionStore('limited-session', {
    version: 1,
    activeThreadId: 'old-active',
    threads: [
      {
        id: 'old-active', title: '', createdAt: 1, updatedAt: 1,
        messages: Array.from({ length: 22 }, (_, i) => ({
          id: `active-${i}`,
          role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
          content: `active ${i}`,
          createdAt: i + 1,
        })),
      },
      { id: 'middle', title: '', createdAt: 2, updatedAt: 2, messages: [{ id: 'm', role: 'user', content: 'middle', createdAt: 2 }] },
      { id: 'newest', title: '', createdAt: 3, updatedAt: 3, messages: [{ id: 'n', role: 'user', content: 'newest', createdAt: 3 }] },
    ],
  }, { maxThreads: 2, maxMessages: 20 })

  const store = await readAiSessionStore('limited-session', { maxThreads: 2, maxMessages: 20 })
  expect(store.activeThreadId).toBe('old-active')
  expect(store.threads.map(thread => thread.id)).toEqual(['old-active', 'newest'])
  expect(store.threads[0].messages).toHaveLength(20)
  expect(store.threads[0].messages[0].content).toBe('active 2')
  expect(store.threads[0].messages[19].content).toBe('active 21')
  expect(store.threads[0].title).toBe('active 2')
})

it('recovers persisted running replies and tool approvals as interrupted', async () => {
  await writeAiSessionStore('interrupted-session', {
    version: 1,
    activeThreadId: 'thread',
    threads: [{
      id: 'thread', title: '', createdAt: 1, updatedAt: 2,
      messages: [{
        id: 'assistant', role: 'assistant', content: '', createdAt: 2, status: 'running',
        toolRuns: [{ id: 'tool', name: 'exec', args: '{}', content: '', isError: false, status: 'ask' }],
      }],
    }],
  })

  const store = await readAiSessionStoreAndGc('interrupted-session')
  expect(store.threads[0].messages[0].status).toBe('aborted')
  expect(store.threads[0].messages[0].toolRuns?.[0].status).toBe('aborted')
  const persisted = await readAiSessionStore('interrupted-session')
  expect(persisted.threads[0].messages[0].status).toBe('aborted')
})

it('persists a valid context checkpoint and invalidates it when covered history changes', async () => {
  await writeAiSessionStore('checkpoint-session', {
    version: 1,
    activeThreadId: 'thread',
    threads: [{
      id: 'thread', title: '', createdAt: 1, updatedAt: 2,
      messages: [
        { id: 'u1', role: 'user', content: 'old question', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'old answer', createdAt: 2 },
        { id: 'u2', role: 'user', content: 'new question', createdAt: 3 },
      ],
    }],
  })
  await writeAiContextCheckpoint('checkpoint-session', 'thread', {
    version: 1,
    summary: 'structured summary',
    throughMessageId: 'a1',
    createdAt: 4,
    sourceTokens: 100,
    summaryTokens: 10,
  })
  expect((await readAiSessionStore('checkpoint-session')).threads[0].contextCheckpoint?.summary)
    .toBe('structured summary')

  await upsertAiHistoryRecord(
    'checkpoint-session',
    { id: 'u1', role: 'user', content: 'edited old question', createdAt: 1 },
    'thread',
  )
  expect((await readAiSessionStore('checkpoint-session')).threads[0].contextCheckpoint).toBeUndefined()
  expect((await readAiSessionStore('checkpoint-session')).threads[0].compactionCount).toBe(1)
})

it('retains successful compaction count across reload, history pruning and checkpoint invalidation', async () => {
  await writeAiSessionStore('count-session', { version: 1, activeThreadId: 't', defaultContextFiles: [], threads: [{
    id: 't', title: '', createdAt: 1, updatedAt: 1, contextFiles: [], messages: Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' as const : 'user' as const, content: `turn ${i}`, createdAt: i })),
  }] })
  const checkpoint = { version: 1 as const, summary: 'summary', throughMessageId: 'm1', createdAt: 1, sourceTokens: 100, summaryTokens: 10 }
  await writeAiContextCheckpoint('count-session', 't', checkpoint)
  await writeAiContextCheckpoint('count-session', 't', checkpoint)
  expect((await readAiSessionStore('count-session')).threads[0].compactionCount).toBe(1)
  for (let i = 2; i <= 3; i++) await writeAiContextCheckpoint('count-session', 't', { ...checkpoint, summary: `summary ${i}`, throughMessageId: `m${i * 2 - 1}`, compactionCount: i })
  const pruned = await readAiSessionStoreAndGc('count-session', { maxMessages: 20 })
  expect(pruned.threads[0].contextCheckpoint).toBeUndefined()
  expect(pruned.threads[0].compactionCount).toBe(3)
  expect((await readAiSessionStore('count-session')).threads[0].compactionCount).toBe(3)
})


it('retains partial cache accounting and request totals after saving and reloading history', async () => {
  const usage = { promptTokens: 3000, completionTokens: 300, totalTokens: 3300, cachedPromptTokens: 800, uncachedPromptTokens: 200, requestCount: 2, cacheUsageIncomplete: true }
  await writeAiSessionStore('cache-usage-history', { version: 1, activeThreadId: 'usage-thread', threads: [{ id: 'usage-thread', title: '', createdAt: 1, updatedAt: 1, messages: [{ id: 'usage-message', role: 'assistant', content: 'result', createdAt: 1, usage }] }] })
  const store = await readAiSessionStore('cache-usage-history')
  expect(store.threads[0].messages[0].usage).toEqual(usage)
})

it('retains Claude content order, opaque signatures and cache writes after reloading', async () => {
  const blocks: import('../../../shared/types/ai').AiAnthropicContentBlock[] = [
    { type: 'thinking', thinking: 'Inspect the host', signature: 'signature+/=='.repeat(400) },
    { type: 'redacted_thinking', data: 'encrypted+/==' },
    { type: 'tool_use', id: 'native-call', name: 'exec', input: { command: 'hostname' } },
  ]
  const apiMessages: AiChatMessage[] = [
    { role: 'assistant', content: '', reasoningContent: 'Inspect the host', anthropicContent: blocks, toolCalls: [{ id: 'native-call', type: 'function', function: { name: 'exec', arguments: '{"command":"hostname"}' } }] },
    { role: 'tool', toolCallId: 'native-call', content: 'host-a' },
    { role: 'assistant', content: 'done', anthropicContent: [{ type: 'text', text: 'done' }] },
  ]
  const usage = { promptTokens: 130, cachedPromptTokens: 100, uncachedPromptTokens: 30, cacheCreationPromptTokens: 20, completionTokens: 9, totalTokens: 139 }
  await writeAiSessionStore('claude-history', { version: 1, activeThreadId: 'claude-thread', threads: [{ id: 'claude-thread', title: '', createdAt: 1, updatedAt: 1, messages: [{ id: 'reply', role: 'assistant', content: 'done', createdAt: 1, apiMessages, usage }] }] })
  const message = (await readAiSessionStore('claude-history')).threads[0].messages[0]
  expect(message.apiMessages).toEqual(apiMessages)
  expect(message.usage).toEqual(usage)
})
