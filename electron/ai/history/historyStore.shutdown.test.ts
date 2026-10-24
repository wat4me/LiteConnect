import { expect, it, vi } from 'vitest'
import { writeAiSessionStore } from './historyStore'
import type { AiSessionStore } from '../../../shared/types/ai'

const mocks = vi.hoisted(() => ({ externalize: vi.fn(), database: { isOpen: true, setSingleton: vi.fn() } }))
vi.mock('../../store/appDatabase', () => ({ aiSessionKey: (id: string) => `ai-session:${id}`, getAppDatabase: () => mocks.database }))
vi.mock('./imageStore', () => ({ externalizeAiImages: mocks.externalize, pruneAiImageFiles: vi.fn() }))

it('does not commit a delayed attachment snapshot after the shutdown deadline closed its database', async () => {
  let finish!: () => void
  const store: AiSessionStore = { version: 1, activeThreadId: 't', defaultContextFiles: [],
    threads: [{ id: 't', title: '', createdAt: 1, updatedAt: 1, contextFiles: [], messages: [] }] }
  mocks.externalize.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(store) }))
  const saving = writeAiSessionStore('host', store)
  await vi.waitFor(() => expect(mocks.externalize).toHaveBeenCalledOnce())
  mocks.database.isOpen = false
  finish()
  await saving
  expect(mocks.database.setSingleton).not.toHaveBeenCalled()
})
