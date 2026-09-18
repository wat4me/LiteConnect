import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateDurableLocalStorage } from './legacyStorageMigrate'

function createStorage(values: Record<string, string>) {
  const data = new Map(Object.entries(values))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    snapshot: () => Object.fromEntries(data),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('migrateDurableLocalStorage', () => {
  it('moves durable renderer records to SQLite through the preload bridge', async () => {
    const storage = createStorage({
      'LiteConnect.dbQueryDrafts.v1': '{"version":1,"drafts":[]}',
      'LiteConnect.db.savedQueries': '[]',
      'LiteConnect.batchCommandHistory': '[]',
      'LiteConnect.locale': 'zh-CN',
    })
    const migrateRendererState = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', { LiteConnect: { migrateRendererState } })

    await migrateDurableLocalStorage()

    expect(migrateRendererState).toHaveBeenCalledWith({
      'db-query-drafts': '{"version":1,"drafts":[]}',
      'db-saved-queries': '[]',
      'batch-command-history': '[]',
    })
    expect(storage.snapshot()).toEqual({ 'LiteConnect.locale': 'zh-CN' })
  })

  it('keeps the source values when the database migration fails', async () => {
    const storage = createStorage({ 'LiteConnect.db.savedQueries': '[{"id":"q1"}]' })
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', {
      LiteConnect: { migrateRendererState: vi.fn().mockRejectedValue(new Error('database busy')) },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await migrateDurableLocalStorage()

    expect(storage.snapshot()).toEqual({ 'LiteConnect.db.savedQueries': '[{"id":"q1"}]' })
    errorSpy.mockRestore()
  })
})
