import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { DbConnection, DbEngine, DbSessionInfo, DbSslOptions } from '../../env.d'
import { appConfirm } from '../useAppDialog'
import type { ConnectionFormModel } from '../../components/database/types'
import type { SqlDialect } from '../../utils/dbSql'
import { t } from '../../i18n'
import { defaultPort, dialectOfEngine, engineLabel } from './dbEngine'

export type DbConnectionsHooks = {
  onConnectExisting: (conn: DbConnection) => void | Promise<void>
  onConnectNew: (conn: DbConnection, info: DbSessionInfo) => void | Promise<void>
  onConnectFailed: (conn: DbConnection) => void
  cleanupAfterDisconnect: (connectionId: string) => void
  onActiveFallback: (otherId: string | null) => void
  afterDisconnect: () => void
}

function emptySsl(): DbSslOptions {
  return { enabled: false, rejectUnauthorized: false }
}

function emptyForm(): ConnectionFormModel {
  return {
    name: '',
    engine: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    username: 'root',
    password: '',
    database: '',
    ssl: false,
    sslOptions: emptySsl(),
    group: '',
    sshConnectionId: '',
  }
}

export function useDbConnections(hooks: DbConnectionsHooks) {
  const connections = ref<DbConnection[]>([])
  const sshConnections = ref<
    Array<{ id: string; name: string; host: string; port: number; username: string }>
  >([])
  const groups = ref<string[]>([])
  const loading = ref(true)
  const showForm = ref(false)
  const saving = ref(false)
  const testing = ref(false)
  const testHint = ref('')
  /** connectionIds currently connecting (supports parallel connects on different ids) */
  const connectingIds = ref<Set<string>>(new Set())
  /** @deprecated use isConnecting(id); kept for single-id UI that only needs one flag */
  const connectingId = computed(() => {
    const first = connectingIds.value.values().next()
    return first.done ? null : first.value
  })
  /** In-flight connect promises keyed by connectionId (dedupe double-click) */
  const connectInflight = new Map<string, Promise<void>>()
  /** Generation per connection so stale responses are discarded + disconnected */
  const connectGeneration = new Map<string, number>()
  const editingId = ref<string | null>(null)
  const form = ref<ConnectionFormModel>(emptyForm())

  const liveSessions = ref<Record<string, DbSessionInfo>>({})
  const activeConnectionId = ref<string | null>(null)
  const session = computed(() => {
    const id = activeConnectionId.value
    if (!id) return null
    return liveSessions.value[id] ?? null
  })
  const liveSessionCount = computed(() => Object.keys(liveSessions.value).length)

  function getLiveSession(connectionId: string | null | undefined): DbSessionInfo | null {
    if (!connectionId) return null
    return liveSessions.value[connectionId] ?? null
  }

  function patchLiveSession(connectionId: string, patch: Partial<DbSessionInfo>) {
    const cur = liveSessions.value[connectionId]
    if (!cur) return
    liveSessions.value = { ...liveSessions.value, [connectionId]: { ...cur, ...patch } }
  }

  function focusConnection(connectionId: string) {
    if (!liveSessions.value[connectionId]) return
    activeConnectionId.value = connectionId
  }

  function isConnActive(id: string) {
    return !!liveSessions.value[id]
  }

  function isConnecting(id: string) {
    return connectingIds.value.has(id)
  }

  function markConnecting(id: string, on: boolean) {
    const next = new Set(connectingIds.value)
    if (on) next.add(id)
    else next.delete(id)
    connectingIds.value = next
  }

  function isConnFocused(id: string) {
    return activeConnectionId.value === id
  }

  function engineOf(connectionId: string | null | undefined): DbEngine {
    if (!connectionId) return 'mysql'
    const live = liveSessions.value[connectionId]
    if (live?.engine) return live.engine
    return connections.value.find((c) => c.id === connectionId)?.engine || 'mysql'
  }

  function dialectOf(connectionId: string | null | undefined): SqlDialect {
    return dialectOfEngine(engineOf(connectionId))
  }

  async function loadConnections() {
    loading.value = true
    try {
      const [list, ssh, g] = await Promise.all([
        window.LiteConnect.dbListConnections(),
        window.LiteConnect.dbListSshConnections().catch(() => []),
        window.LiteConnect.dbListGroups().catch(() => []),
      ])
      connections.value = list
      sshConnections.value = ssh
      groups.value = g
    } catch (err: any) {
      ElMessage.error(err.message || t('database.msg.loadConnectionsFailed'))
    } finally {
      loading.value = false
    }
  }

  function resetForm() {
    form.value = emptyForm()
    editingId.value = null
    testHint.value = ''
  }

  function openCreate() {
    resetForm()
    showForm.value = true
    void refreshSshAndGroups()
  }

  async function refreshSshAndGroups() {
    try {
      const [ssh, g] = await Promise.all([
        window.LiteConnect.dbListSshConnections(),
        window.LiteConnect.dbListGroups(),
      ])
      sshConnections.value = ssh
      groups.value = g
    } catch {}
  }

  async function openEdit(conn: DbConnection) {
    const password = await window.LiteConnect.dbGetConnectionPassword(conn.id)
    const engine = conn.engine === 'postgres' ? 'postgres' : 'mysql'
    editingId.value = conn.id
    const sslOptions: DbSslOptions = {
      enabled: !!(conn.sslOptions?.enabled ?? conn.ssl),
      rejectUnauthorized: conn.sslOptions?.rejectUnauthorized,
      ca: conn.sslOptions?.ca || '',
      cert: conn.sslOptions?.cert || '',
      key: conn.sslOptions?.key || '',
    }
    form.value = {
      name: conn.name,
      engine,
      host: conn.host,
      port: conn.port || defaultPort(engine),
      username: conn.username,
      password,
      database: conn.database || '',
      ssl: !!sslOptions.enabled,
      sslOptions,
      group: conn.group || '',
      sshConnectionId: conn.sshConnectionId || '',
    }
    testHint.value = ''
    showForm.value = true
    void refreshSshAndGroups()
  }

  function closeForm() {
    showForm.value = false
    resetForm()
  }

  async function saveForm() {
    if (!form.value.name.trim()) {
      ElMessage.warning(t('database.msg.needName'))
      return
    }
    if (!form.value.host.trim()) {
      ElMessage.warning(t('database.msg.needHost'))
      return
    }
    if (!form.value.username.trim()) {
      ElMessage.warning(t('database.msg.needUsername'))
      return
    }
    saving.value = true
    try {
      const engine = form.value.engine === 'postgres' ? 'postgres' : 'mysql'
      const sslOptions: DbSslOptions = {
        enabled: !!(form.value.sslOptions?.enabled ?? form.value.ssl),
        rejectUnauthorized: form.value.sslOptions?.rejectUnauthorized,
        ca: form.value.sslOptions?.ca?.trim() || undefined,
        cert: form.value.sslOptions?.cert?.trim() || undefined,
        key: form.value.sslOptions?.key?.trim() || undefined,
      }
      await window.LiteConnect.dbSaveConnection({
        ...(editingId.value ? { id: editingId.value } : {}),
        name: form.value.name.trim(),
        engine,
        host: form.value.host.trim(),
        port: form.value.port || defaultPort(engine),
        username: form.value.username.trim(),
        password: form.value.password,
        database: form.value.database.trim() || undefined,
        ssl: !!sslOptions.enabled,
        sslOptions,
        group: form.value.group.trim() || undefined,
        sshConnectionId: form.value.sshConnectionId.trim() || undefined,
      })
      ElMessage.success(editingId.value ? t('database.msg.saved') : t('database.msg.added'))
      closeForm()
      await loadConnections()
    } catch (err: any) {
      ElMessage.error(err.message || t('database.msg.saveFailed'))
    } finally {
      saving.value = false
    }
  }

  async function testForm() {
    if (!form.value.host.trim() || !form.value.username.trim()) {
      ElMessage.warning(t('database.msg.needHostUser'))
      return
    }
    testing.value = true
    testHint.value = ''
    try {
      const engine = form.value.engine === 'postgres' ? 'postgres' : 'mysql'
      const sslOptions: DbSslOptions = {
        enabled: !!(form.value.sslOptions?.enabled ?? form.value.ssl),
        rejectUnauthorized: form.value.sslOptions?.rejectUnauthorized,
        ca: form.value.sslOptions?.ca?.trim() || undefined,
        cert: form.value.sslOptions?.cert?.trim() || undefined,
        key: form.value.sslOptions?.key?.trim() || undefined,
      }
      const result = await window.LiteConnect.dbTestConnection({
        engine,
        host: form.value.host.trim(),
        port: form.value.port || defaultPort(engine),
        username: form.value.username.trim(),
        password: form.value.password,
        database: form.value.database.trim() || undefined,
        ssl: !!sslOptions.enabled,
        sslOptions,
        sshConnectionId: form.value.sshConnectionId.trim() || undefined,
        connectionId: editingId.value || undefined,
      })
      const tunnel = result.viaTunnel ? t('database.connection.tunnelSuffix') : ''
      testHint.value = result.ok
        ? t('database.connection.testOk', {
            ms: result.latencyMs,
            version: result.serverVersion || engineLabel(engine),
            tunnel,
          })
        : result.error || t('database.connection.testFail')
    } catch (err: any) {
      testHint.value = err.message || t('database.connection.testError')
    } finally {
      testing.value = false
    }
  }

  async function removeConnection(conn: DbConnection) {
    try {
      await appConfirm({
        title: t('database.msg.deleteConnectionTitle'),
        message: t('database.msg.deleteConnectionMessage', { name: conn.name }),
        detail: t('database.msg.deleteConnectionDetail'),
        confirmText: t('common.delete'),
        danger: true,
        tone: 'danger',
      })
      if (isConnActive(conn.id)) await disconnectConnection(conn.id)
      await window.LiteConnect.dbDeleteConnection(conn.id)
      ElMessage.success(t('database.msg.deleted'))
      await loadConnections()
    } catch {}
  }

  async function exportConnections(includePassword = false) {
    try {
      const ok = await window.LiteConnect.dbExportConnections(includePassword)
      if (ok) ElMessage.success(t('database.msg.exported'))
    } catch (err: any) {
      ElMessage.error(err.message || t('database.msg.exportFailed'))
    }
  }

  async function importConnections() {
    try {
      const result = await window.LiteConnect.dbImportConnections()
      if (!result) return
      ElMessage.success(
        t('database.msg.imported', { imported: result.imported, skipped: result.skipped }),
      )
      await loadConnections()
    } catch (err: any) {
      ElMessage.error(err.message || t('database.msg.importFailed'))
    }
  }

  async function connect(conn: DbConnection) {
    if (liveSessions.value[conn.id]) {
      focusConnection(conn.id)
      await hooks.onConnectExisting(conn)
      return
    }
    // Reuse in-flight promise for the same connection (double-click / rapid retry)
    const existing = connectInflight.get(conn.id)
    if (existing) {
      await existing
      return
    }

    const gen = (connectGeneration.get(conn.id) || 0) + 1
    connectGeneration.set(conn.id, gen)
    markConnecting(conn.id, true)

    const run = (async () => {
      try {
        const info = await window.LiteConnect.dbConnect(conn.id)
        // Stale: disconnect was requested or a newer connect superseded this one
        if (connectGeneration.get(conn.id) !== gen) {
          try {
            await window.LiteConnect.dbDisconnect(info.sessionId)
          } catch {}
          return
        }
        // Handshake: tunnel may have dropped before IPC event was subscribed / race
        const raced =
          (info as any).sessionLost ||
          (await window.LiteConnect.dbTakePendingSessionLost?.(conn.id, info.sessionId).catch(() => null))
        if (raced && raced.sessionId === info.sessionId) {
          try {
            await window.LiteConnect.dbDisconnect(info.sessionId)
          } catch {}
          ElMessage.warning(t('database.msg.tunnelDisconnected'))
          hooks.onConnectFailed(conn)
          return
        }
        liveSessions.value = { ...liveSessions.value, [conn.id]: info }
        activeConnectionId.value = conn.id
        await hooks.onConnectNew(conn, info)
      } catch (err: any) {
        if (connectGeneration.get(conn.id) !== gen) return
        ElMessage.error(err.message || t('database.msg.connectFailed'))
        hooks.onConnectFailed(conn)
      } finally {
        if (connectGeneration.get(conn.id) === gen) {
          markConnecting(conn.id, false)
        }
        connectInflight.delete(conn.id)
      }
    })()

    connectInflight.set(conn.id, run)
    await run
  }

  async function disconnectConnection(connectionId?: string) {
    const connId = connectionId || activeConnectionId.value
    if (!connId) return

    // Invalidate any in-flight connect so its response is disconnected
    connectGeneration.set(connId, (connectGeneration.get(connId) || 0) + 1)
    markConnecting(connId, false)

    const live = liveSessions.value[connId]
    if (!live) {
      // Still ask main to drop any orphan sessions for this connection
      try {
        await window.LiteConnect.dbDisconnectByConnectionId?.(connId)
      } catch {}
      return
    }

    const sessionId = live.sessionId
    const { [connId]: _removed, ...restSessions } = liveSessions.value
    liveSessions.value = restSessions

    hooks.cleanupAfterDisconnect(connId)

    if (activeConnectionId.value === connId) {
      const other = Object.keys(liveSessions.value)[0] || null
      activeConnectionId.value = other
      hooks.onActiveFallback(other)
    }

    try {
      await window.LiteConnect.dbDisconnect(sessionId)
    } catch {}
    hooks.afterDisconnect()
  }

  async function disconnectSession() {
    await disconnectConnection(activeConnectionId.value || undefined)
  }

  async function disconnectAllSessions() {
    const entries = Object.values(liveSessions.value)
    liveSessions.value = {}
    activeConnectionId.value = null
    for (const s of entries) {
      try {
        await window.LiteConnect.dbDisconnect(s.sessionId)
      } catch {}
    }
  }

  function handleSessionLost(ev: {
    sessionId: string
    connectionId: string
    reason: string
    detail?: string
    message?: string
  }) {
    const live = liveSessions.value[ev.connectionId]
    if (!live || live.sessionId !== ev.sessionId) return

    const { [ev.connectionId]: _removed, ...rest } = liveSessions.value
    liveSessions.value = rest
    hooks.cleanupAfterDisconnect(ev.connectionId)
    if (activeConnectionId.value === ev.connectionId) {
      const other = Object.keys(liveSessions.value)[0] || null
      activeConnectionId.value = other
      hooks.onActiveFallback(other)
    }
    // Always prefer i18n; never show main-process English message as primary UI copy
    ElMessage.warning(t('database.msg.tunnelDisconnected'))
    hooks.afterDisconnect()
  }

  let unsubSessionLost: (() => void) | null = null
  onMounted(() => {
    unsubSessionLost = window.LiteConnect.onDbSessionLost?.(handleSessionLost) ?? null
  })
  onBeforeUnmount(() => {
    unsubSessionLost?.()
    unsubSessionLost = null
  })

  return {
    connections,
    sshConnections,
    groups,
    loading,
    showForm,
    saving,
    testing,
    testHint,
    connectingId,
    connectingIds,
    isConnecting,
    editingId,
    form,
    liveSessions: liveSessions as Ref<Record<string, DbSessionInfo>>,
    activeConnectionId,
    session,
    liveSessionCount,
    loadConnections,
    resetForm,
    openCreate,
    openEdit,
    closeForm,
    saveForm,
    testForm,
    removeConnection,
    exportConnections,
    importConnections,
    connect,
    disconnectConnection,
    disconnectSession,
    disconnectAllSessions,
    getLiveSession,
    patchLiveSession,
    focusConnection,
    isConnActive,
    isConnFocused,
    engineOf,
    dialectOf,
    engineLabel,
  }
}
