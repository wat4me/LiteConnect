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
