import { computed, nextTick, ref, type ComputedRef, type Ref } from 'vue'
import { getCachedQueryTabDefaults } from '@/composables/database/useDbSettings'
import { ElMessage } from 'element-plus/es/components/message/index'
import type {
  DbColumnInfo,
  DbConnection,
  DbSessionInfo,
  DbTableInfo,
} from '../../env.d'
import { type SqlDialect } from '@/utils/database/dbSql'
import type { QueryTab, WsTab } from '@/domain/database/types'
import { t } from '../../i18n'
import { appConfirm } from '@/composables/app/useAppDialog'
import {
  bestEffortCancelQuery,
  nextRequestGen,
  type RequestGenMap,
} from './dbAsyncGuard'
import { engineLabel } from './dbEngine'
import { resolveQueryTabExecOptionsFromDefaults } from '@/utils/database/queryTabOptions'
import { resolveQueryTabTitle } from '@/utils/database/queryDrafts'
import { useDbSavedQueries } from './useDbSavedQueries'
import { useDbQueryHistory } from './useDbQueryHistory'
import { useDbQueryDrafts } from './useDbQueryDrafts'
import { useDbTableTabOps } from './useDbTableTabOps'
import { useDbQueryRun } from './useDbQueryRun'
import { useDbResultExport } from './useDbResultExport'

export type DbTabsDeps = {
  liveSessions: Ref<Record<string, DbSessionInfo>>
  activeConnectionId: Ref<string | null>
  session: ComputedRef<DbSessionInfo | null>
  connections: Ref<DbConnection[]>
  liveSessionCount: ComputedRef<number>
  selectedTableKey: Ref<string>
  getLiveSession: (connectionId: string | null | undefined) => DbSessionInfo | null
  focusConnection: (connectionId: string) => void
  patchLiveSession: (connectionId: string, patch: Partial<DbSessionInfo>) => void
  dialectOf: (connectionId: string | null | undefined) => SqlDialect
  ensureTablesForDb: (connectionId: string, db: string) => Promise<void>
  ensureColumns: (connectionId: string, db: string, table: string) => Promise<DbColumnInfo[]>
  tablesOf: (connectionId: string, database: string) => DbTableInfo[]
  databasesOf: (connectionId: string | null | undefined) => string[]
  refreshDatabases: (connectionId?: string) => Promise<void>
}

export function useDbTabs(deps: DbTabsDeps) {
  const tabs = ref<WsTab[]>([])
  const activeTabId = ref<string | null>(null)
  let tabSeq = 1

  const dataLoadGen: RequestGenMap = new Map()
  const structureLoadGen: RequestGenMap = new Map()
  const queryRunGen: RequestGenMap = new Map()
  const metaLoadGen: RequestGenMap = new Map()

  const exportProgress = ref<{
    exportId: string
    rowsWritten: number
    phase: string
    error?: string
  } | null>(null)

  const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) || null)

  const activeQueryTab = computed(() => {
    const tab = activeTab.value
    return tab?.kind === 'query' ? (tab as QueryTab) : null
  })

  const drafts = useDbQueryDrafts({
    tabs,
    activeTabId,
    connections: deps.connections,
    liveSessions: deps.liveSessions,
  })

  const footerStatus = computed(() => {
    if (!deps.session.value) {
      return deps.liveSessionCount.value > 0
        ? t('database.footerMultiIdle', { count: deps.liveSessionCount.value })
        : t('database.footerIdle')
    }
    const s = deps.session.value
    const tab = activeTab.value
    let extra = ''
    if (tab?.kind === 'data' && tab.result) {
      const mode = tab.result.totalMode || 'exact'
      const totalLabel =
        mode === 'estimated'
          ? `~${tab.result.total}`
          : mode === 'unknown'
            ? (tab.result.hasNext ? `${tab.result.total}+` : String(tab.result.total))
            : String(tab.result.total)
      extra = t('database.footerPage', { page: tab.page, total: totalLabel })
    } else if (tab?.kind === 'query' && tab.result?.hasResultSet) {
      extra = t('database.footerQueryRows', {
        rows: tab.result.rowCount,
        ms: tab.result.durationMs,
      })
    }
    const multi =
      deps.liveSessionCount.value > 1
        ? t('database.footerMulti', { count: deps.liveSessionCount.value })
        : ''
    const eng = engineLabel(s.engine || 'mysql')
    const tunnel = s.viaTunnel
      ? t('database.footerTunnel', {
          name: s.sshConnectionName ? ` ${s.sshConnectionName}` : '',
        })
      : ''
    const tabDb = tab?.database || s.database
    return `${s.connectionName} ${s.username}@${s.host}:${s.port}${tabDb ? '/' + tabDb : ''} ${s.serverVersion || eng}${tunnel}${extra}${multi}`
  })

  function newTabId() {
    return `tab-${Date.now()}-${tabSeq++}`
  }

  async function openQueryTab(presetSql?: string, database?: string, connectionId?: string, savedQueryId?: string | null) {
    const connId = connectionId || deps.activeConnectionId.value
    if (!connId || !deps.liveSessions.value[connId]) {
      ElMessage.warning(t('database.msg.connectFirst'))
      return
    }
    deps.focusConnection(connId)
    const live = deps.liveSessions.value[connId]
    const id = newTabId()
    const n = tabs.value.filter((t) => t.kind === 'query' && t.connectionId === connId).length + 1
    const defaultDb = database !== undefined ? database : (live.database ?? '')
    const fallback = t('database.queryTitle', { n })
    const sql = presetSql || ''
    const title = resolveQueryTabTitle({
      title: fallback,
      titleCustomized: false,
      sql,
      fallback,
    })
    tabs.value.push({
      id,
      kind: 'query',
      connectionId: connId,
      title,
      database: defaultDb,
      sql,
      loading: false,
      error: '',
      errorDetail: '',
      errorCategory: '',
      errorRetryable: false,
      result: null,
      queryId: null,
      cancelling: false,
      inTransaction: false,
      autocommit: true,
      transactionStartedAt: null,
      outputKind: null,
      sort: null,
      filter: '',
      editorUi: null,
      lastFullDocExecutedSql: null,
      titleCustomized: false,
      // Default off so existing write/tx workflows are unchanged; user opts into RO
      readOnly: false,
      // Global defaults apply only at new-tab creation (not hot-overwrite open tabs).
      ...resolveQueryTabExecOptionsFromDefaults(getCachedQueryTabDefaults(), null),
      focusEditor: true,
      savedQueryId: savedQueryId || null,
    })
    activeTabId.value = id
    drafts.scheduleDraftSave()

    if (deps.databasesOf(connId).length === 0) {
      void deps.refreshDatabases(connId)
    }
    if (defaultDb) {
      try {
        await window.LiteConnect.dbUseDatabase(live.sessionId, defaultDb)
        deps.patchLiveSession(connId, { database: defaultDb })
      } catch {
        // 濞寸姴绉垫晶锕€顕ｉ埀顒勫蓟閵夘煈鍤勫銈囶暜缁辨繃娼婚幇顖ｆ斀闁哄啯婀圭槐浼村礃瀹ュ牏妲?USE
      }
      void deps.ensureTablesForDb(connId, defaultDb)
    }
    await nextTick()
  }

  /** 闁哄被鍎撮妤€顔忛妷銉ュ緮闁哄秴绻愰崹蹇涘箲閵忊剝娈堕柟璇″枛缁ㄩ亶鏁嶅杈╁綄闁?USE闁挎稑濂旂粚鑸电鎼粹剝鍊电紓?SQL 濮掓稒顭堥濠氭媰閽樺韬悹鍥ュ劚缁?*/
  async function onQueryDatabaseChange(tabId: string, database: string) {
    const tab = tabs.value.find((t) => t.id === tabId)
    if (!tab || tab.kind !== 'query') return
    if (tab.inTransaction) {
      // Never silent-switch DB while transaction is open
      ElMessage.warning(t('database.tx.switchDbBlocked'))
      return
    }
    const live = deps.getLiveSession(tab.connectionId)
    if (!live) return
    deps.focusConnection(tab.connectionId)
    tab.database = database
    if (!database) return
    try {
      await window.LiteConnect.dbUseDatabase(live.sessionId, database)
      deps.patchLiveSession(tab.connectionId, { database })
      void deps.ensureTablesForDb(tab.connectionId, database)
    } catch (err: any) {
      ElMessage.error(err.message || t('database.msg.switchDbFailed'))
    }
  }

  const history = useDbQueryHistory({
    session: deps.session,
    liveSessions: deps.liveSessions,
    activeConnectionId: deps.activeConnectionId,
    getLiveSession: deps.getLiveSession,
    openQueryTab,
  })

  const saved = useDbSavedQueries({
    tabs,
    liveSessions: deps.liveSessions,
    activeConnectionId: deps.activeConnectionId,
    getLiveSession: deps.getLiveSession,
    scheduleDraftSave: drafts.scheduleDraftSave,
    openQueryTab,
  })

  const tableOps = useDbTableTabOps({
    tabs,
    activeTabId,
    activeTab: activeTab as any,
    liveSessions: deps.liveSessions,
    selectedTableKey: deps.selectedTableKey,
    getLiveSession: deps.getLiveSession,
    focusConnection: deps.focusConnection,
    newTabId,
    dataLoadGen,
    structureLoadGen,
    metaLoadGen,
    exportProgress,
  })


  const resultExport = useDbResultExport({ activeTab })
  const queryRun = useDbQueryRun({
    tabs,
    activeTab,
    queryRunGen,
    getLiveSession: deps.getLiveSession,
    focusConnection: deps.focusConnection,
    dialectOf: deps.dialectOf,
    patchLiveSession: deps.patchLiveSession,
    scheduleDraftSave: drafts.scheduleDraftSave,
    pushQueryHistory: history.pushQueryHistory,
  })

  async function closeTab(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx < 0) return
    const tab = tabs.value[idx]
    if (tab.kind === 'query' && tab.inTransaction) {
      try {
        await appConfirm({
          title: t('database.tx.closeTitle'),
          message: t('database.tx.closeMessage'),
          detail: t('database.tx.closeDetail'),
          danger: true,
          tone: 'danger',
          confirmText: t('database.tx.closeConfirm'),
        })
      } catch {
        return
      }
    }
    if (tab.kind === 'data' && Object.keys(tab.dirty || {}).length > 0) {
      try {
        await appConfirm({
          title: t('database.data.closeDirtyTitle'),
          message: t('database.data.closeDirtyMessage', { table: tab.table }),
          danger: true,
          tone: 'warning',
          confirmText: t('database.data.closeDirtyConfirm'),
        })
      } catch {
        return
      }
    }
    if (tab.kind === 'query') {
      const live = deps.getLiveSession(tab.connectionId)
      if (tab.queryId && live) {
        void bestEffortCancelQuery(live.sessionId, tab.queryId, (sid, qid) =>
          window.LiteConnect.dbCancelQuery(sid, qid),
        )
      }
      if (live) {
        void window.LiteConnect.dbReleaseClient(live.sessionId, tab.id).catch(() => {})
      }
    }
    nextRequestGen(dataLoadGen, id)
    nextRequestGen(structureLoadGen, id)
    nextRequestGen(queryRunGen, id)
    nextRequestGen(metaLoadGen, id)
    if (tab.kind === 'query') {
      drafts.removeDraftForTab(tab.id)
      drafts.scheduleDraftSave()
    }
    tabs.value.splice(idx, 1)
    if (activeTabId.value === id) {
      activeTabId.value = (tabs.value[Math.max(0, idx - 1)] || tabs.value[0])?.id || null
    }
  }

  function connectionNameOf(connectionId: string): string {
    return (
      deps.liveSessions.value[connectionId]?.connectionName
      || deps.connections.value.find((c) => c.id === connectionId)?.name
      || t('database.connectionFallback')
    )
  }

  function connectionMetaOf(connectionId: string): string {
    const live = deps.liveSessions.value[connectionId]
    if (live) return `${live.username}@${live.host}:${live.port}`
    const c = deps.connections.value.find((x) => x.id === connectionId)
    if (c) return `${c.username}@${c.host}:${c.port || 3306}`
    return ''
  }

  function tabBarTitle(tab: WsTab): string {
    if (tab.kind === 'query') {
      if (tab.database) return `${tab.database} 璺?${tab.title}`
      return tab.title
    }
    return `${tab.database}.${tab.table}`
  }

  function tabBarTooltip(tab: WsTab): string {
    const conn = connectionNameOf(tab.connectionId)
    const meta = connectionMetaOf(tab.connectionId)
    const host = meta ? ` (${meta})` : ''
    if (tab.kind === 'query') {
      return t('database.tabTooltipQuery', {
        conn,
        host,
        db: tab.database || t('database.noDatabase'),
        title: tab.title,
      })
    }
    return t('database.tabTooltipTable', {
      conn,
      host,
      database: tab.database,
      table: 'table' in tab ? tab.table : '',
    })
  }

  function activateTab(tabId: string) {
    activeTabId.value = tabId
    const tab = tabs.value.find((t) => t.id === tabId)
    if (tab?.connectionId && deps.liveSessions.value[tab.connectionId]) {
      deps.focusConnection(tab.connectionId)
    }
  }

  function queryEnsureTables(database: string) {
    const tab = activeTab.value
    if (!tab || tab.kind !== 'query') return Promise.resolve()
    return deps.ensureTablesForDb(tab.connectionId, database)
  }

  function queryEnsureColumns(database: string, table: string) {
    const tab = activeTab.value
    if (!tab || tab.kind !== 'query') return Promise.resolve([] as DbColumnInfo[])
    return deps.ensureColumns(tab.connectionId, database, table)
  }

  function queryGetTables(database: string) {
    const tab = activeTab.value
    if (!tab || tab.kind !== 'query') return [] as DbTableInfo[]
    return deps.tablesOf(tab.connectionId, database)
  }

  function onQueryChangeDatabase(database: string) {
    const tab = activeTab.value
    if (!tab || tab.kind !== 'query') return
    void onQueryDatabaseChange(tab.id, database)
  }

  function onTableClick(connectionId: string, database: string, table: DbTableInfo) {
    tableOps.openDataTab(connectionId, database, table.name)
  }

  function clearTabsForConnection(connectionId: string) {
    drafts.syncOpenQueryTabsToDrafts()
    drafts.writeDraftsToStorage()
    const removed = tabs.value.filter((t) => t.connectionId === connectionId)
    for (const t of removed) {
      nextRequestGen(dataLoadGen, t.id)
      nextRequestGen(structureLoadGen, t.id)
      nextRequestGen(queryRunGen, t.id)
      nextRequestGen(metaLoadGen, t.id)
      if (t.kind === 'query') {
        drafts.clearRestoredMarker(t.id)
        const live = deps.getLiveSession(connectionId)
        if (live) {
          void window.LiteConnect.dbReleaseClient(live.sessionId, t.id).catch(() => {})
        }
      }
    }
    drafts.clearRestoredMarkersForConnection(connectionId)
    const remainingTabs = tabs.value.filter((t) => t.connectionId !== connectionId)
    tabs.value = remainingTabs
    if (!remainingTabs.some((t) => t.id === activeTabId.value)) {
      activeTabId.value = remainingTabs[0]?.id || null
    }
  }

  function hasQueryTabFor(connectionId: string) {
    return tabs.value.some((t) => t.connectionId === connectionId && t.kind === 'query')
  }

  function hasOpenTransactionFor(connectionId: string) {
    return tabs.value.some(
      (t) => t.connectionId === connectionId && t.kind === 'query' && t.inTransaction,
    )
  }

  async function confirmDisconnectIfNeeded(connectionId: string): Promise<boolean> {
    if (!hasOpenTransactionFor(connectionId)) return true
    try {
      await appConfirm({
        title: t('database.tx.disconnectTitle'),
        message: t('database.tx.disconnectMessage'),
        detail: t('database.tx.disconnectDetail'),
        danger: true,
        tone: 'danger',
        confirmText: t('database.tx.disconnectConfirm'),
      })
      return true
    } catch {
      return false
    }
  }

  return {
    tabs,
    activeTabId,
    queryHistory: history.queryHistory,
    historyOnlyCurrent: history.historyOnlyCurrent,
    historyStatusFilter: history.historyStatusFilter,
    exportProgress,
    activeTab,
    activeQueryTab,
    displayedHistory: history.displayedHistory,
    footerStatus,
    refreshQueryHistory: history.refreshQueryHistory,
    migrateLegacyQueryHistory: history.migrateLegacyQueryHistory,
    openQueryTab,
    openDataTab: tableOps.openDataTab,
    openStructureTab: tableOps.openStructureTab,
    setTablePanel: tableOps.setTablePanel,
    closeTab,
    activateTab,
    loadDataPage: tableOps.loadDataPage,
    loadDataMeta: tableOps.loadDataMeta,
    loadStructure: tableOps.loadStructure,
    runQuerySql: queryRun.runQuerySql,
    explainQuerySql: queryRun.explainQuerySql,
    beginTransaction: queryRun.beginTransaction,
    commitTransaction: queryRun.commitTransaction,
    rollbackTransaction: queryRun.rollbackTransaction,
    cancelActiveQuery: queryRun.cancelActiveQuery,
    toggleDataSort: tableOps.toggleDataSort,
    applyWhereFilter: tableOps.applyWhereFilter,
    changeDataPage: tableOps.changeDataPage,
    jumpDataPage: tableOps.jumpDataPage,
    changeDataPageSize: tableOps.changeDataPageSize,
    clearQueryHistory: history.clearQueryHistory,
    applyHistoryItem: history.applyHistoryItem,
    exportActiveResultCsv: resultExport.exportActiveResultCsv,
    exportActiveResultJson: resultExport.exportActiveResultJson,
    exportTableAllCsv: tableOps.exportTableAllCsv,
    cancelTableExport: tableOps.cancelTableExport,
    copyActiveResult: resultExport.copyActiveResult,
    copyResultCell: resultExport.copyResultCell,
    tabBarTitle,
    tabBarTooltip,
    connectionNameOf,
    connectionMetaOf,
    queryEnsureTables,
    queryEnsureColumns,
    queryGetTables,
    onQueryChangeDatabase,
    onTableClick,
    clearTabsForConnection,
    pruneDraftsForConnection: drafts.pruneDraftsForConnection,
    hasQueryTabFor,
    hasOpenTransactionFor,
    confirmDisconnectIfNeeded,
    isQueryDirty: drafts.isQueryDirty,
    onQuerySqlChanged: drafts.onQuerySqlChanged,
    renameQueryTab: drafts.renameQueryTab,
    setQueryReadOnly: queryRun.setQueryReadOnly,
    setQueryExecOptions: queryRun.setQueryExecOptions,
    initQueryDrafts: drafts.initQueryDrafts,
    disposeQueryDrafts: drafts.disposeQueryDrafts,
    restoreDraftsForConnection: drafts.restoreDraftsForConnection,
    flushDraftsNow: drafts.flushDraftsNow,
    savedQueries: saved.savedQueries,
    saveQuery: saved.saveQuery,
    deleteSavedQuery: saved.deleteSavedQuery,
    renameSavedQuery: saved.renameSavedQuery,
    applySavedQuery: saved.applySavedQuery,
  }
}
