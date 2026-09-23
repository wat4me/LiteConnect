import { runPersistedAiReply } from './streamPersistence'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import {
  createNewConversationAtomic,
  readAiSessionStore,
  readAiSessionStoreAndGc,
  removeAiConversationContextFile,
  setAiConversationContextFile,
  upsertAiHistoryRecord,
  writeAiContextCheckpoint,
  writeAiSessionStore,
} from './historyStore'
import { closeAppDatabase, initializeAppDatabase } from '../store/appDatabase'
import type { AiChatMessage, AiChatSegment, AiToolRun } from '../../shared/types/ai'

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

it('persists up to five reference files and removes one without changing older conversations', async () => {
  const initial = await readAiSessionStoreAndGc('context-file-session')
  const threadId = initial.activeThreadId
  const file = { source: 'ssh' as const, path: '/home/user/AGENTS.md', content: 'Always check status first.' }
  await setAiConversationContextFile('context-file-session', threadId, file)
  expect((await readAiSessionStore('context-file-session')).threads[0].contextFiles).toEqual([file])
  expect((await readAiSessionStore('context-file-session')).defaultContextFiles).toEqual([file])
  await expect(setAiConversationContextFile('context-file-session', 'wrong-thread', file)).rejects.toThrow('changed')
  await expect(setAiConversationContextFile('context-file-session', threadId, { ...file, content: 'x'.repeat(40 * 1024) }))
    .rejects.toThrow('oversized')
  await expect(setAiConversationContextFile('context-file-session', threadId, { ...file, path: '/home/user/rules.txt' }))
    .rejects.toThrow('Invalid')
  for (let i = 0; i < 4; i++) await setAiConversationContextFile('context-file-session', threadId, { ...file, path: `/home/user/rules-${i}.md` })
  await expect(setAiConversationContextFile('context-file-session', threadId, { ...file, path: '/home/user/sixth.md' })).rejects.toThrow('5')
  await setAiConversationContextFile('context-file-session', threadId, { ...file, content: 'Updated snapshot.' })
  expect((await readAiSessionStore('context-file-session')).threads[0].contextFiles[0].content).toBe('Updated snapshot.')
  await removeAiConversationContextFile('context-file-session', threadId, file.source, file.path)
  expect((await readAiSessionStore('context-file-session')).threads[0].contextFiles).toHaveLength(4)
  expect((await readAiSessionStore('context-file-session')).defaultContextFiles).toHaveLength(4)
})

it('loads the saved reference file in each new conversation', async () => {
  const initial = await readAiSessionStoreAndGc('context-draft-session')
  const threadId = initial.activeThreadId
  const file = { source: 'local' as const, path: 'C:/rules.markdown', content: 'Run the checklist.' }
  await setAiConversationContextFile('context-draft-session', threadId, file)
  await upsertAiHistoryRecord('context-draft-session', {
    id: 'first-question', role: 'user', content: 'Check this server', createdAt: Date.now(),
  }, threadId)
  const next = await createNewConversationAtomic('context-draft-session', { threadId })
  expect(next.activeThreadId).not.toBe(threadId)
  expect(next.threads.find(thread => thread.id === threadId)?.contextFiles).toEqual([file])
  expect(next.threads.find(thread => thread.id === threadId)?.messages).toHaveLength(1)
  expect(next.threads.find(thread => thread.id === next.activeThreadId)?.contextFiles).toEqual([file])
  expect(next.defaultContextFiles).toEqual([file])

  const replacement = { source: 'ssh' as const, path: '/srv/rules.md', content: 'Check disk usage first.' }
  await setAiConversationContextFile('context-draft-session', next.activeThreadId, replacement)
  const third = await createNewConversationAtomic('context-draft-session', { threadId: next.activeThreadId })
  expect(third.threads.find(thread => thread.id === threadId)?.contextFiles).toEqual([file])
  expect(third.threads.some(thread => thread.id === next.activeThreadId)).toBe(false)
  expect(third.threads.find(thread => thread.id === third.activeThreadId)?.contextFiles).toEqual([file, replacement])

  await removeAiConversationContextFile('context-draft-session', third.activeThreadId, file.source, file.path)
  await removeAiConversationContextFile('context-draft-session', third.activeThreadId, replacement.source, replacement.path)
  const fourth = await createNewConversationAtomic('context-draft-session', { threadId: third.activeThreadId })
  expect(fourth.defaultContextFiles).toEqual([])
  expect(fourth.threads.find(thread => thread.id === fourth.activeThreadId)?.contextFiles).toEqual([])
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
})
