import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { DbConnection, DbSessionInfo, DbTableInfo } from '../../env.d'

vi.mock('element-plus/es/components/message/index', () => ({
  ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

import { useDbNavTree } from './useDbNavTree'

const table = (name: string): DbTableInfo => ({
  name,
  type: 'table',
  engine: null,
  rows: null,
  comment: '',
})

function session(connectionId: string, database = 'db'): DbSessionInfo {
  return {
    sessionId: `sess-${connectionId}`,
    connectionId,
    connectionName: connectionId,
    engine: 'mysql',
    host: 'h',
    port: 3306,
    username: 'u',
    database,
    serverVersion: '8',
  }
}

function conn(id: string): DbConnection {
  return {
    id,
    name: id,
    engine: 'mysql',
    host: 'h',
    port: 3306,
    username: 'u',
    password: '',
    database: 'db',
    ssl: false,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('useDbNavTree expand/collapse state machine (DBNAV-001)', () => {
  let sessions: Record<string, DbSessionInfo>
  let connectCalls: string[]

  beforeEach(() => {
    sessions = {
      'conn-1': session('conn-1'),
      'conn-2': session('conn-2'),
    }
    connectCalls = []
    ;(globalThis as any).window = {
      LiteConnect: {
        dbListTableInfos: vi.fn(async () => [table('t1')]),
        dbListDatabases: vi.fn(async () => ['db']),
        dbGetTableColumns: vi.fn(async () => []),
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
      connect: async (c) => {
        connectCalls.push(c.id)
      },
      isConnActive: (id) => !!sessions[id],
    })
  }

  it('collapses a database after successful load (normal tables)', async () => {
    const nav = makeNav()
    await nav.expandDatabase('conn-1', 'db')
    expect(nav.isDbExpanded('conn-1', 'db')).toBe(true)
    expect(nav.tablesByKey.value['conn-1::db']).toEqual([table('t1')])

    await nav.expandDatabase('conn-1', 'db')
    expect(nav.isDbExpanded('conn-1', 'db')).toBe(false)
    expect(nav.isTreeLoading('conn-1::db')).toBe(false)
  })

  it('collapses a database after empty table list', async () => {
    const nav = makeNav()
    ;(window.LiteConnect.dbListTableInfos as any).mockResolvedValue([])
    await nav.expandDatabase('conn-1', 'db')
    expect(nav.isDbExpanded('conn-1', 'db')).toBe(true)
    expect(nav.tablesByKey.value['conn-1::db']).toEqual([])

    await nav.expandDatabase('conn-1', 'db')
    expect(nav.isDbExpanded('conn-1', 'db')).toBe(false)
  })

  it('collapses a database after load error (no tables cache)', async () => {
    const nav = makeNav()
    ;(window.LiteConnect.dbListTableInfos as any).mockRejectedValue(new Error('boom'))
    await nav.expandDatabase('conn-1', 'db')
    expect(nav.isDbExpanded('conn-1', 'db')).toBe(true)
    expect(nav.tablesByKey.value['conn-1::db']).toBeUndefined()

    await nav.expandDatabase('conn-1', 'db')
    expect(nav.isDbExpanded('conn-1', 'db')).toBe(false)
    expect(nav.isTreeLoading('conn-1::db')).toBe(false)
  })

  it('collapses while loading and ignores late success response', async () => {
    const nav = makeNav()
    let resolveList!: (v: DbTableInfo[]) => void
    ;(window.LiteConnect.dbListTableInfos as any).mockImplementation(
      () =>
        new Promise<DbTableInfo[]>((r) => {
          resolveList = r
        }),
    )

    const loadP = nav.expandDatabase('conn-1', 'db')
    expect(nav.isDbExpanded('conn-1', 'db')).toBe(true)
    expect(nav.isTreeLoading('conn-1::db')).toBe(true)

    await nav.expandDatabase('conn-1', 'db')
    expect(nav.isDbExpanded('conn-1', 'db')).toBe(false)
    expect(nav.isTreeLoading('conn-1::db')).toBe(false)

    resolveList([table('late')])
    await loadP
    expect(nav.isDbExpanded('conn-1', 'db')).toBe(false)
    expect(nav.tablesByKey.value['conn-1::db']).toBeUndefined()
    expect(nav.isTreeLoading('conn-1::db')).toBe(false)
  })

  it('late finally of collapsed load does not clear a newer expand loading', async () => {
    const nav = makeNav()
    let resolveFirst!: (v: DbTableInfo[]) => void
    let resolveSecond!: (v: DbTableInfo[]) => void
    let call = 0
    ;(window.LiteConnect.dbListTableInfos as any).mockImplementation(() => {
      call += 1
      if (call === 1) {
        return new Promise<DbTableInfo[]>((r) => {
          resolveFirst = r
        })
      }
      return new Promise<DbTableInfo[]>((r) => {
        resolveSecond = r
      })
    })

    const first = nav.expandDatabase('conn-1', 'db')
    expect(nav.isTreeLoading('conn-1::db')).toBe(true)

    // collapse while loading
    await nav.expandDatabase('conn-1', 'db')
    expect(nav.isDbExpanded('conn-1', 'db')).toBe(false)
    expect(nav.isTreeLoading('conn-1::db')).toBe(false)

    // re-expand starts a newer request
    const second = nav.expandDatabase('conn-1', 'db')
    expect(nav.isDbExpanded('conn-1', 'db')).toBe(true)
    expect(nav.isTreeLoading('conn-1::db')).toBe(true)

    // old request finishes after newer one started — must not clear newer loading
    resolveFirst([table('stale')])
    await first
    expect(nav.isTreeLoading('conn-1::db')).toBe(true)
    expect(nav.tablesByKey.value['conn-1::db']).toBeUndefined()

    resolveSecond([table('fresh')])
    await second
    expect(nav.isTreeLoading('conn-1::db')).toBe(false)
    expect(nav.tablesByKey.value['conn-1::db']).toEqual([table('fresh')])
  })

  it('active connection toggle collapses without reconnect; second click only expands', async () => {
    const nav = makeNav()
    nav.expandConn('conn-1')
    expect(nav.isConnExpanded('conn-1')).toBe(true)

    await nav.toggleConnection(conn('conn-1'))
    expect(nav.isConnExpanded('conn-1')).toBe(false)
    expect(connectCalls).toEqual([])

    await nav.toggleConnection(conn('conn-1'))
    expect(nav.isConnExpanded('conn-1')).toBe(true)
    expect(connectCalls).toEqual([])
  })

  it('connect-success style expandConn does not reopen a manually collapsed conn by itself', async () => {
    const nav = makeNav()
    nav.expandConn('conn-1')
    await nav.toggleConnection(conn('conn-1'))
    expect(nav.isConnExpanded('conn-1')).toBe(false)

    // Simulating only focus / existing-session path without expand would leave collapsed.
    // expandConn is only for explicit connect-success / restore — call once then user can collapse again.
    nav.expandConn('conn-1')
    expect(nav.isConnExpanded('conn-1')).toBe(true)
    await nav.toggleConnection(conn('conn-1'))
    expect(nav.isConnExpanded('conn-1')).toBe(false)
    // No watcher: state stays collapsed until expandConn/toggle again
    expect(nav.isConnExpanded('conn-1')).toBe(false)
  })

  it('forceOpen reopens / reloads even when already expanded', async () => {
    const nav = makeNav()
    await nav.expandDatabase('conn-1', 'db')
    expect(nav.isDbExpanded('conn-1', 'db')).toBe(true)
    ;(window.LiteConnect.dbListTableInfos as any).mockResolvedValue([table('t2')])
    await nav.expandDatabase('conn-1', 'db', true)
    expect(nav.isDbExpanded('conn-1', 'db')).toBe(true)
    expect(nav.tablesByKey.value['conn-1::db']).toEqual([table('t2')])
  })

  it('multi connection / multi database expand state is isolated', async () => {
    const nav = makeNav()
    await nav.expandDatabase('conn-1', 'db_a')
    await nav.expandDatabase('conn-1', 'db_b')
    await nav.expandDatabase('conn-2', 'db_a')
    expect(nav.isDbExpanded('conn-1', 'db_a')).toBe(true)
    expect(nav.isDbExpanded('conn-1', 'db_b')).toBe(true)
    expect(nav.isDbExpanded('conn-2', 'db_a')).toBe(true)

    await nav.expandDatabase('conn-1', 'db_a')
    expect(nav.isDbExpanded('conn-1', 'db_a')).toBe(false)
    expect(nav.isDbExpanded('conn-1', 'db_b')).toBe(true)
    expect(nav.isDbExpanded('conn-2', 'db_a')).toBe(true)

    nav.clearConnectionTree('conn-1')
    expect(nav.isDbExpanded('conn-1', 'db_b')).toBe(false)
    expect(nav.tablesByKey.value['conn-1::db_b']).toBeUndefined()
    expect(nav.isDbExpanded('conn-2', 'db_a')).toBe(true)
    expect(nav.tablesByKey.value['conn-2::db_a']).toEqual([table('t1')])
  })
})
