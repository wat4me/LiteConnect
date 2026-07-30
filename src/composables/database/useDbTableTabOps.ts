import type { Ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { DbSessionInfo } from '../../env.d'
import type { WsTab } from '@/domain/database/types'
import { getCachedDbSettings } from '@/composables/database/useDbSettings'
import { t } from '../../i18n'
import { parseDbError } from '@/utils/database/dbErrorUi'
import {
  canGoNextPage,
  isLiveRequest,
  maxPageFromBrowse,
  nextRequestGen,
  shouldClearLoading,
  type RequestGenMap,
} from './dbAsyncGuard'

export type DbTableTabOpsDeps = {
  tabs: Ref<WsTab[]>
  activeTabId: Ref<string | null>
  activeTab: Ref<WsTab | null>
  liveSessions: Ref<Record<string, DbSessionInfo>>
  selectedTableKey: Ref<string>
  getLiveSession: (connectionId: string | null | undefined) => DbSessionInfo | null
  focusConnection: (connectionId: string) => void
  newTabId: () => string
  dataLoadGen: RequestGenMap
  structureLoadGen: RequestGenMap
  metaLoadGen: RequestGenMap
  exportProgress: Ref<{
    exportId: string
    rowsWritten: number
    phase: string
    error?: string
  } | null>
}

export function useDbTableTabOps(deps: DbTableTabOpsDeps) {
  function findTableTab(connectionId: string, database: string, table: string) {
    return deps.tabs.value.find(
      (t): t is Extract<WsTab, { kind: 'data' }> =>
        t.kind === 'data'
        && t.connectionId === connectionId
        && t.database === database
        && t.table === table,
    )
  }

  function createTableTab(connectionId: string, database: string, table: string) {
    const id = deps.newTabId()
    deps.tabs.value.push({
      id,
      kind: 'data',
      connectionId,
      title: table,
      database,
      table,
      panel: 'data',
      page: 1,
      pageSize: getCachedDbSettings().pageSize,
      loading: false,
      error: '',
      result: null,
      sort: null,
      serverSearch: '',
      filter: '',
      columnsMeta: [],
      pkColumns: [],
      dirty: {},
      selected: [],
      editCell: null,
      editDraft: '',
      editAsNull: false,
      inserting: null,
      saving: false,
      structureLoading: false,
      structureError: '',
      structureLoaded: false,
      indexes: [],
      createSql: '',
    })
    return id
  }

  function openDataTab(connectionId: string, database: string, table: string) {
    if (!deps.liveSessions.value[connectionId]) return
    deps.focusConnection(connectionId)
    deps.selectedTableKey.value = `${connectionId}.${database}.${table}`
    const existing = findTableTab(connectionId, database, table)
    if (existing) {
      existing.panel = 'data'
      deps.activeTabId.value = existing.id
      if (!existing.result) void loadDataPage(existing.id)
      return
    }
    const id = createTableTab(connectionId, database, table)
    deps.activeTabId.value = id
    void loadDataPage(id)
    void loadDataMeta(id)
  }

  async function loadDataMeta(tabId: string) {
    const tab = deps.tabs.value.find((t) => t.id === tabId)
    const live = tab && tab.kind === 'data' ? deps.getLiveSession(tab.connectionId) : null
    if (!tab || tab.kind !== 'data' || !live) return
    const gen = nextRequestGen(deps.metaLoadGen, tabId)
    try {
      const cols = await window.LiteConnect.dbGetTableColumns(
        live.sessionId,
        tab.database,
        tab.table,
      )
      if (!isLiveRequest(deps.metaLoadGen, tabId, gen)) return
      const still = deps.tabs.value.find((t) => t.id === tabId)
      if (!still || still.kind !== 'data') return
      if (!deps.getLiveSession(still.connectionId)) return
      still.columnsMeta = cols
      still.pkColumns = cols.filter((c) => c.key === 'PRI').map((c) => c.name)
    } catch {
      if (!isLiveRequest(deps.metaLoadGen, tabId, gen)) return
      const still = deps.tabs.value.find((t) => t.id === tabId)
      if (!still || still.kind !== 'data') return
      still.columnsMeta = []
      still.pkColumns = []
    }
  }

  function openStructureTab(connectionId: string, database: string, table: string) {
    if (!deps.liveSessions.value[connectionId]) return
    deps.focusConnection(connectionId)
    deps.selectedTableKey.value = `${connectionId}.${database}.${table}`
    let tab = findTableTab(connectionId, database, table)
    if (!tab) {
      const id = createTableTab(connectionId, database, table)
      tab = deps.tabs.value.find((t) => t.id === id) as typeof tab
      void loadDataMeta(id)
    }
    if (!tab || tab.kind !== 'data') return
    tab.panel = 'structure'
    deps.activeTabId.value = tab.id
    void loadStructure(tab.id)
  }

  function setTablePanel(panel: 'data' | 'structure') {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'data') return
    tab.panel = panel
    if (panel === 'structure') {
      void loadStructure(tab.id)
    } else if (!tab.result) {
      void loadDataPage(tab.id)
    }
  }

  async function loadDataPage(tabId: string) {
    const tab = deps.tabs.value.find((t) => t.id === tabId)
    const live = tab && tab.kind === 'data' ? deps.getLiveSession(tab.connectionId) : null
    if (!tab || tab.kind !== 'data' || !live) return
    const gen = nextRequestGen(deps.dataLoadGen, tabId)
    const sessionId = live.sessionId
    const page = tab.page
    const pageSize = tab.pageSize
    const search = tab.serverSearch.trim()
    const sort = tab.sort ? { ...tab.sort } : null
    tab.loading = true
    tab.error = ''
    tab.editCell = null
    tab.dirty = {}
    tab.selected = []
    tab.inserting = null
    try {
      const browseOpts: {
        orderBy?: string
        orderDir?: 'asc' | 'desc'
        search?: string
      } = {}
      if (sort) {
        browseOpts.orderBy = sort.col
        browseOpts.orderDir = sort.dir
      }
      if (search) {
        browseOpts.search = search
      }
      const result = await window.LiteConnect.dbBrowseTable(
        sessionId,
        tab.database,
        tab.table,
        page,
        pageSize,
        Object.keys(browseOpts).length ? browseOpts : undefined,
      )
      if (!isLiveRequest(deps.dataLoadGen, tabId, gen)) return
      // Tab may have been closed or connection dropped
      const still = deps.tabs.value.find((t) => t.id === tabId)
      if (!still || still.kind !== 'data') return
      if (!deps.getLiveSession(still.connectionId)) return
      still.result = result
    } catch (err: any) {
      if (!isLiveRequest(deps.dataLoadGen, tabId, gen)) return
      const still = deps.tabs.value.find((t) => t.id === tabId)
      if (!still || still.kind !== 'data') return
      if (!deps.getLiveSession(still.connectionId)) return
      still.error = err.message || t('database.msg.readFailed')
      still.result = null
    } finally {
      if (shouldClearLoading(deps.dataLoadGen, tabId, gen)) {
        const still = deps.tabs.value.find((t) => t.id === tabId)
        if (still && still.kind === 'data') still.loading = false
      }
    }
  }

  async function loadStructure(tabId: string) {
    const tab = deps.tabs.value.find((t) => t.id === tabId)
    const live = tab && tab.kind === 'data' ? deps.getLiveSession(tab.connectionId) : null
    if (!tab || tab.kind !== 'data' || !live) return
    const gen = nextRequestGen(deps.structureLoadGen, tabId)
    const sessionId = live.sessionId
    tab.structureLoading = true
    tab.structureError = ''
    try {
      const [columns, indexes, createSql] = await Promise.all([
        window.LiteConnect.dbGetTableColumns(sessionId, tab.database, tab.table),
        window.LiteConnect.dbGetTableIndexes(sessionId, tab.database, tab.table).catch(() => []),
        window.LiteConnect.dbGetCreateTable(sessionId, tab.database, tab.table),
      ])
      if (!isLiveRequest(deps.structureLoadGen, tabId, gen)) return
      const still = deps.tabs.value.find((t) => t.id === tabId)
      if (!still || still.kind !== 'data') return
      if (!deps.getLiveSession(still.connectionId)) return
      still.columnsMeta = columns
      still.pkColumns = columns.filter((c) => c.key === 'PRI').map((c) => c.name)
      still.indexes = indexes
      still.createSql = createSql
      still.structureLoaded = true
    } catch (err: any) {
      if (!isLiveRequest(deps.structureLoadGen, tabId, gen)) return
      const still = deps.tabs.value.find((t) => t.id === tabId)
      if (!still || still.kind !== 'data') return
      if (!deps.getLiveSession(still.connectionId)) return
      still.structureError = err.message || t('database.msg.readFailed')
    } finally {
      if (shouldClearLoading(deps.structureLoadGen, tabId, gen)) {
        const still = deps.tabs.value.find((t) => t.id === tabId)
        if (still && still.kind === 'data') still.structureLoading = false
      }
    }
  }

  function applyServerSearch(search: string) {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'data') return
    tab.serverSearch = search
    tab.page = 1
    void loadDataPage(tab.id)
  }

  async function exportTableAllCsv() {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'data') {
      ElMessage.warning(t('database.msg.exportAllOnData'))
      return
    }
    const live = deps.getLiveSession(tab.connectionId)
    if (!live) return
    const browseOpts: {
      orderBy?: string
      orderDir?: 'asc' | 'desc'
      search?: string
    } = {}
    if (tab.sort) {
      browseOpts.orderBy = tab.sort.col
      browseOpts.orderDir = tab.sort.dir
    }
    if (tab.serverSearch.trim()) browseOpts.search = tab.serverSearch.trim()
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    let unsub: (() => void) | null = null
    try {
      ElMessage.info(t('database.msg.fetchingAll'))
      unsub = window.LiteConnect.onDbExportProgress((p) => {
        deps.exportProgress.value = {
          exportId: p.exportId,
          rowsWritten: p.rowsWritten,
          phase: p.phase,
          error: p.error,
        }
      })
      const result = await window.LiteConnect.dbExportTable({
        sessionId: live.sessionId,
        database: tab.database,
        table: tab.table,
        format: 'csv',
        options: Object.keys(browseOpts).length ? browseOpts : undefined,
        maxRows: 1_000_000,
        defaultFileName: `${tab.table}-all-${stamp}.csv`,
      })
      deps.exportProgress.value = null
      if (result.cancelled && !result.ok) {
        if (result.rowsWritten === 0 && !result.error) {
          // user cancelled save dialog
          return
        }
        ElMessage.info(t('database.msg.exportCancelled'))
        return
      }
      if (!result.ok) {
        ElMessage.error(result.error || t('database.msg.exportAllFailed'))
        return
      }
      ElMessage.success(t('database.msg.exportedRows', { n: result.rowsWritten }))
    } catch (err: any) {
      deps.exportProgress.value = null
      ElMessage.error(parseDbError(err).summary || t('database.msg.exportAllFailed'))
    } finally {
      unsub?.()
    }
  }

  async function cancelTableExport() {
    const p = deps.exportProgress.value
    if (!p?.exportId) return
    try {
      await window.LiteConnect.dbCancelExport(p.exportId)
    } catch {}
  }

  function toggleDataSort(col: string) {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'data') return
    if (!tab.sort || tab.sort.col !== col) {
      tab.sort = { col, dir: 'asc' }
    } else if (tab.sort.dir === 'asc') {
      tab.sort = { col, dir: 'desc' }
    } else {
      tab.sort = null
    }
    tab.page = 1
    void loadDataPage(tab.id)
  }

  function changeDataPage(delta: number) {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'data' || !tab.result) return
    if (delta > 0) {
      if (
        !canGoNextPage({
          page: tab.page,
          pageSize: tab.pageSize,
          total: tab.result.total,
          hasNext: tab.result.hasNext,
          totalMode: tab.result.totalMode,
        })
      ) {
        return
      }
      tab.page = tab.page + 1
      void loadDataPage(tab.id)
      return
    }
    const next = Math.max(1, tab.page + delta)
    if (next === tab.page) return
    tab.page = next
    void loadDataPage(tab.id)
  }

  function jumpDataPage(raw: string | number) {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'data' || !tab.result) return
    const maxPage = maxPageFromBrowse({
      page: tab.page,
      pageSize: tab.pageSize,
      total: tab.result.total,
      hasNext: tab.result.hasNext,
      totalMode: tab.result.totalMode,
    })
    const n = Math.min(maxPage, Math.max(1, Math.floor(Number(raw)) || 1))
    if (n === tab.page) return
    tab.page = n
    void loadDataPage(tab.id)
  }

  function changeDataPageSize(size: number) {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'data') return
    const next = Math.min(500, Math.max(10, Math.floor(size) || 100))
    if (next === tab.pageSize) return
    tab.pageSize = next
    tab.page = 1
    void loadDataPage(tab.id)
  }

  return {
    openDataTab,
    openStructureTab,
    setTablePanel,
    loadDataPage,
    loadDataMeta,
    loadStructure,
    applyServerSearch,
    exportTableAllCsv,
    cancelTableExport,
    toggleDataSort,
    changeDataPage,
    jumpDataPage,
    changeDataPageSize,
  }
}
