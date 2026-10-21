import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useDbQueryRun } from './useDbQueryRun'
import type { QueryTab, WsTab } from '@/domain/database/types'
import type { DbSessionInfo } from '@shared/types/database'

vi.mock('element-plus/es/components/message/index', () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock('../../i18n', () => ({ t: (key: string) => key }))

afterEach(() => vi.unstubAllGlobals())

function fixture() {
  const result = { columns: [], rows: [], rowCount: 0, hasResultSet: true, durationMs: 1 }
  const ipc = {
    getDbConfirmDangerousSql: vi.fn(async () => false),
    dbQuery: vi.fn(async () => result),
    dbExplain: vi.fn(async () => result),
    dbCancelQuery: vi.fn(async () => ({ status: 'requested' })),
    dbBeginTransaction: vi.fn(async () => ({ inTransaction: true, autocommit: false })),
    dbCommitTransaction: vi.fn(async () => ({ inTransaction: false, autocommit: true })),
    dbRollbackTransaction: vi.fn(async () => ({ inTransaction: false, autocommit: true })),
  }
  vi.stubGlobal('window', { LiteConnect: ipc })
  const tabs = ref<WsTab[]>([{
    id: 'tab-1', kind: 'query', connectionId: 'c1', title: 'Query', database: 'db',
    sql: 'SELECT 1', loading: false, error: '', result: null, queryId: null, sort: null, filter: '',
  }])
  const tab = tabs.value[0] as QueryTab
  const getLiveSession = vi.fn(() => ({ sessionId: 's1' }) as DbSessionInfo)
  const history = vi.fn()
  const api = useDbQueryRun({
    tabs, activeTab: computed(() => tabs.value[0]), queryRunGen: new Map(), getLiveSession,
    focusConnection: vi.fn(), dialectOf: () => 'mysql', patchLiveSession: vi.fn(),
    scheduleDraftSave: vi.fn(), pushQueryHistory: history,
  })
  return { api, ipc, tab, history, getLiveSession, result }
}

describe('database query execution through the real composable', () => {
  it('sends query options, stores the result and records actual execution', async () => {
    const { api, ipc, tab, history, result } = fixture()
    await api.runQuerySql(' SELECT 1 ', 'all')
    expect(ipc.dbQuery).toHaveBeenCalledWith('s1', 'SELECT 1', expect.objectContaining({
      clientKey: 'tab-1', database: 'db', readOnly: false, queryId: expect.any(String),
    }))
    expect(tab.result).toEqual(result)
    expect(tab.loading).toBe(false)
    expect(tab.queryId).toBeNull()
    expect(history).toHaveBeenCalledWith('SELECT 1', 'db', expect.objectContaining({ status: 'success' }))
  })

  it('cancels the actual in-flight query and clears busy state when it settles', async () => {
    const { api, ipc, tab, result } = fixture()
    let resolve!: (value: typeof result) => void
    ipc.dbQuery.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const pending = api.runQuerySql('SELECT 1')
    await vi.waitFor(() => expect(ipc.dbQuery).toHaveBeenCalledOnce())
    const queryId = tab.queryId
    await api.cancelActiveQuery()
    expect(ipc.dbCancelQuery).toHaveBeenCalledWith('s1', queryId)
    resolve(result)
    await pending
    expect(tab.loading).toBe(false)
    expect(tab.cancelling).toBe(false)
  })

  it('updates transaction flags from server results and blocks begin in read-only mode', async () => {
    const { api, ipc, tab } = fixture()
    tab.readOnly = true
    await api.beginTransaction()
    expect(ipc.dbBeginTransaction).not.toHaveBeenCalled()
    tab.readOnly = false
    await api.beginTransaction()
    expect(ipc.dbBeginTransaction).toHaveBeenCalledWith('s1', 'tab-1', 'db')
    expect(tab.inTransaction).toBe(true)
    await api.commitTransaction()
    expect(tab.inTransaction).toBe(false)
    await api.beginTransaction()
    await api.rollbackTransaction()
    expect(ipc.dbRollbackTransaction).toHaveBeenCalledWith('s1', 'tab-1')
    expect(tab.transactionStartedAt).toBeNull()
  })

  it('executes EXPLAIN through IPC and displays a plan', async () => {
    const { api, ipc, tab } = fixture()
    await api.explainQuerySql('SELECT 1')
    expect(ipc.dbExplain).toHaveBeenCalledWith('s1', 'SELECT 1', 'db')
    expect(tab.outputKind).toBe('plan')
    expect(tab.loading).toBe(false)
  })
})
