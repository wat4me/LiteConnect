import { beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
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

it('reports when a selected local Markdown source was deleted', async () => {
  const { registerAiHandlers } = await import('./registerAiHandlers')
  registerAiHandlers({ init: async () => {}, initMigrations: async () => {}, getAiSettings: () => ({}) } as any, execution)
  const check = mocks.handlers.get('ai:checkLocalContextFile')!
  const path = join(tmpdir(), `lite-ai-reference-${randomUUID()}.md`)
  try {
    await writeFile(path, '# Reference')
    expect(await check({}, path)).toBe('available')
    await unlink(path)
    expect(await check({}, path)).toBe('missing')
    await expect(check({}, path.replace(/\.md$/, '.txt'))).rejects.toThrow('Invalid Markdown')
  } finally {
    await unlink(path).catch(() => {})
  }
})


it('opens a manually selected workspace under independent history and rejects another window accessing it', async () => {
  const database = await import('../store/appDatabase')
  const docs = new Map<string, unknown>()
  const storage = vi.spyOn(database, 'getAppDatabase').mockReturnValue({
    getSingleton: (key: string) => docs.get(key), setSingleton: (key: string, value: unknown) => docs.set(key, value),
  } as any)
  const { configureWorkspaceTargets, workspaceHistoryId, workspaceScopes } = await import('../ai/workspace/workspaceScopes')
  const id = randomUUID()
  configureWorkspaceTargets((owner, connectionId) => owner === 1 && connectionId === id
    ? { connectionId, sessionId: randomUUID(), name: 'selected', host: 'selected.example', port: 22, username: 'ops' } : undefined)
  try {
    const { registerAiHandlers } = await import('./registerAiHandlers')
    registerAiHandlers({ init: async () => {}, initMigrations: async () => {}, getAiSettings: () => ({}) } as any, execution, () => 'host-v1:22:selected.example')
    const open = mocks.handlers.get('ai:openWorkspaceScope')!
    const scope = await open({ sender: { id: 1 } }, { connectionIds: [id] })
    const load = mocks.handlers.get('ai:getSessionStore')!
    await load({ sender: { id: 1 } }, scope.id)
    expect(mocks.readStore).toHaveBeenLastCalledWith(workspaceHistoryId(scope.id), expect.anything())
    await expect(load({ sender: { id: 2 } }, scope.id)).rejects.toThrow('not open in this window')
    await expect(open({ sender: { id: 2 } }, { id: scope.id })).rejects.toThrow('Connect every selected')
    workspaceScopes.disposeOwner(1)
  } finally {
    configureWorkspaceTargets(() => undefined)
    storage.mockRestore()
  }
})
