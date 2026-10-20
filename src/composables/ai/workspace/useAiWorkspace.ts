import { useAiWorkspaceHosts } from './useAiWorkspaceHosts'
import { useAiWorkspaceRail } from './useAiWorkspaceRail'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Connection, Group } from '@shared/types/connection'
import { AI_WORKSPACE_MAX_HOSTS, type AiWorkspaceScope, type AiWorkspaceTarget, type AiWorkspaceConnectionEvent } from '@shared/aiWorkspace'
import type { AiWorkspaceConversationItem } from '@shared/aiWorkspaceConversations'
import { AI_WORKSPACE_HISTORY_LIMIT } from '@shared/aiWorkspaceConversations'
import { isSshHostKeyConfirmationRequired } from '@shared/sshHostKeyConfirmation'
import { isSshConnectionCancelled } from '@shared/sshConnectionProgress'
import { disposeAiSessionState, useAiChat } from '@/composables/ai/useAiChat'
import { appConfirm } from '@/composables/app/useAppDialog'
import { ElMessage } from 'element-plus/es/components/message/index'
import { sshConnectFailureKey } from '@/utils/session/sshDisconnectReason'

/** Owns workspace connection leases, conversation selection and UI lifecycle. */
export function useAiWorkspace(options: { active: () => boolean }) {
  const { t } = useI18n()
  function connectionFailure(failure: unknown, connectionId: string) {
    const raw = failure instanceof Error ? failure.message : String(failure || '')
    const key = sshConnectFailureKey(raw)
    const reason = key ? t(key) : raw || t('terminal.connectFailureHint')
    const host = connections.value.find(item => item.id === connectionId)
    return host ? t('terminal.connectFailedWithTarget', { name: host.name, host: host.host, reason }) : reason
  }
  const { getSessionState, switchConversation, loadHistory, startNewConversation, onReplyComplete, stopGeneration } = useAiChat()
  const connections = ref<Connection[]>([])
  const groups = ref<Group[]>([])
  const recent = ref<AiWorkspaceConversationItem[]>([])
  const selectedId = ref('')
  const connectingId = ref('')
  const sessions = ref<Record<string, string>>({})
  const scopes = ref<Record<string, AiWorkspaceScope>>({})
  const selectedScopeId = ref('')
  const scopeBusy = ref(false)
  const conversationBusy = ref(false)
  const pickerError = ref('')
  const singleChatIds = ref<string[]>([])
  const activeScope = computed(() => scopes.value[selectedScopeId.value])
  const scopeTargets = computed<AiWorkspaceTarget[] | undefined>(() => activeScope.value?.connectionIds.map(connectionId => {
    const host = connections.value.find(item => item.id === connectionId)
    return { connectionId, sessionId: host ? sessions.value[connectionId] || '' : '', name: host?.name || t('ai.workspace.deletedHost'), host: host?.host || '', port: host?.port || 22, username: host?.username || '', note: host?.note, group: host ? groupName(host) : undefined }
  }))
  const scopeReady = computed(() => !!scopeTargets.value?.length && scopeTargets.value.every(target => !!target.sessionId))
  const scopeLabel = (scope: AiWorkspaceScope) => scope.connectionIds.map(id => connections.value.find(host => host.id === id)?.name || t('ai.workspace.deletedHost')).join('、')
  const error = ref('')
  const loading = ref(false)
  const closing = ref(false)
  const showSchedules = ref(false)
  const HISTORY_PREVIEW_COUNT = 5
  const historyExpanded = ref(false)
  const historyList = ref<HTMLElement | null>(null)
  const browsing = ref(true)
  const { workspaceElement, railCollapsed } = useAiWorkspaceRail(() => !browsing.value && !showSchedules.value)
  const scheduleCreateToken = ref(0)
  const pendingThreadId = ref('')
  const pendingNewConversation = ref(false)
  const sessionTick = ref(0)
  let disposed = false
  let refreshVersion = 0
  let recentVersion = 0
  let unsubscribe: (() => void) | undefined
  let unsubscribeReply: (() => void) | undefined

  const selectionLocked = computed(() => scopeBusy.value || conversationBusy.value || !!connectingId.value || closing.value)
  const hosts = useAiWorkspaceHosts({ connections, groups, sessions, selectionLocked,
    selectedId: () => selectedId.value, browsing: () => browsing.value,
    scoped: () => !!selectedScopeId.value, scopeBusy: () => scopeBusy.value })
  const { query, pickerSelection, browserSelection, browserSelectionHosts,
    hostView, hostFilter, hostPicker, pickerQuery, pickerElement,
    visible, pickerHosts, groupedHosts, pickerGroups, allResultsSelected, canSelectResults,
    toggleBrowserHost, toggleResults, resetFilters, groupName,
    isCollapsed, toggleGroup, isPickerGroupCollapsed, togglePickerGroup,
    closeHostPicker, trapPickerFocus } = hosts

  const selected = computed(() => connections.value.find(connection => connection.id === selectedId.value))
  const sessionId = computed(() => selectedScopeId.value || sessions.value[selectedId.value] || '')
  const connectedCount = computed(() => Object.keys(sessions.value).length)
  const currentConversations = computed(() => {
    void sessionTick.value
    return Object.entries(sessions.value).flatMap(([connectionId, id]) => {
      const connection = connections.value.find(item => item.id === connectionId)
      if (!connection || !singleChatIds.value.includes(connectionId)) return []
      const active = recent.value.find(item => item.connectionId === connectionId && item.active)
      const state = getSessionState(id)
      const summary = state.threads.find(thread => thread.id === state.activeThreadId)
      const title = summary?.customTitle || summary?.title || active?.title || t('ai.workspace.openChat')
      return [{
        connectionId,
        connected: true,
        sessionId: id,
        hostLabel: connection.name,
        hostCount: 1,
        threadId: state.activeThreadId || active?.threadId || '',
        title,
        updatedAt: summary?.updatedAt || active?.updatedAt || Date.now(),
        viewing: !browsing.value && selectedId.value === connectionId,
      }]
    }).concat(Object.values(scopes.value).map(scope => {
      const state = getSessionState(scope.id)
      const summary = state.threads.find(thread => thread.id === state.activeThreadId)
      return {
        hostCount: scope.connectionIds.length, connected: scope.connectionIds.every(id => !!sessions.value[id]), connectionId: scope.id, sessionId: scope.id, hostLabel: scopeLabel(scope), threadId: state.activeThreadId,
        title: summary?.customTitle || summary?.title || t('ai.workspace.openChat'), updatedAt: summary?.updatedAt || scope.createdAt,
        viewing: !browsing.value && selectedScopeId.value === scope.id
      }
    })).sort((a, b) => Number(b.viewing) - Number(a.viewing) || b.updatedAt - a.updatedAt)
  })
  const historyConversations = computed(() => {
    const open = new Set(currentConversations.value.map(item => `${item.connectionId}:${item.threadId}`))
    return recent.value
      .filter(item => !open.has(`${item.connectionId}:${item.threadId}`))
  })
  const displayedHistory = computed(() => historyExpanded.value
    ? historyConversations.value
    : historyConversations.value.slice(0, HISTORY_PREVIEW_COUNT))
  const historySections = computed(() => {
    const sections = new Map<string, AiWorkspaceConversationItem[]>()
    const today = new Date().toDateString()
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    for (const item of displayedHistory.value) {
      const date = new Date(item.updatedAt)
      const label = date.toDateString() === today ? t('ai.today')
        : date.toDateString() === yesterday.toDateString() ? t('ai.workspace.yesterday')
          : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      const items = sections.get(label) || []
      items.push(item)
      sections.set(label, items)
    }
    return Array.from(sections, ([label, items]) => ({ label, items }))
  })

  function toggleHistory() {
    historyExpanded.value = !historyExpanded.value
    void nextTick(() => { if (historyList.value) historyList.value.scrollTop = 0 })
  }

  async function refreshRecent() {
    if (disposed) return
    const version = ++recentVersion
    try {
      const items = await window.LiteConnect.aiListWorkspaceConversations(
        connections.value.map(connection => ({ id: connection.id, name: connection.name, host: connection.host, port: connection.port || 22 })),
        AI_WORKSPACE_HISTORY_LIMIT * 3,
      )
      if (!disposed && version === recentVersion) recent.value = items
    } catch { /* Browse still works without the conversation index. */ }
  }

  async function refresh() {
    if (disposed) return
    const version = ++refreshVersion
    // An index requested for an older host list must not repopulate the rail.
    recentVersion++
    loading.value = true
    try {
      const [hosts, hostGroups] = await Promise.all([window.LiteConnect.getConnections(), window.LiteConnect.getGroups()])
      if (disposed || version !== refreshVersion) return
      connections.value = hosts
      groups.value = hostGroups
      error.value = ''
      await refreshRecent()
    } catch (failure: any) {
      if (!disposed && version === refreshVersion) error.value = failure?.message || t('ai.workspace.loadFailed')
    } finally {
      if (!disposed && version === refreshVersion) loading.value = false
    }
  }

  async function applyPendingActions(id: string) {
    const threadId = pendingThreadId.value
    const wantNew = pendingNewConversation.value
    pendingThreadId.value = ''
    pendingNewConversation.value = false
    if (!wantNew && !threadId) return
    const current = () => !disposed && sessions.value[selectedId.value] === id
    conversationBusy.value = true
    try {
      await loadHistory(id)
      if (!current()) return
      if (wantNew) await startNewConversation(id, () => { })
      else await switchConversation(id, threadId, () => { })
      if (!current()) return
      sessionTick.value += 1
      await refreshRecent()
    } catch (failure: any) {
      if (current()) error.value = failure?.message || t('ai.workspace.loadFailed')
    } finally {
      conversationBusy.value = false
    }
  }

  function openHostPicker(mode: 'switch' | 'new' | 'create', initialIds?: string[]) {
    if (selectionLocked.value) return
    pickerError.value = ''
    hosts.openHostPicker(mode, initialIds)
  }

  async function pickHost(connection: Connection) {
    const mode = hostPicker.value
    if (!mode || selectionLocked.value) return
    if (mode === 'create' || mode === 'new') {
      const ids = pickerSelection.value
      pickerSelection.value = ids.includes(connection.id) ? ids.filter(id => id !== connection.id)
        : ids.length < AI_WORKSPACE_MAX_HOSTS ? [...ids, connection.id] : ids
      return
    }
    closeHostPicker()
    if (mode === 'switch') {
      if (connection.id === selectedId.value && sessions.value[connection.id]) {
        browsing.value = false
        return
      }
      await startChat(connection)
      return
    }
  }

  async function openScope(input: { connectionIds?: string[]; id?: string }, threadId = '') {
    if (selectionLocked.value) return
    // Snapshot reactive picker data before awaits; Vue proxies cannot cross Electron IPC.
    const request: { connectionIds?: string[]; id?: string } = input.id
      ? { id: input.id }
      : { connectionIds: [...(input.connectionIds || [])] }
    const ids = [...(request.connectionIds || recent.value.find(item => item.workspaceId === request.id)?.connectionIds || scopes.value[request.id || '']?.connectionIds || [])]
    if (!ids.length) return
    let waitingForTrust = false
    scopeBusy.value = true
    pickerError.value = ''
    try {
      for (const id of ids) {
        if (!connections.value.some(host => host.id === id)) throw new Error(t('ai.workspace.deletedHost'))
        if (sessions.value[id]) continue
        connectingId.value = id
        const session = await window.LiteConnect.aiOpenWorkspaceConnection(id)
        if (disposed) return
        setSession(id, session)
        connectingId.value = ''
      }
      const scope = await window.LiteConnect.aiOpenWorkspaceScope(request)
      if (disposed) return
      scopes.value = { ...scopes.value, [scope.id]: scope }
      selectedScopeId.value = scope.id
      selectedId.value = ''
      browsing.value = false
      showSchedules.value = false
      error.value = ''
      await loadHistory(scope.id)
      if (threadId) await switchConversation(scope.id, threadId, () => { })
      sessionTick.value += 1
      scopeBusy.value = false
      closeHostPicker()
      await refreshRecent()
    } catch (failure: any) {
      if (!isSshHostKeyConfirmationRequired(failure) && !isSshConnectionCancelled(failure)) {
        pickerError.value = connectionFailure(failure, connectingId.value)
        error.value = pickerError.value
      } else {
        waitingForTrust = isSshHostKeyConfirmationRequired(failure)
        pickerError.value = t('ai.workspace.scopeTrustHint')
      }
    } finally {
      if (!waitingForTrust) connectingId.value = ''
      scopeBusy.value = false
    }
  }

  async function closeCurrentConversation() {
    if (!sessionId.value) return
    await closeConversation({ sessionId: sessionId.value, connectionId: activeScope.value?.id || selectedId.value })
  }

  async function closeConversation(item: { sessionId: string; connectionId: string }) {
    if (selectionLocked.value) return
    const scope = scopes.value[item.sessionId]
    if (!scope && (!singleChatIds.value.includes(item.connectionId) || sessions.value[item.connectionId] !== item.sessionId)) return
    const state = getSessionState(item.sessionId)
    if (state.loading) { ElMessage.warning(t('ai.workspace.scopeBusyHint')); return }
    closing.value = true
    try {
      await window.LiteConnect.aiSuppressBackgroundReplies(item.sessionId, state.activeThreadId)
      if (disposed) return
      if (scope) {
        const next = { ...scopes.value }
        delete next[scope.id]
        scopes.value = next
        if (selectedScopeId.value === scope.id) {
          selectedScopeId.value = ''
          browsing.value = true
        }
      } else {
        singleChatIds.value = singleChatIds.value.filter(id => id !== item.connectionId)
        if (!selectedScopeId.value && selectedId.value === item.connectionId) {
          selectedId.value = ''
          browsing.value = true
        }
      }
      await refreshRecent()
    } catch { ElMessage.warning(t('ai.workspace.closeFailed')) }
    finally { closing.value = false }
  }

  function setSession(connectionId: string, id: string) {
    sessions.value = { ...sessions.value, [connectionId]: id }
    sessionTick.value += 1
  }

  function clearSession(connectionId: string) {
    singleChatIds.value = singleChatIds.value.filter(id => id !== connectionId)
    if (!(connectionId in sessions.value)) return
    const next = { ...sessions.value }
    delete next[connectionId]
    sessions.value = next
    sessionTick.value += 1
  }

  function onConnection(event: AiWorkspaceConnectionEvent) {
    if (disposed) return
    if (event.status === 'connected' && event.sessionId) {
      setSession(event.connectionId, event.sessionId)
      if (connectingId.value === event.connectionId) connectingId.value = ''
      if (selectedId.value === event.connectionId) {
        error.value = ''
        browsing.value = false
        return applyPendingActions(event.sessionId)
      }
    } else {
      const previous = sessions.value[event.connectionId]
      // A delayed close/cancel from an earlier attempt cannot clear a new lease.
      if (previous && (event.status === 'cancelled' || (event.sessionId && event.sessionId !== previous))) return
      if (previous) void nextTick(() => disposeAiSessionState(previous))
      clearSession(event.connectionId)
      if (connectingId.value === event.connectionId) connectingId.value = ''
      if (selectedId.value === event.connectionId) {
        pendingThreadId.value = ''
        pendingNewConversation.value = false
        const fallbackId = Object.keys(sessions.value).find(id => singleChatIds.value.includes(id))
        if (fallbackId) {
          selectedId.value = fallbackId
          browsing.value = false
          error.value = ''
        } else {
          browsing.value = true
        }
      }
      void refreshRecent()
    }
  }

  async function startChat(connection = selected.value, threadId = '', forceNew = false) {
    if (!connection || selectionLocked.value) return
    showSchedules.value = false
    selectedScopeId.value = ''
    singleChatIds.value = [...new Set([...singleChatIds.value, connection.id])]
    selectedId.value = connection.id
    browsing.value = false
    error.value = ''
    pendingThreadId.value = threadId
    pendingNewConversation.value = forceNew
    if (sessions.value[connection.id]) {
      await applyPendingActions(sessions.value[connection.id])
      return
    }
    connectingId.value = connection.id
    let waitingForTrust = false
    try {
      const id = await window.LiteConnect.aiOpenWorkspaceConnection(connection.id)
      if (!disposed) await onConnection({ connectionId: connection.id, sessionId: id, status: 'connected' })
    } catch (failure: any) {
      if (isSshHostKeyConfirmationRequired(failure)) waitingForTrust = true
      else if (!isSshConnectionCancelled(failure)) error.value = connectionFailure(failure, connection.id)
      else {
        pendingThreadId.value = ''
        pendingNewConversation.value = false
        if (!sessions.value[connection.id]) browsing.value = true
      }
    } finally {
      if (!waitingForTrust && connectingId.value === connection.id) connectingId.value = ''
    }
  }

  function retryConnect() {
    return startChat(selected.value, pendingThreadId.value, pendingNewConversation.value)
  }

  async function openCurrent(item: { connectionId: string; sessionId: string }) {
    if (selectionLocked.value) return
    if (scopes.value[item.sessionId]) {
      selectedScopeId.value = item.sessionId
      selectedId.value = ''
      browsing.value = false
      showSchedules.value = false
      return
    }
    selectedScopeId.value = ''
    const connection = connections.value.find(entry => entry.id === item.connectionId)
    if (!connection) return
    selectedId.value = connection.id
    browsing.value = false
    showSchedules.value = false
  }

  async function openHistory(item: AiWorkspaceConversationItem) {
    if (selectionLocked.value) return
    if (item.workspaceId) { await openScope({ id: item.workspaceId }, item.threadId); return }
    const connection = connections.value.find(entry => entry.id === item.connectionId)
    if (!connection) { ElMessage.warning(t('ai.workspace.deletedHost')); return }
    await startChat(connection, item.threadId)
  }

  async function cancelConnect() {
    const id = connectingId.value
    if (!id) return
    pendingThreadId.value = ''
    pendingNewConversation.value = false
    try { await window.LiteConnect.aiCancelWorkspaceConnection(id) }
    catch (failure: any) { ElMessage.warning(failure?.message || t('ai.workspace.connectFailed')) }
  }

  async function disconnect() {
    if (selectionLocked.value) return
    const connectionIds = activeScope.value?.connectionIds || [selectedId.value]
    const targets = connectionIds.flatMap(connectionId => {
      const id = sessions.value[connectionId]
      return id ? [{ connectionId, sessionId: id, name: connections.value.find(host => host.id === connectionId)?.name || connectionId }] : []
    })
    if (!targets.length) return
    closing.value = true
    try {
      try {
        await appConfirm({
          title: t('ai.workspace.disconnectSshTitle'),
          message: t('ai.workspace.disconnectSshMessage', { count: targets.length, hosts: targets.map(target => target.name).join('、') }),
          detail: t('ai.workspace.disconnectSshDetail'),
          confirmText: t('ai.workspace.disconnectSsh'), cancelText: t('common.cancel'), danger: true, tone: 'warning',
        })
      } catch { return }
      if (disposed) return
      const affected = new Set(targets.map(target => target.connectionId))
      const conversations = [...targets.map(target => target.sessionId), ...Object.values(scopes.value)
        .filter(scope => scope.connectionIds.some(id => affected.has(id))).map(scope => scope.id)]
      // Shared AI connections can serve several conversations. Stop their replies
      // and suppress completion delivery before tearing down the actual channels.
      for (const id of new Set(conversations)) {
        const state = getSessionState(id)
        if (state.loading) await stopGeneration(id)
        if (state.activeThreadId) await window.LiteConnect.aiSuppressBackgroundReplies(id, state.activeThreadId)
      }
      const results = await Promise.allSettled(targets.map(async target => {
        if (disposed || sessions.value[target.connectionId] !== target.sessionId) return
        await window.LiteConnect.aiCloseWorkspaceConnection(target.sessionId)
        if (!disposed) onConnection({ ...target, status: 'closed' })
      }))
      if (results.some(result => result.status === 'rejected')) ElMessage.warning(t('ai.workspace.disconnectSshFailed'))
    } catch (failure: any) { ElMessage.warning(failure?.message || t('ai.workspace.disconnectSshFailed')) }
    finally { closing.value = false }
  }

  function openSchedules(create = false) {
    closeHostPicker()
    showSchedules.value = true
    if (create) scheduleCreateToken.value += 1
  }

  function backToHosts() {
    browsing.value = true
    showSchedules.value = false
    sessionTick.value += 1
    void refreshRecent()
  }

  function refreshWhenActive() {
    if (options.active() && !loading.value && !disposed) void refresh()
  }

  watch(browsing, value => { if (value) void refreshRecent() })
  watch(() => options.active(), active => { if (active) void refresh() })


  onMounted(() => {
    window.addEventListener('focus', refreshWhenActive)
    window.addEventListener('connections-store-change', refreshWhenActive)
    unsubscribe = window.LiteConnect.onAiWorkspaceConnection(onConnection)
    unsubscribeReply = onReplyComplete(() => {
      sessionTick.value += 1
      void refreshRecent()
    })
    void refresh()
  })
  onBeforeUnmount(() => {
    disposed = true
    window.removeEventListener('focus', refreshWhenActive)
    window.removeEventListener('connections-store-change', refreshWhenActive)
    unsubscribe?.()
    unsubscribeReply?.()
    if (connectingId.value) void window.LiteConnect.aiCancelWorkspaceConnection(connectingId.value).catch(() => { })
    for (const scope of Object.values(scopes.value)) void nextTick(() => disposeAiSessionState(scope.id))
    for (const id of Object.values(sessions.value)) {
      void nextTick(() => disposeAiSessionState(id))
      void window.LiteConnect.aiCloseWorkspaceConnection(id).catch(() => { })
    }
  })

  return {
    workspaceElement,
    connections,
    query,
    selectedId,
    connectingId,
    sessions,
    pickerSelection,
    browserSelection,
    browserSelectionHosts,
    scopeBusy,
    pickerError,
    activeScope,
    scopeTargets,
    scopeReady,
    error,
    loading,
    closing,
    showSchedules,
    railCollapsed,
    HISTORY_PREVIEW_COUNT,
    historyExpanded,
    historyList,
    hostView,
    hostFilter,
    browsing,
    scheduleCreateToken,
    hostPicker,
    pickerQuery,
    pickerElement,
    selected,
    sessionId,
    connectedCount,
    visible,
    pickerHosts,
    groupedHosts,
    pickerGroups,
    allResultsSelected,
    selectionLocked,
    canSelectResults,
    toggleBrowserHost,
    toggleResults,
    currentConversations,
    historyConversations,
    historySections,
    toggleHistory,
    resetFilters,
    isCollapsed,
    toggleGroup,
    isPickerGroupCollapsed,
    togglePickerGroup,
    refresh,
    refreshRecent,
    openHostPicker,
    closeHostPicker,
    trapPickerFocus,
    pickHost,
    openScope,
    closeCurrentConversation,
    closeConversation,
    startChat,
    retryConnect,
    openCurrent,
    openHistory,
    cancelConnect,
    disconnect,
    openSchedules,
    backToHosts
  }
}
