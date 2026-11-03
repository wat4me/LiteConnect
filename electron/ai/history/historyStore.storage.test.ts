import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import {
  deleteAiHistory, readAiSessionStore, saveAiConversation, upsertAiHistoryRecord, writeAiContextCheckpoint, writeAiSessionStore,
} from './historyStore'
import { aiHistoryBackupKey, aiThreadCollection, isAiHistoryIndex } from './historyRepository'
import { aiSessionKey, closeAppDatabase, getAppDatabase, initializeAppDatabase } from '../../store/appDatabase'
import type { AiHistoryRecord, AiSessionStore } from '../../../shared/types/ai'

const appPath = vi.hoisted(() => ({ value: '' }))
vi.mock('electron', () => ({ app: { getPath: () => appPath.value } }))
beforeAll(async () => {
  appPath.value = await mkdtemp(join(tmpdir(), 'lite-ai-storage-test-'))
  await initializeAppDatabase(appPath.value)
})
afterAll(async () => {
  closeAppDatabase()
  const root = resolve(appPath.value)
  if (!root.startsWith(resolve(tmpdir()) + sep) || !root.includes('lite-ai-storage-test-')) throw new Error('Invalid test directory')
  await rm(root, { recursive: true, force: true })
})

const v1Store = (): AiSessionStore => ({
  version: 1, activeThreadId: 't', defaultContextFiles: [],
  threads: [
    { id: 't', title: '', createdAt: 1, updatedAt: 3, contextFiles: [], messages: [
      { id: 'u', role: 'user', content: 'question', createdAt: 1 },
      { id: 'a', role: 'assistant', content: 'answer', createdAt: 2 },
    ] },
    { id: 'other', title: 'Other', createdAt: 4, updatedAt: 4, contextFiles: [], messages: [{ id: 'u2', role: 'user', content: 'elsewhere', createdAt: 4 }] },
  ],
})
const rows = (session: string, threadId: string) => getAppDatabase().getCollection<any>(aiThreadCollection(session, threadId))
const index = (session: string) => getAppDatabase().getSingleton<any>(aiSessionKey(session))

it('splits a v1 blob into an index and one row per message on first read and keeps a backup', async () => {
  const original = v1Store()
  getAppDatabase().setSingleton(aiSessionKey('legacy-blob'), original)
  const loaded = await readAiSessionStore('legacy-blob', { maxThreads: 200, maxMessages: 2000 })
  expect(loaded.threads.map(thread => [thread.id, thread.messages.map(message => message.content)])).toEqual([
    ['t', ['question', 'answer']], ['other', ['elsewhere']],
  ])
  const stored = index('legacy-blob')
  expect(isAiHistoryIndex(stored)).toBe(true)
  // The index carries titles and entries, never message bodies.
  expect(JSON.stringify(stored)).not.toContain('answer')
  expect(stored.threads.every((thread: any) => thread.messages.every((entry: any) => !('content' in entry)))).toBe(true)
  expect(stored.threads.find((thread: any) => thread.id === 't').messages).toEqual([
    { id: 'u', createdAt: 1, role: 'user' }, { id: 'a', createdAt: 2, role: 'assistant' },
  ])
  expect(rows('legacy-blob', 't').map(row => row.content)).toEqual(['question', 'answer'])
  expect(getAppDatabase().getSingleton(aiHistoryBackupKey('legacy-blob'))).toEqual(original)
})

it('migrates a legacy JSONL string without losing messages', async () => {
  const raw = `${JSON.stringify({ id: 'm1', role: 'user', content: 'hello', createdAt: 1 })}\n${JSON.stringify({ id: 'm2', role: 'assistant', content: 'hi', createdAt: 2 })}\n`
  getAppDatabase().setSingleton(aiSessionKey('legacy-jsonl'), raw)
  const loaded = await readAiSessionStore('legacy-jsonl')
  expect(loaded.threads[0].messages.map(message => message.content)).toEqual(['hello', 'hi'])
  expect(isAiHistoryIndex(index('legacy-jsonl'))).toBe(true)
  expect(getAppDatabase().getSingleton(aiHistoryBackupKey('legacy-jsonl'))).toBe(raw)
})

it('writes a checkpoint to the index only, leaving message rows untouched', async () => {
  await writeAiSessionStore('checkpoint-session', v1Store())
  const before = JSON.stringify(rows('checkpoint-session', 't'))
  await writeAiContextCheckpoint('checkpoint-session', 't', {
    version: 1, summary: 'so far', throughMessageId: 'a', compactionCount: 1, createdAt: 5, sourceTokens: 100, summaryTokens: 10,
  })
  expect(JSON.stringify(rows('checkpoint-session', 't'))).toBe(before)
  expect(index('checkpoint-session').threads.find((thread: any) => thread.id === 't').contextCheckpoint.summary).toBe('so far')
  expect((await readAiSessionStore('checkpoint-session')).threads[0].contextCheckpoint?.summary).toBe('so far')
  await expect(writeAiContextCheckpoint('checkpoint-session', 't', {
    version: 1, summary: 'later', throughMessageId: 'gone', compactionCount: 1, createdAt: 6, sourceTokens: 100, summaryTokens: 10,
  })).rejects.toThrow('stale')
})

it('appends one row for an upsert and keeps the other conversation byte-identical', async () => {
  await writeAiSessionStore('upsert-session', v1Store())
  const otherBefore = JSON.stringify(rows('upsert-session', 'other'))
  await upsertAiHistoryRecord('upsert-session', { id: 'a2', role: 'assistant', content: 'more', createdAt: 6 }, 't')
  expect(rows('upsert-session', 't').map(row => row.content)).toEqual(['question', 'answer', 'more'])
  expect(JSON.stringify(rows('upsert-session', 'other'))).toBe(otherBefore)
  expect(index('upsert-session').threads.find((thread: any) => thread.id === 't').messages.map((entry: any) => entry.id)).toEqual(['u', 'a', 'a2'])
  const loaded = await readAiSessionStore('upsert-session')
  expect(loaded.threads.find(thread => thread.id === 't')?.messages.map(message => message.content)).toEqual(['question', 'answer', 'more'])
  expect(loaded.threads.find(thread => thread.id === 't')?.title).toBe('question')
})

it('applies retention to the index and drops the rows it no longer keeps', async () => {
  // The smallest allowed per-conversation limit is 20; keep the last 20 and drop a leading assistant reply.
  const messages: AiHistoryRecord[] = Array.from({ length: 22 }, (_, i) => ({
    id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `c${i}`, createdAt: i + 1,
  }))
  await writeAiSessionStore('retention-session', {
    version: 1, activeThreadId: 't', defaultContextFiles: [],
    threads: [{ id: 't', title: '', createdAt: 1, updatedAt: 22, contextFiles: [], messages }],
  }, { maxThreads: 50, maxMessages: 2000 })
  await upsertAiHistoryRecord('retention-session', { id: 'm22', role: 'assistant', content: 'c22', createdAt: 23 }, 't', { maxMessages: 20 })
  const expected = Array.from({ length: 19 }, (_, i) => `m${i + 4}`)
  expect(rows('retention-session', 't').map(row => row.id)).toEqual(expected)
  expect(index('retention-session').threads[0].messages.map((entry: any) => entry.id)).toEqual(expected)
  expect((await readAiSessionStore('retention-session')).threads[0].messages.map(message => message.id)).toEqual(expected)
})

it('replaces one conversation rows through saveAiConversation without touching the other collection', async () => {
  await writeAiSessionStore('save-session', v1Store())
  const otherBefore = JSON.stringify(rows('save-session', 'other'))
  await saveAiConversation('save-session', 't', { messages: [{ id: 'u', role: 'user', content: 'edited question', createdAt: 1 }] })
  expect(rows('save-session', 't').map(row => row.content)).toEqual(['edited question'])
  expect(JSON.stringify(rows('save-session', 'other'))).toBe(otherBefore)
  expect(index('save-session').activeThreadId).toBe('t')
})

it('deleteAiHistory removes the index, the backup, and every message row', async () => {
  getAppDatabase().setSingleton(aiSessionKey('doomed'), v1Store())
  await readAiSessionStore('doomed')
  expect(rows('doomed', 't')).toHaveLength(2)
  deleteAiHistory('doomed')
  expect(index('doomed')).toBeUndefined()
  expect(getAppDatabase().getSingleton(aiHistoryBackupKey('doomed'))).toBeUndefined()
  expect(getAppDatabase().listCollections('ai-msg-v2:doomed:')).toEqual([])
})
