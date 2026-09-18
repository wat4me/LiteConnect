import { runPersistedAiReply } from './streamPersistence'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import {
  readAiSessionStore,
  readAiSessionStoreAndGc,
  upsertAiHistoryRecord,
  writeAiContextCheckpoint,
  writeAiSessionStore,
} from './historyStore'
import { closeAppDatabase, initializeAppDatabase } from '../store/appDatabase'

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
})
