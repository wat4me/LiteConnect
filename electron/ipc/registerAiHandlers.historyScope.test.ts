import { beforeEach, expect, it, vi } from 'vitest'
import type { AiExecutionService } from '../ai/execution/executionService'

const execution = { selectConversation: vi.fn() } as unknown as AiExecutionService

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  readStore: vi.fn(async () => ({ activeThreadId: 'thread', threads: [] })),
  previewPrune: vi.fn(async () => ({ conversations: 2, messages: 12 })),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler),
  },
}))

vi.mock('../ai/history/historyStore', () => ({
  createNewConversationAtomic: vi.fn(),
  getActiveThread: vi.fn(() => ({ messages: [] })),
  normalizeSessionStore: vi.fn((store) => store),
  pruneAllAiHistoryStores: vi.fn(),
  previewAiHistoryPrune: mocks.previewPrune,
  readAiSessionStore: vi.fn(),
  readAiSessionStoreAndGc: mocks.readStore,
  upsertAiHistoryRecord: vi.fn(),
  writeAiHistoryRecords: vi.fn(),
  writeAiContextCheckpoint: vi.fn(),
  writeAiSessionStore: vi.fn(),
}))

beforeEach(() => {
  mocks.handlers.clear()
  mocks.readStore.mockClear()
  mocks.previewPrune.mockClear()
})

it('normalizes retention preview limits without invoking a history write', async () => {
  const { registerAiHandlers } = await import('./registerAiHandlers')
  registerAiHandlers({ init: async () => {}, initMigrations: async () => {}, getAiSettings: () => ({}) } as any, execution)
  const preview = mocks.handlers.get('ai:previewHistoryPrune')!
  await expect(preview({}, { maxThreads: -5, maxMessages: 99999 })).resolves.toEqual({ conversations: 2, messages: 12 })
  expect(mocks.previewPrune).toHaveBeenCalledWith({ maxThreads: 1, maxMessages: 2000 })
})

it('loads two runtime terminals from the same stable host history', async () => {
  const settingsStore = {
    init: async () => {},
    initMigrations: async () => {},
    getAiSettings: () => ({}),
  }
  const { registerAiHandlers } = await import('./registerAiHandlers')
  registerAiHandlers(
    settingsStore as any,
    execution,
    () => 'host-v1:22:server.example',
  )

  const load = mocks.handlers.get('ai:getSessionStore')!
  await load({}, 'runtime-session-a')
  await load({}, 'runtime-session-b')

  expect(mocks.readStore).toHaveBeenNthCalledWith(1, 'host-v1:22:server.example', expect.anything())
  expect(mocks.readStore).toHaveBeenNthCalledWith(2, 'host-v1:22:server.example', expect.anything())
})
