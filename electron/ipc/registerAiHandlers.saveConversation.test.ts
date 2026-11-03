import { beforeEach, expect, it, vi } from 'vitest'
import type { AiExecutionService } from '../ai/execution/executionService'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  save: vi.fn(),
  select: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler),
  },
}))

vi.mock('../ai/history/historyStore', () => ({
  createNewConversationAtomic: vi.fn(),
  getActiveThread: vi.fn(() => ({ messages: [] })),
  normalizeAiContextFile: vi.fn(),
  normalizeSessionStore: vi.fn((store) => store),
  pruneAllAiHistoryStores: vi.fn(),
  previewAiHistoryPrune: vi.fn(),
  readAiSessionStore: vi.fn(),
  readAiSessionStoreAndGc: vi.fn(),
  saveAiConversation: mocks.save,
  updateAiConversationMetadata: vi.fn(),
  upsertAiHistoryRecord: vi.fn(),
  writeAiHistoryRecords: vi.fn(),
  writeAiContextCheckpoint: vi.fn(),
  writeAiSessionStore: vi.fn(),
}))

const execution = { selectConversation: mocks.select } as unknown as AiExecutionService
const settings = {
  init: async () => {},
  initMigrations: async () => {},
  getAiSettings: () => ({ historyMaxThreads: 50, historyMaxMessages: 200 }),
}
const event = { sender: { id: 7 } }

beforeEach(() => {
  mocks.handlers.clear()
  mocks.save.mockReset()
  mocks.select.mockReset()
})

it('saves one conversation under the stable host history and selects the resulting active thread', async () => {
  const { registerAiHandlers } = await import('./registerAiHandlers')
  registerAiHandlers(settings as any, execution, () => 'host-v1:22:server.example')
  const result = {
    activeThreadId: 'target', defaultContextFiles: [], threads: [],
    thread: { id: 'target', title: '', createdAt: 1, updatedAt: 1, messages: [], contextFiles: [] },
  }
  mocks.save.mockResolvedValue(result)
  const handler = mocks.handlers.get('ai:saveConversation')!
  const payload = { messages: [{ id: 'u', role: 'user', content: 'hi', createdAt: 1 }], selectThreadId: 'target' }

  await expect(handler(event, 'runtime-session', 'draft', payload)).resolves.toEqual(result)
  expect(mocks.save).toHaveBeenCalledWith('host-v1:22:server.example', 'draft', payload, { maxThreads: 50, maxMessages: 200 })
  expect(mocks.select).toHaveBeenCalledWith(7, 'runtime-session', 'target')
})

it('rejects malformed saves before touching history', async () => {
  const { registerAiHandlers } = await import('./registerAiHandlers')
  registerAiHandlers(settings as any, execution, () => 'host-v1:22:server.example')
  const handler = mocks.handlers.get('ai:saveConversation')!
  const payload = { messages: [] }

  await expect(handler(event, 'runtime-session', '', payload)).rejects.toThrow('Invalid AI conversation save')
  await expect(handler(event, 'runtime-session', 'draft', null)).rejects.toThrow('Invalid AI conversation save')
  await expect(handler(event, '', 'draft', payload)).rejects.toThrow('Invalid AI session id')
  expect(mocks.save).not.toHaveBeenCalled()
  expect(mocks.select).not.toHaveBeenCalled()
})
