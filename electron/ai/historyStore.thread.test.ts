import { runPersistedAiReply } from './streamPersistence'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import { readAiSessionStore, upsertAiHistoryRecord, writeAiSessionStore } from './historyStore'

const appPath = vi.hoisted(() => ({ value: '' }))
vi.mock('electron', () => ({ app: { getPath: () => appPath.value } }))
beforeAll(async () => { appPath.value = await mkdtemp(join(tmpdir(), 'lite-ai-history-test-')) })
afterAll(async () => {
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
  const record = { id: 'a', role: 'assistant', content: 'checkpoint', createdAt: 3 }
  await upsertAiHistoryRecord('session', record, 'old')
  await upsertAiHistoryRecord('session', { ...record, content: 'final' }, 'old')
  const store = await readAiSessionStore('session')
  expect(store.activeThreadId).toBe('new')
  expect(store.threads.find(t => t.id === 'new')?.messages).toEqual([])
  expect(store.threads.find(t => t.id === 'old')?.messages.map(m => m.content)).toEqual(['question', 'final'])
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
