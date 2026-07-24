import { ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { DbConnection, DbTableInfo } from '../../env.d'
import type { NavMenu } from '../../components/database/types'
import type { SqlDialect } from '../../utils/dbSql'
import { t } from '../../i18n'
import {
  countSql,
  describeTableSql,
  qualifiedTableSql,
  tableRefSql,
} from './dbEngine'

export type DbNavMenuDeps = {
  connect: (conn: DbConnection) => Promise<void>
  disconnectConnection: (connectionId?: string) => Promise<void>
  openEdit: (conn: DbConnection) => void | Promise<void>
  removeConnection: (conn: DbConnection) => void | Promise<void>
  isConnActive: (id: string) => boolean
  focusConnection: (connectionId: string) => void
  refreshDatabases: (connectionId?: string) => Promise<void>
  expandDatabase: (connectionId: string, db: string, forceOpen?: boolean) => Promise<void>
  openQueryTab: (presetSql?: string, database?: string, connectionId?: string) => void | Promise<void>
  openDataTab: (connectionId: string, database: string, table: string) => void
  openStructureTab: (connectionId: string, database: string, table: string) => void
  dialectOf: (connectionId: string | null | undefined) => SqlDialect
  getLiveSession: (connectionId: string | null | undefined) => { sessionId: string; engine: import('../../env.d').DbEngine } | null
  getConnectionName: (connectionId: string) => string
}

export function useDbNavMenu(deps: DbNavMenuDeps) {
  const navMenu = ref<NavMenu | null>(null)
  const createDbTarget = ref<{ connectionId: string; connectionName: string; engine: import('../../env.d').DbEngine } | null>(null)
  const createDbCreating = ref(false)

  function closeContextMenu() {
    navMenu.value = null
  }

  function placeMenu(clientX: number, clientY: number) {
    const pad = 8
    const mw = 220
    const mh = 320
    return {
      x: Math.max(pad, Math.min(clientX, window.innerWidth - mw - pad)),
      y: Math.max(pad, Math.min(clientY, window.innerHeight - mh - pad)),
    }
  }

  async function copyText(text: string, okMsg = t('database.msg.copied')) {
    try {
      await navigator.clipboard.writeText(text)
      ElMessage.success(okMsg)
    } catch {
      ElMessage.error(t('database.msg.copyFailed'))
    }
  }

  function onConnContext(e: MouseEvent, conn: DbConnection) {
    e.preventDefault()
    e.stopPropagation()
    const { x, y } = placeMenu(e.clientX, e.clientY)
    navMenu.value = { kind: 'conn', x, y, conn }
  }

  function onDbContext(e: MouseEvent, connectionId: string, database: string) {
    e.preventDefault()
    e.stopPropagation()
    const { x, y } = placeMenu(e.clientX, e.clientY)
    navMenu.value = { kind: 'db', x, y, connectionId, database }
  }

  function onTableContext(
    e: MouseEvent,
    connectionId: string,
    database: string,
    table: DbTableInfo,
  ) {
    e.preventDefault()
    e.stopPropagation()
    const { x, y } = placeMenu(e.clientX, e.clientY)
    navMenu.value = { kind: 'table', x, y, connectionId, database, table }
  }

  async function menuConnConnect() {
    const m = navMenu.value
    if (!m || m.kind !== 'conn') return
    navMenu.value = null
    await deps.connect(m.conn)
  }

  async function menuConnDisconnect() {
    const m = navMenu.value
    if (!m || m.kind !== 'conn') return
    const connId = m.conn.id
    navMenu.value = null
    await deps.disconnectConnection(connId)
  }

  async function menuConnRefresh() {
    const m = navMenu.value
    if (!m || m.kind !== 'conn') return
    const conn = m.conn
    navMenu.value = null
    if (!deps.isConnActive(conn.id)) {
      await deps.connect(conn)
      return
    }
    deps.focusConnection(conn.id)
    await deps.refreshDatabases(conn.id)
    ElMessage.success(t('database.msg.refreshedDatabases'))
  }

  function menuConnCreateDatabase() {
    const m = navMenu.value
    if (!m || m.kind !== 'conn') return
    const conn = m.conn
    navMenu.value = null
    if (!deps.isConnActive(conn.id)) {
      ElMessage.warning(t('database.msg.connectFirst'))
      return
    }
    const live = deps.getLiveSession(conn.id)
    if (!live) {
      ElMessage.warning(t('database.msg.disconnected'))
      return
    }
    createDbTarget.value = {
      connectionId: conn.id,
      connectionName: deps.getConnectionName(conn.id) || conn.name,
      engine: live.engine,
    }
  }

  async function executeCreateDatabase(input: {
    name: string
    charset?: string
    collate?: string
    encoding?: string
  }) {
    const target = createDbTarget.value
    if (!target || !input.name) return
    const live = deps.getLiveSession(target.connectionId)
    if (!live) {
      ElMessage.error(t('database.msg.disconnected'))
      createDbTarget.value = null
      return
    }
    createDbCreating.value = true
    try {
      await window.LiteConnect.dbCreateDatabase(live.sessionId, input.name, {
        charset: input.charset,
        collate: input.collate,
        encoding: input.encoding,
      })
      ElMessage.success(t('database.msg.createDatabaseSuccess', { name: input.name }))
      createDbTarget.value = null
      deps.focusConnection(target.connectionId)
      await deps.refreshDatabases(target.connectionId)
    } catch (err: any) {
      ElMessage.error(err?.message || t('database.msg.createDatabaseFailed'))
    } finally {
      createDbCreating.value = false
    }
  }

  function closeCreateDatabaseDialog() {
    if (createDbCreating.value) return
    createDbTarget.value = null
  }

  function menuConnEdit() {
    const m = navMenu.value
    if (!m || m.kind !== 'conn') return
    navMenu.value = null
    void deps.openEdit(m.conn)
  }

  function menuConnDelete() {
    const m = navMenu.value
    if (!m || m.kind !== 'conn') return
    navMenu.value = null
    void deps.removeConnection(m.conn)
  }

  function menuConnCopyHost() {
    const m = navMenu.value
    if (!m || m.kind !== 'conn') return
    const c = m.conn
    navMenu.value = null
    void copyText(`${c.host}:${c.port}`, t('database.msg.copiedHost'))
  }

  function menuDbNewQuery() {
    const m = navMenu.value
    if (!m || m.kind !== 'db') return
    const { connectionId, database } = m
    navMenu.value = null
    void deps.openQueryTab('', database, connectionId)
  }

  async function menuDbRefresh() {
    const m = navMenu.value
    if (!m || m.kind !== 'db') return
    const { connectionId, database } = m
    navMenu.value = null
    await deps.expandDatabase(connectionId, database, true)
    ElMessage.success(t('database.msg.refreshedTables', { database }))
  }

  function menuDbCopyName() {
    const m = navMenu.value
    if (!m || m.kind !== 'db') return
    const db = m.database
    navMenu.value = null
    void copyText(db, t('database.msg.copiedDb'))
  }

  function menuTableViewData() {
    const m = navMenu.value
    if (!m || m.kind !== 'table') return
    const { connectionId, database, table } = m
    navMenu.value = null
    deps.openDataTab(connectionId, database, table.name)
  }

  function menuTableStructure() {
    const m = navMenu.value
    if (!m || m.kind !== 'table') return
    const { connectionId, database, table } = m
    navMenu.value = null
    deps.openStructureTab(connectionId, database, table.name)
  }

  function menuTableSelect() {
    const m = navMenu.value
    if (!m || m.kind !== 'table') return
    const { connectionId, database, table } = m
    navMenu.value = null
    const d = deps.dialectOf(connectionId)
    // Preserve prior behavior: FROM uses tableRefSql (not fully qualified for MySQL)
    const from = tableRefSql(table.name, d)
    void deps.openQueryTab(`SELECT *\nFROM ${from}\nLIMIT 100;\n`, database, connectionId)
  }

  function menuTableCount() {
    const m = navMenu.value
    if (!m || m.kind !== 'table') return
    const { connectionId, database, table } = m
    navMenu.value = null
    const d = deps.dialectOf(connectionId)
    void deps.openQueryTab(countSql(database, table.name, d), database, connectionId)
  }

  function menuTableDescribe() {
    const m = navMenu.value
    if (!m || m.kind !== 'table') return
    const { connectionId, database, table } = m
    navMenu.value = null
    const d = deps.dialectOf(connectionId)
    void deps.openQueryTab(describeTableSql(table.name, d), database, connectionId)
  }

  function menuTableCopyName() {
    const m = navMenu.value
    if (!m || m.kind !== 'table') return
    const name = m.table.name
    navMenu.value = null
    void copyText(name, t('database.msg.copiedTable'))
  }

  function menuTableCopyQualified() {
    const m = navMenu.value
    if (!m || m.kind !== 'table') return
    const q = `${m.database}.${m.table.name}`
    navMenu.value = null
    void copyText(q, t('database.msg.copiedQualified'))
  }

  function menuTableCopySelect() {
    const m = navMenu.value
    if (!m || m.kind !== 'table') return
    const d = deps.dialectOf(m.connectionId)
    const from = qualifiedTableSql(m.database, m.table.name, d)
    const sql = `SELECT * FROM ${from} LIMIT 100;`
    navMenu.value = null
    void copyText(sql, t('database.msg.copiedSql'))
  }

  return {
    navMenu,
    closeContextMenu,
    placeMenu,
    onConnContext,
    onDbContext,
    onTableContext,
    menuConnConnect,
    menuConnDisconnect,
    menuConnRefresh,
    menuConnEdit,
    menuConnDelete,
    menuConnCopyHost,
    menuConnCreateDatabase,
    createDbTarget,
    createDbCreating,
    executeCreateDatabase,
    closeCreateDatabaseDialog,
    menuDbNewQuery,
    menuDbRefresh,
    menuDbCopyName,
    menuTableViewData,
    menuTableStructure,
    menuTableSelect,
    menuTableCount,
    menuTableDescribe,
    menuTableCopyName,
    menuTableCopyQualified,
    menuTableCopySelect,
  }
}
