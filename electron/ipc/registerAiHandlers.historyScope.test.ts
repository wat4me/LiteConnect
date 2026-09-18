import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  readStore: vi.fn(async () => ({ activeThreadId: 'thread', threads: [] })),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler),
  },
}))

vi.mock('../ai/historyStore', () => ({
  createNewConversationAtomic: vi.fn(),
  getActiveThread: vi.fn(() => ({ messages: [] })),
  normalizeSessionStore: vi.fn((store) => store),
  pruneAllAiHistoryStores: vi.fn(),
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
    undefined,
    () => 'host-v1:22:server.example',
  )

  const load = mocks.handlers.get('ai:getSessionStore')!
  await load({}, 'runtime-session-a')
  await load({}, 'runtime-session-b')

  expect(mocks.readStore).toHaveBeenNthCalledWith(1, 'host-v1:22:server.example', expect.anything())
  expect(mocks.readStore).toHaveBeenNthCalledWith(2, 'host-v1:22:server.example', expect.anything())
})
