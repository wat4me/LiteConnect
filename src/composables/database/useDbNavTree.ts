import { ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type {
  DbColumnInfo,
  DbConnection,
  DbSessionInfo,
  DbTableInfo,
} from '../../env.d'
import { t } from '../../i18n'
import {
  isLiveRequest,
  nextRequestGen,
  shouldClearLoading,
  type RequestGenMap,
} from './dbAsyncGuard'
import { treeDbKey } from './dbEngine'

export type DbNavTreeDeps = {
  getLiveSession: (connectionId: string | null | undefined) => DbSessionInfo | null
  patchLiveSession: (connectionId: string, patch: Partial<DbSessionInfo>) => void
  focusConnection: (connectionId: string) => void
  connect: (conn: DbConnection) => Promise<void>
  isConnActive: (id: string) => boolean
}

export function useDbNavTree(deps: DbNavTreeDeps) {
  /** 导航树中展开的连接（DBeaver：点击展开，不是跳页） */
  const expandedConnIds = ref<Set<string>>(new Set())
  /** connectionId -> 该连接下的库名列表 */
  const databasesByConn = ref<Record<string, string[]>>({})
  /** 已展开的库：`${connectionId}::${database}` */
  const expandedDbKeys = ref<Set<string>>(new Set())
  /** 表列表：`${connectionId}::${database}` -> tables */
  const tablesByKey = ref<Record<string, DbTableInfo[]>>({})
  /** Parallel per-node loading keys (not a single global key) */
  const treeLoadingKeys = ref<Set<string>>(new Set())
  const selectedTableKey = ref('')
  /** db.table -> 列信息缓存（SQL 补全） */
  const columnsCache = ref<Record<string, DbColumnInfo[]>>({})
  /** Per-node request generations (DB-005) */
  const treeLoadGen: RequestGenMap = new Map()
  const dbListGen: RequestGenMap = new Map()
  const ensureTablesGen: RequestGenMap = new Map()
  const ensureColumnsGen: RequestGenMap = new Map()
  /** In-flight ensure promises for dedupe */
  const ensureTablesInflight = new Map<string, Promise<void>>()
  const ensureColumnsInflight = new Map<string, Promise<DbColumnInfo[]>>()

  function setTreeLoading(key: string, loading: boolean) {
    const next = new Set(treeLoadingKeys.value)
    if (loading) next.add(key)
    else next.delete(key)
    treeLoadingKeys.value = next
  }

  function isTreeLoading(key: string): boolean {
    return treeLoadingKeys.value.has(key)
  }

  function databasesOf(connectionId: string | null | undefined): string[] {
    if (!connectionId) return []
    return databasesByConn.value[connectionId] || []
  }

  function tablesOf(connectionId: string, database: string): DbTableInfo[] {
    return tablesByKey.value[treeDbKey(connectionId, database)] || []
  }

  function tablesFor(connectionId: string, db: string): DbTableInfo[] {
    return tablesOf(connectionId, db)
  }

  function isDbExpanded(connectionId: string, database: string) {
    return expandedDbKeys.value.has(treeDbKey(connectionId, database))
  }

  function isConnExpanded(id: string) {
    return expandedConnIds.value.has(id)
  }

  function expandConn(connectionId: string) {
    const next = new Set(expandedConnIds.value)
    next.add(connectionId)
    expandedConnIds.value = next
  }

  function collapseConn(connectionId: string) {
    const next = new Set(expandedConnIds.value)
    next.delete(connectionId)
    expandedConnIds.value = next
  }

  /** 点击连接节点：展开/折叠；首次展开时自动连接（不踢掉其它已连接） */
  async function toggleConnection(conn: DbConnection) {
    if (expandedConnIds.value.has(conn.id) && deps.isConnActive(conn.id)) {
      collapseConn(conn.id)
      return
    }
    if (!deps.isConnActive(conn.id)) {
      await deps.connect(conn)
      return
    }
    deps.focusConnection(conn.id)
    expandConn(conn.id)
  }

  async function refreshDatabases(connectionId?: string, activeConnectionId?: string | null) {
    const connId = connectionId || activeConnectionId
    const live = deps.getLiveSession(connId)
    if (!live || !connId) return
    const gen = nextRequestGen(dbListGen, connId)
    const sessionId = live.sessionId
    try {
      const list = await window.LiteConnect.dbListDatabases(sessionId)
      if (!isLiveRequest(dbListGen, connId, gen)) return
      if (!deps.getLiveSession(connId)) return
      databasesByConn.value = { ...databasesByConn.value, [connId]: list }
    } catch (err: any) {
      if (!isLiveRequest(dbListGen, connId, gen)) return
      ElMessage.error(err.message || t('database.msg.loadDatabasesFailed'))
    }
  }

  async function expandDatabase(connectionId: string, db: string, forceOpen = false) {
    const live = deps.getLiveSession(connectionId)
    if (!live) return
    deps.focusConnection(connectionId)
    const key = treeDbKey(connectionId, db)
    // Collapse whenever already expanded — do not require tables cache (loading/error/empty).
    if (expandedDbKeys.value.has(key) && !forceOpen) {
      const next = new Set(expandedDbKeys.value)
      next.delete(key)
      expandedDbKeys.value = next
      // Invalidate in-flight load so late responses cannot re-apply state or leave loading stuck
      nextRequestGen(treeLoadGen, key)
      setTreeLoading(key, false)
      return
    }
    const next = new Set(expandedDbKeys.value)
    next.add(key)
    expandedDbKeys.value = next
    const gen = nextRequestGen(treeLoadGen, key)
    const sessionId = live.sessionId
    setTreeLoading(key, true)
    try {
      // Explicit database on list API only — do not mutate shared session.database
      const tables = await window.LiteConnect.dbListTableInfos(sessionId, db)
      if (!isLiveRequest(treeLoadGen, key, gen)) return
      if (!deps.getLiveSession(connectionId)) return
      // Do not re-expand a node the user collapsed while this request was in flight
      if (!expandedDbKeys.value.has(key)) return
      tablesByKey.value = {
        ...tablesByKey.value,
        [key]: tables,
      }
    } catch (err: any) {
      if (!isLiveRequest(treeLoadGen, key, gen)) return
      ElMessage.error(err.message || t('database.msg.loadTablesFailed'))
    } finally {
      if (shouldClearLoading(treeLoadGen, key, gen)) {
        setTreeLoading(key, false)
      }
    }
  }

  async function reloadTables(connectionId: string, db: string) {
    const live = deps.getLiveSession(connectionId)
    if (!live) return
    const key = treeDbKey(connectionId, db)
    const gen = nextRequestGen(treeLoadGen, key)
    const sessionId = live.sessionId
    setTreeLoading(key, true)
    try {
      const tables = await window.LiteConnect.dbListTableInfos(sessionId, db)
      if (!isLiveRequest(treeLoadGen, key, gen)) return
      if (!deps.getLiveSession(connectionId)) return
      tablesByKey.value = {
        ...tablesByKey.value,
        [key]: tables,
      }
    } catch (err: any) {
      if (!isLiveRequest(treeLoadGen, key, gen)) return
      ElMessage.error(err.message || t('database.msg.refreshFailed'))
    } finally {
      if (shouldClearLoading(treeLoadGen, key, gen)) {
        setTreeLoading(key, false)
      }
    }
  }

  /** 预取库内表列表，供 SQL 补全使用（generation + session 校验，迟到结果丢弃） */
  async function ensureTablesForDb(connectionId: string, db: string) {
    const live = deps.getLiveSession(connectionId)
    if (!live || !db) return
    const key = treeDbKey(connectionId, db)
    if (tablesByKey.value[key]) return
    const existing = ensureTablesInflight.get(key)
    if (existing) {
      await existing
      return
    }
    const gen = nextRequestGen(ensureTablesGen, key)
    const sessionId = live.sessionId
    const work = (async () => {
      try {
        const tables = await window.LiteConnect.dbListTableInfos(sessionId, db)
        if (!isLiveRequest(ensureTablesGen, key, gen)) return
        if (!deps.getLiveSession(connectionId)) return
        if (deps.getLiveSession(connectionId)?.sessionId !== sessionId) return
        tablesByKey.value = {
          ...tablesByKey.value,
          [key]: tables,
        }
      } catch {
        // 补全失败时静默，不影响写 SQL
      } finally {
        ensureTablesInflight.delete(key)
      }
    })()
    ensureTablesInflight.set(key, work)
    await work
  }

  async function ensureColumns(
    connectionId: string,
    db: string,
    table: string,
  ): Promise<DbColumnInfo[]> {
    const live = deps.getLiveSession(connectionId)
    if (!live || !db || !table) return []
    const key = `${connectionId}.${db}.${table}`
    if (columnsCache.value[key]) return columnsCache.value[key]
    const existing = ensureColumnsInflight.get(key)
    if (existing) return existing
    const gen = nextRequestGen(ensureColumnsGen, key)
    const sessionId = live.sessionId
    const work = (async (): Promise<DbColumnInfo[]> => {
      try {
        const cols = await window.LiteConnect.dbGetTableColumns(sessionId, db, table)
        if (!isLiveRequest(ensureColumnsGen, key, gen)) return []
        if (!deps.getLiveSession(connectionId)) return []
        if (deps.getLiveSession(connectionId)?.sessionId !== sessionId) return []
        columnsCache.value = { ...columnsCache.value, [key]: cols }
        return cols
      } catch {
        return []
      } finally {
        ensureColumnsInflight.delete(key)
      }
    })()
    ensureColumnsInflight.set(key, work)
    return work
  }

  function clearConnectionTree(connectionId: string) {
    nextRequestGen(dbListGen, connectionId)
    const { [connectionId]: _dbs, ...restDbs } = databasesByConn.value
    databasesByConn.value = restDbs
    const prefix = `${connectionId}::`
    const colPrefix = `${connectionId}.`
    const nextExpanded = new Set<string>()
    for (const k of expandedDbKeys.value) {
      if (!k.startsWith(prefix)) nextExpanded.add(k)
    }
    expandedDbKeys.value = nextExpanded
    const nextTables: Record<string, DbTableInfo[]> = {}
    for (const [k, v] of Object.entries(tablesByKey.value)) {
      if (k.startsWith(prefix)) {
        nextRequestGen(treeLoadGen, k)
        nextRequestGen(ensureTablesGen, k)
        ensureTablesInflight.delete(k)
      } else {
        nextTables[k] = v
      }
    }
    tablesByKey.value = nextTables
    // Clear column cache for this connection
    const nextCols: Record<string, DbColumnInfo[]> = {}
    for (const [k, v] of Object.entries(columnsCache.value)) {
      if (k.startsWith(colPrefix)) {
        nextRequestGen(ensureColumnsGen, k)
        ensureColumnsInflight.delete(k)
      } else {
        nextCols[k] = v
      }
    }
    columnsCache.value = nextCols
    // Also invalidate any loading key still in-flight without tables entry
    for (const k of treeLoadGen.keys()) {
      if (k.startsWith(prefix)) nextRequestGen(treeLoadGen, k)
    }
    for (const k of ensureTablesGen.keys()) {
      if (k.startsWith(prefix)) nextRequestGen(ensureTablesGen, k)
    }
    for (const k of ensureColumnsGen.keys()) {
      if (k.startsWith(colPrefix)) nextRequestGen(ensureColumnsGen, k)
    }
    const nextLoading = new Set<string>()
    for (const k of treeLoadingKeys.value) {
      if (!k.startsWith(prefix)) nextLoading.add(k)
    }
    treeLoadingKeys.value = nextLoading
    collapseConn(connectionId)
    if (selectedTableKey.value.startsWith(`${connectionId}.`)) {
      selectedTableKey.value = ''
    }
  }

  function initDatabasesFor(connectionId: string) {
    databasesByConn.value = { ...databasesByConn.value, [connectionId]: [] }
  }

  return {
    expandedConnIds: expandedConnIds as Ref<Set<string>>,
    databasesByConn,
    expandedDbKeys,
    tablesByKey,
    treeLoadingKeys: treeLoadingKeys as Ref<Set<string>>,
    isTreeLoading,
    selectedTableKey,
    columnsCache,
    databasesOf,
    tablesOf,
    tablesFor,
    isDbExpanded,
    isConnExpanded,
    expandConn,
    collapseConn,
    toggleConnection,
    refreshDatabases,
    expandDatabase,
    reloadTables,
    ensureTablesForDb,
    ensureColumns,
    clearConnectionTree,
    initDatabasesFor,
    treeDbKey,
  }
}
