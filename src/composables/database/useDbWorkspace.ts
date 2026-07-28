import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDbSettings } from '../useDbSettings'
import type { DbConnection, DbSessionInfo } from '../../env.d'
import { useDbConnections } from './useDbConnections'
import { useDbNavTree } from './useDbNavTree'
import { useDbTabs } from './useDbTabs'
import { useDbDataEdit } from './useDbDataEdit'
import { useDbNavMenu } from './useDbNavMenu'
import { useTitlebarConnection } from '../useTitlebarConnection'

export function useDbWorkspace() {
  const dbRootRef = ref<HTMLElement | null>(null)
  useDbSettings(() => dbRootRef.value)
  const { setDbConnectionLabel } = useTitlebarConnection()

  // Late-bound module refs so connection hooks can call nav/tabs cleanup.
  let nav!: ReturnType<typeof useDbNavTree>
  let tabsApi!: ReturnType<typeof useDbTabs>
  let refreshHistory: () => void = () => {}

  const connectionsApi = useDbConnections({
    onConnectExisting: async (conn: DbConnection) => {
      nav.expandConn(conn.id)
      void refreshHistory()
      // Restore drafts only after connection is live — never creates a background session
      await tabsApi.restoreDraftsForConnection(conn.id)
      if (!tabsApi.hasQueryTabFor(conn.id)) {
        await tabsApi.openQueryTab(undefined, undefined, conn.id)
      }
    },
    onConnectNew: async (conn: DbConnection, info: DbSessionInfo) => {
      nav.initDatabasesFor(conn.id)
      nav.expandConn(conn.id)
      await nav.refreshDatabases(conn.id)
      void refreshHistory()
      await tabsApi.restoreDraftsForConnection(conn.id)
      if (!tabsApi.hasQueryTabFor(conn.id)) {
        await tabsApi.openQueryTab(undefined, undefined, conn.id)
      }
      if (info.database) await nav.expandDatabase(conn.id, info.database, true)
    },
    onConnectFailed: (conn: DbConnection) => {
      nav.collapseConn(conn.id)
    },
    cleanupAfterDisconnect: (connectionId: string) => {
      tabsApi.clearTabsForConnection(connectionId)
      nav.clearConnectionTree(connectionId)
    },
    onActiveFallback: (otherId: string | null) => {
      if (otherId) nav.expandConn(otherId)
    },
    afterDisconnect: () => {
      void refreshHistory()
    },
  })

  nav = useDbNavTree({
    getLiveSession: connectionsApi.getLiveSession,
    patchLiveSession: connectionsApi.patchLiveSession,
    focusConnection: connectionsApi.focusConnection,
    connect: connectionsApi.connect,
    isConnActive: connectionsApi.isConnActive,
  })

  const refreshDatabases = (connectionId?: string) =>
    nav.refreshDatabases(connectionId, connectionsApi.activeConnectionId.value)

  tabsApi = useDbTabs({
    liveSessions: connectionsApi.liveSessions,
    activeConnectionId: connectionsApi.activeConnectionId,
    session: connectionsApi.session,
    connections: connectionsApi.connections,
    liveSessionCount: connectionsApi.liveSessionCount,
    selectedTableKey: nav.selectedTableKey,
    getLiveSession: connectionsApi.getLiveSession,
    focusConnection: connectionsApi.focusConnection,
    patchLiveSession: connectionsApi.patchLiveSession,
    dialectOf: connectionsApi.dialectOf,
    ensureTablesForDb: nav.ensureTablesForDb,
    ensureColumns: nav.ensureColumns,
    tablesOf: nav.tablesOf,
    databasesOf: nav.databasesOf,
    refreshDatabases,
  })

  refreshHistory = () => {
    void tabsApi.refreshQueryHistory()
  }

  const dataEdit = useDbDataEdit({
    activeTab: tabsApi.activeTab,
    getLiveSession: connectionsApi.getLiveSession,
    dialectOf: connectionsApi.dialectOf,
    loadDataPage: tabsApi.loadDataPage,
  })

  async function disconnectConnectionSafe(connectionId?: string) {
    const connId = connectionId || connectionsApi.activeConnectionId.value
    if (!connId) return
    if (!(await tabsApi.confirmDisconnectIfNeeded(connId))) return
    await connectionsApi.disconnectConnection(connId)
  }

  async function removeConnectionSafe(conn: DbConnection) {
    await connectionsApi.removeConnection(conn)
    // Permanent delete: drop drafts so they never attach to another connection
    tabsApi.pruneDraftsForConnection(conn.id)
  }

  const menu = useDbNavMenu({
    connect: connectionsApi.connect,
    disconnectConnection: disconnectConnectionSafe,
    openEdit: connectionsApi.openEdit,
    removeConnection: removeConnectionSafe,
    isConnActive: connectionsApi.isConnActive,
    focusConnection: connectionsApi.focusConnection,
    refreshDatabases,
    expandDatabase: nav.expandDatabase,
    openQueryTab: tabsApi.openQueryTab,
    openDataTab: tabsApi.openDataTab,
    openStructureTab: tabsApi.openStructureTab,
    dialectOf: connectionsApi.dialectOf,
    getLiveSession: connectionsApi.getLiveSession,
    getConnectionName: tabsApi.connectionNameOf,
  })

  watch(
    connectionsApi.session,
    (s) => {
      if (!s) {
        setDbConnectionLabel('')
        return
      }
      setDbConnectionLabel(`${s.username}@${s.host}:${s.port}`)
    },
    { immediate: true },
  )

  onMounted(() => {
    void connectionsApi.loadConnections().then(() => {
      tabsApi.initQueryDrafts()
    })
    void (async () => {
      await tabsApi.migrateLegacyQueryHistory()
      await tabsApi.refreshQueryHistory()
    })()
    window.addEventListener('beforeunload', tabsApi.flushDraftsNow)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', tabsApi.flushDraftsNow)
    tabsApi.disposeQueryDrafts()
    setDbConnectionLabel('')
    void connectionsApi.disconnectAllSessions()
  })

  return {
    dbRootRef,
    session: connectionsApi.session,
    engineLabel: connectionsApi.engineLabel,
    openQueryTab: tabsApi.openQueryTab,
    refreshDatabases,
    disconnectSession: async () => {
      await disconnectConnectionSafe(connectionsApi.activeConnectionId.value || undefined)
    },
    connections: connectionsApi.connections,
    loading: connectionsApi.loading,
    connectingId: connectionsApi.connectingId,
    isConnecting: connectionsApi.isConnecting,
    selectedTableKey: nav.selectedTableKey,
    treeLoadingKeys: nav.treeLoadingKeys,
    isTreeLoading: nav.isTreeLoading,
    isConnActive: connectionsApi.isConnActive,
    isConnFocused: connectionsApi.isConnFocused,
    isConnExpanded: nav.isConnExpanded,
    isDbExpanded: nav.isDbExpanded,
    databasesOf: nav.databasesOf,
    tablesFor: nav.tablesFor,
    treeDbKey: nav.treeDbKey,
    openCreate: connectionsApi.openCreate,
    toggleConnection: nav.toggleConnection,
    connect: connectionsApi.connect,
    openEdit: connectionsApi.openEdit,
    removeConnection: removeConnectionSafe,
    expandDatabase: nav.expandDatabase,
    reloadTables: nav.reloadTables,
    onTableClick: tabsApi.onTableClick,
    onConnContext: menu.onConnContext,
    onDbContext: menu.onDbContext,
    onTableContext: menu.onTableContext,
    tabs: tabsApi.tabs,
    activeTabId: tabsApi.activeTabId,
    tabBarTooltip: tabsApi.tabBarTooltip,
    activateTab: tabsApi.activateTab,
    connectionMetaOf: tabsApi.connectionMetaOf,
    connectionNameOf: tabsApi.connectionNameOf,
    tabBarTitle: tabsApi.tabBarTitle,
    closeTab: tabsApi.closeTab,
    activeTab: tabsApi.activeTab,
    activeQueryTab: tabsApi.activeQueryTab,
    onQuerySqlChanged: tabsApi.onQuerySqlChanged,
    isQueryDirty: tabsApi.isQueryDirty,
    renameQueryTab: tabsApi.renameQueryTab,
    setQueryReadOnly: tabsApi.setQueryReadOnly,
    setQueryExecOptions: tabsApi.setQueryExecOptions,
    displayedHistory: tabsApi.displayedHistory,
    historyOnlyCurrent: tabsApi.historyOnlyCurrent,
    historyStatusFilter: tabsApi.historyStatusFilter,
    savedQueries: tabsApi.savedQueries,
    saveQuery: tabsApi.saveQuery,
    deleteSavedQuery: tabsApi.deleteSavedQuery,
    renameSavedQuery: tabsApi.renameSavedQuery,
    applySavedQuery: tabsApi.applySavedQuery,
    exportProgress: tabsApi.exportProgress,
    getLiveSession: connectionsApi.getLiveSession,
    dialectOf: connectionsApi.dialectOf,
    queryGetTables: tabsApi.queryGetTables,
    queryEnsureTables: tabsApi.queryEnsureTables,
    queryEnsureColumns: tabsApi.queryEnsureColumns,
    runQuerySql: tabsApi.runQuerySql,
    explainQuerySql: tabsApi.explainQuerySql,
    beginTransaction: tabsApi.beginTransaction,
    commitTransaction: tabsApi.commitTransaction,
    rollbackTransaction: tabsApi.rollbackTransaction,
    cancelActiveQuery: tabsApi.cancelActiveQuery,
    onQueryChangeDatabase: tabsApi.onQueryChangeDatabase,
    clearQueryHistory: tabsApi.clearQueryHistory,
    applyHistoryItem: tabsApi.applyHistoryItem,
    copyActiveResult: tabsApi.copyActiveResult,
    exportActiveResultCsv: tabsApi.exportActiveResultCsv,
    exportActiveResultJson: tabsApi.exportActiveResultJson,
    exportTableAllCsv: tabsApi.exportTableAllCsv,
    cancelTableExport: tabsApi.cancelTableExport,
    copyResultCell: tabsApi.copyResultCell,
    toggleDataSort: tabsApi.toggleDataSort,
    applyServerSearch: tabsApi.applyServerSearch,
    changeDataPage: tabsApi.changeDataPage,
    jumpDataPage: tabsApi.jumpDataPage,
    changeDataPageSize: tabsApi.changeDataPageSize,
    loadDataPage: tabsApi.loadDataPage,
    openStructureTab: tabsApi.openStructureTab,
    setTablePanel: tabsApi.setTablePanel,
    startInsertRow: dataEdit.startInsertRow,
    saveDirtyRows: dataEdit.saveDirtyRows,
    discardDirty: dataEdit.discardDirty,
    deleteSelectedRows: dataEdit.deleteSelectedRows,
    toggleSelectRow: dataEdit.toggleSelectRow,
    startEditCell: dataEdit.startEditCell,
    onEditCellKeydown: dataEdit.onEditCellKeydown,
    onEditCellBlur: dataEdit.onEditCellBlur,
    setInsertCell: dataEdit.setInsertCell,
    saveInsertRow: dataEdit.saveInsertRow,
    cancelInsertRow: dataEdit.cancelInsertRow,
    loadStructure: tabsApi.loadStructure,
    footerStatus: tabsApi.footerStatus,
    navMenu: menu.navMenu,
    closeContextMenu: menu.closeContextMenu,
    menuConnConnect: menu.menuConnConnect,
    menuConnDisconnect: menu.menuConnDisconnect,
    menuConnRefresh: menu.menuConnRefresh,
    menuConnCopyHost: menu.menuConnCopyHost,
    menuConnEdit: menu.menuConnEdit,
    menuConnDelete: menu.menuConnDelete,
    menuConnCreateDatabase: menu.menuConnCreateDatabase,
    createDbTarget: menu.createDbTarget,
    createDbCreating: menu.createDbCreating,
    executeCreateDatabase: menu.executeCreateDatabase,
    closeCreateDatabaseDialog: menu.closeCreateDatabaseDialog,
    menuDbNewQuery: menu.menuDbNewQuery,
    menuDbRefresh: menu.menuDbRefresh,
    menuDbCopyName: menu.menuDbCopyName,
    menuTableViewData: menu.menuTableViewData,
    menuTableStructure: menu.menuTableStructure,
    menuTableSelect: menu.menuTableSelect,
    menuTableCount: menu.menuTableCount,
    menuTableDescribe: menu.menuTableDescribe,
    menuTableCopyName: menu.menuTableCopyName,
    menuTableCopyQualified: menu.menuTableCopyQualified,
    menuTableCopySelect: menu.menuTableCopySelect,
    showForm: connectionsApi.showForm,
    form: connectionsApi.form,
    editingId: connectionsApi.editingId,
    saving: connectionsApi.saving,
    testing: connectionsApi.testing,
    testHint: connectionsApi.testHint,
    closeForm: connectionsApi.closeForm,
    saveForm: connectionsApi.saveForm,
    testForm: connectionsApi.testForm,
    sshConnections: connectionsApi.sshConnections,
    groups: connectionsApi.groups,
    exportConnections: connectionsApi.exportConnections,
    importConnections: connectionsApi.importConnections,
  }
}
