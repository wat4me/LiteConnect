import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { Connection } from '../env.d'
import { t } from '../i18n'
import type { TerminalPwdTracker } from './useTerminalPwd'
import { clearAutoReconnectAttempts } from './useAutoReconnectBudget'

export const HOME_ID = '__home__'

export interface Session {
  id: string
  connectionId: string
  connectionName: string
  tabNumber: number
}

export interface ConnectionGroup {
  connectionId: string
  connectionName: string
  sessions: Session[]
  activeSessionId: string | null
  nextTabNumber: number
}

export interface SidebarDeps {
  sidebarVisible: Ref<boolean>
  aiSidebarVisible: Ref<boolean>
  sidebarGroupId: Ref<string | null>
  sidebarSessionId: Ref<string | null>
  fileSidebarRef: Ref<any>
  setSidebarTarget: (groupId: string | null, sessionId: string | null) => void
  syncSidebarState: () => void
}

export function useSessionManager(deps: { pwdTracker: TerminalPwdTracker }) {
  const connections = ref<Connection[]>([])
  const recentConnections = ref<Connection[]>([])
  const groups = ref<ConnectionGroup[]>([])
  const activeGroupId = ref<string>(HOME_ID)

  let sidebar: SidebarDeps | null = null

  function connectSidebar(s: SidebarDeps) {
    sidebar = s
  }

  function requireSidebar(): SidebarDeps {
    if (!sidebar) {
      throw new Error('Sidebar deps not connected. Call connectSidebar() before using session operations.')
    }
    return sidebar
  }

  const isHomeActive = computed(() => activeGroupId.value === HOME_ID)

  const activeGroup = computed(() => {
    if (isHomeActive.value) return null
    return groups.value.find((g) => g.connectionId === activeGroupId.value) || null
  })

  const activeSessionId = computed(() => activeGroup.value?.activeSessionId || null)

  const activeSession = computed(() => {
    if (!activeGroup.value?.activeSessionId) return null
    return (
      activeGroup.value.sessions.find((s) => s.id === activeGroup.value!.activeSessionId) || null
    )
  })

  function getLastSessionId(group: ConnectionGroup | null): string | null {
    if (!group || group.sessions.length === 0) return null
    return group.sessions[group.sessions.length - 1].id
  }

  function getGroupByConnectionId(connectionId: string | null): ConnectionGroup | null {
    if (!connectionId) return null
    return groups.value.find((g) => g.connectionId === connectionId) || null
  }

  function getGroupBySessionId(sessionId: string): ConnectionGroup | null {
    return (
      groups.value.find((g) => g.sessions.some((s) => s.id === sessionId)) || null
    )
  }

  async function loadConnections() {
    connections.value = await window.LiteConnect.getConnections()
  }

  async function loadRecentConnections() {
    recentConnections.value = await window.LiteConnect.getRecentConnections()
  }

  function hydrateConnectionData(data: { connections: Connection[]; recentConnections: Connection[] }) {
    connections.value = [...data.connections]
    recentConnections.value = [...data.recentConnections]
  }

  async function initSessionPwd(sessionId: string) {
    try {
      const home = (await window.LiteConnect.sftpExecHome(sessionId)).trim()
      if (home) {
        deps.pwdTracker.initSession(sessionId, home)
      }
    } catch (err) {
      console.warn('[PWD] Failed to initialize session home:', err)
    }
  }

  /**
   * Serialize connects per connectionId so concurrent multi-tab reconnects
   * each get their own session (instead of silently dropping the second call).
   * Double-click still creates two tabs — intentional multi-session UX.
   */
  const connectTail = new Map<string, Promise<void>>()

  async function createSession(connectionId: string) {
    const prev = connectTail.get(connectionId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const chained = prev.catch(() => {}).then(() => gate)
    connectTail.set(connectionId, chained)

    await prev.catch(() => {})
    try {
      let conn = connections.value.find((c) => c.id === connectionId)
      if (!conn) {
        await loadConnections()
        conn = connections.value.find((c) => c.id === connectionId)
      }
      if (!conn) return

      const sessionId = await window.LiteConnect.sshConnect(connectionId)
      // 真正连上后清零自动重试计数
      clearAutoReconnectAttempts(connectionId)
      void initSessionPwd(sessionId)
      conn = connections.value.find((c) => c.id === connectionId) || conn
      let group = groups.value.find((g) => g.connectionId === connectionId)

      // Defensive: skip if this session id is already listed (should not happen after
      // main-process stopped sharing in-flight connect promises).
      if (group?.sessions.some((s) => s.id === sessionId)) {
        group.activeSessionId = sessionId
        activeGroupId.value = connectionId
        return
      }

      const session: Session = {
        id: sessionId,
        connectionId,
        connectionName: conn.name,
        tabNumber: 0,
      }

      if (group) {
        session.tabNumber = group.nextTabNumber++
        group.sessions.push(session)
        group.activeSessionId = sessionId
      } else {
        session.tabNumber = 1
        group = {
          connectionId,
          connectionName: conn.name,
          sessions: [session],
          activeSessionId: sessionId,
          nextTabNumber: 2,
        }
        groups.value.push(group)
      }

      activeGroupId.value = connectionId
      const sb = requireSidebar()
      sb.setSidebarTarget(connectionId, sessionId)
      sb.aiSidebarVisible.value = false
      sb.sidebarVisible.value = true
      await window.LiteConnect.recordRecentConnection(connectionId)
      await loadRecentConnections()
    } catch (err: any) {
      console.error('SSH connection failed:', err)
      ElMessage.error(err.message || t('terminal.connectFailed'))
    } finally {
      release()
      if (connectTail.get(connectionId) === chained) {
        connectTail.delete(connectionId)
      }
    }
  }

  function onConnect(connectionId: string) {
    return createSession(connectionId)
  }

  function syncConnectionName(connection: Connection) {
    connections.value = connections.value.map((item) =>
      item.id === connection.id ? { ...item, ...connection } : item,
    )
    recentConnections.value = recentConnections.value.map((item) =>
      item.id === connection.id ? { ...item, ...connection } : item,
    )

    const group = groups.value.find((item) => item.connectionId === connection.id)
    if (!group) return

    group.connectionName = connection.name
    for (const session of group.sessions) {
      session.connectionName = connection.name
    }
  }

  function onSelectGroup(connectionId: string) {
    activeGroupId.value = connectionId
  }

  function onSelectHome() {
    activeGroupId.value = HOME_ID
  }

  function onQuickConnect(connectionId: string) {
    return createSession(connectionId)
  }

  async function onCloseGroup(connectionId: string) {
    const group = getGroupByConnectionId(connectionId)
    if (!group) return

    const sessionIds = group.sessions.map((s) => s.id)
    for (const sessionId of sessionIds) {
      try {
        await window.LiteConnect.sshDisconnect(sessionId)
      } catch {}
    }

    const idx = groups.value.findIndex((g) => g.connectionId === connectionId)
    if (idx !== -1) groups.value.splice(idx, 1)

    const sb = requireSidebar()
    if (sb.sidebarGroupId.value === connectionId) {
      sb.setSidebarTarget(null, null)
    }

    if (activeGroupId.value === connectionId) {
      activeGroupId.value = groups.value.length > 0 ? groups.value[0].connectionId : HOME_ID
    }

    sb.syncSidebarState()
  }

  function removeSessionFromState(sessionId: string) {
    const group = getGroupBySessionId(sessionId)
    if (!group) return

    const idx = group.sessions.findIndex((s) => s.id === sessionId)
    if (idx === -1) return

    group.sessions.splice(idx, 1)
    deps.pwdTracker.removeSession(sessionId)
    const sb = requireSidebar()
    sb.fileSidebarRef.value?.clearSessionState(sessionId)

    if (group.activeSessionId === sessionId) {
      group.activeSessionId = getLastSessionId(group)
    }

    if (
      sb.sidebarGroupId.value === group.connectionId &&
      sb.sidebarSessionId.value === sessionId
    ) {
      sb.sidebarSessionId.value =
        group.activeSessionId || getLastSessionId(group)
    }

    if (group.sessions.length === 0) {
      const groupIdx = groups.value.findIndex(
        (item) => item.connectionId === group.connectionId,
      )
      if (groupIdx !== -1) groups.value.splice(groupIdx, 1)

      if (sb.sidebarGroupId.value === group.connectionId) {
        sb.setSidebarTarget(null, null)
      }

      if (activeGroupId.value === group.connectionId) {
        activeGroupId.value =
          groups.value.length > 0 ? groups.value[0].connectionId : HOME_ID
      }
    }

    sb.syncSidebarState()
  }

  async function onCloseSession(sessionId: string) {
    const group = getGroupBySessionId(sessionId)
    if (group) clearAutoReconnectAttempts(group.connectionId)
    await window.LiteConnect.sshDisconnect(sessionId)
    removeSessionFromState(sessionId)
  }

  function onSessionClosed(sessionId: string) {
    removeSessionFromState(sessionId)
  }

  function onSelectSession(sessionId: string) {
    if (!activeGroup.value) return
    activeGroup.value.activeSessionId = sessionId
    requireSidebar().setSidebarTarget(activeGroup.value.connectionId, sessionId)
  }

  function hasOpenSession(sessionId: string): boolean {
    return groups.value.some((g) => g.sessions.some((s) => s.id === sessionId))
  }

  /**
   * Attach a main-process session that already exists (e.g. after Host Key confirm
   * on first connect). Avoids orphan sessions that never get a TerminalTab.
   */
  async function adoptSession(connectionId: string, sessionId: string) {
    if (!sessionId || hasOpenSession(sessionId)) return

    let conn = connections.value.find((c) => c.id === connectionId)
    if (!conn) {
      await loadConnections()
      conn = connections.value.find((c) => c.id === connectionId)
    }
    if (!conn) return

    clearAutoReconnectAttempts(connectionId)
    void initSessionPwd(sessionId)

    const session: Session = {
      id: sessionId,
      connectionId,
      connectionName: conn.name,
      tabNumber: 0,
    }

    let group = groups.value.find((g) => g.connectionId === connectionId)
    if (group) {
      session.tabNumber = group.nextTabNumber++
      group.sessions.push(session)
      group.activeSessionId = sessionId
    } else {
      session.tabNumber = 1
      group = {
        connectionId,
        connectionName: conn.name,
        sessions: [session],
        activeSessionId: sessionId,
        nextTabNumber: 2,
      }
      groups.value.push(group)
    }

    activeGroupId.value = connectionId
    const sb = requireSidebar()
    sb.setSidebarTarget(connectionId, sessionId)
    sb.aiSidebarVisible.value = false
    sb.sidebarVisible.value = true
    await window.LiteConnect.recordRecentConnection(connectionId)
    await loadRecentConnections()
  }

  return {
    HOME_ID,
    groups,
    connections,
    recentConnections,
    activeGroupId,
    isHomeActive,
    activeGroup,
    activeSessionId,
    activeSession,
    createSession,
    adoptSession,
    hasOpenSession,
    onConnect,
    onCloseGroup,
    onCloseSession,
    removeSessionFromState,
    syncConnectionName,
    onSelectGroup,
    onSelectHome,
    onQuickConnect,
    onSelectSession,
    onSessionClosed,
    loadConnections,
    loadRecentConnections,
    hydrateConnectionData,
    getGroupByConnectionId,
    getGroupBySessionId,
    getLastSessionId,
    connectSidebar,
  }
}
