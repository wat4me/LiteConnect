import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { useDbNavTree } from './useDbNavTree'
import type { DbSessionInfo } from '../../env.d'

const live: DbSessionInfo = {
  sessionId: 'sess-1',
  connectionId: 'conn-1',
  connectionName: 'c',
  engine: 'mysql',
  host: 'h',
  port: 3306,
  username: 'u',
  database: 'db',
  serverVersion: '8',
}

describe('useDbNavTree ensure* generation + clear', () => {
  let sessions: Record<string, DbSessionInfo>

  beforeEach(() => {
    sessions = { 'conn-1': { ...live } }
    ;(globalThis as any).window = {
      LiteConnect: {
        dbListTableInfos: vi.fn(async () => [{ name: 't1', type: 'table', engine: null, rows: null, comment: '' }]),
        dbGetTableColumns: vi.fn(async () => [{ name: 'id', type: 'int', nullable: false, key: 'PRI', default: null, extra: '', comment: '' }]),
        dbListDatabases: vi.fn(async () => ['db']),
        dbUseDatabase: vi.fn(async () => {}),
      },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeNav() {
    return useDbNavTree({
      getLiveSession: (id) => (id ? sessions[id] || null : null),
      patchLiveSession: () => {},
      focusConnection: () => {},
      connect: async () => {},
      isConnActive: (id) => !!sessions[id],
    })
  }

  it('ensureTablesForDb drops late result after clearConnectionTree', async () => {
    const nav = makeNav()
    let resolveList!: (v: any) => void
    ;(window.LiteConnect.dbListTableInfos as any).mockImplementation(
      () =>
        new Promise((r) => {
          resolveList = r
        }),
    )
    const p = nav.ensureTablesForDb('conn-1', 'db')
    nav.clearConnectionTree('conn-1')
    resolveList([{ name: 'late', type: 'table', engine: null, rows: null, comment: '' }])
    await p
    expect(nav.tablesByKey.value['conn-1::db']).toBeUndefined()
  })

  it('ensureColumns drops late result and clearConnectionTree clears columnsCache', async () => {
    const nav = makeNav()
    let resolveCols!: (v: any) => void
    ;(window.LiteConnect.dbGetTableColumns as any).mockImplementation(
      () =>
        new Promise((r) => {
          resolveCols = r
        }),
    )
    const p = nav.ensureColumns('conn-1', 'db', 't1')
    nav.clearConnectionTree('conn-1')
    resolveCols([{ name: 'late', type: 'int', nullable: false, key: '', default: null, extra: '', comment: '' }])
    const cols = await p
    expect(cols).toEqual([])
    expect(nav.columnsCache.value['conn-1.db.t1']).toBeUndefined()
  })

  it('clearConnectionTree invalidates columnsCache for connection', async () => {
    const nav = makeNav()
    await nav.ensureColumns('conn-1', 'db', 't1')
    expect(nav.columnsCache.value['conn-1.db.t1']).toBeTruthy()
    nav.clearConnectionTree('conn-1')
    expect(nav.columnsCache.value['conn-1.db.t1']).toBeUndefined()
  })

  it('parallel tree loading keys are independent', async () => {
    const nav = makeNav()
    let resolveA!: (v: any) => void
    let resolveB!: (v: any) => void
    let call = 0
    ;(window.LiteConnect.dbListTableInfos as any).mockImplementation(() => {
      call += 1
      if (call === 1) {
        return new Promise((r) => {
          resolveA = r
        })
      }
      return new Promise((r) => {
        resolveB = r
      })
    })
    const p1 = nav.expandDatabase('conn-1', 'db_a', true)
    const p2 = nav.expandDatabase('conn-1', 'db_b', true)
    expect(nav.isTreeLoading('conn-1::db_a')).toBe(true)
    expect(nav.isTreeLoading('conn-1::db_b')).toBe(true)
    resolveA([])
    await p1
    expect(nav.isTreeLoading('conn-1::db_a')).toBe(false)
    expect(nav.isTreeLoading('conn-1::db_b')).toBe(true)
    resolveB([])
    await p2
    expect(nav.isTreeLoading('conn-1::db_b')).toBe(false)
  })
})
