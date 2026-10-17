import { groupAiWorkspaceHosts } from '@/utils/ai/workspaceHosts'
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

/** Owns workspace connection leases, conversation selection and UI lifecycle. */
export function useAiWorkspace(options: { active: () => boolean }) {
  const { t } = useI18n()
  const { getSessionState, switchConversation, loadHistory, startNewConversation, onReplyComplete } = useAiChat()
  const connections = ref<Connection[]>([])
  const groups = ref<Group[]>([])
  const recent = ref<AiWorkspaceConversationItem[]>([])
  const query = ref('')
  const selectedId = ref('')
  const connectingId = ref('')
  const sessions = ref<Record<string, string>>({})
  const scopes = ref<Record<string, AiWorkspaceScope>>({})
  const selectedScopeId = ref('')
  const pickerSelection = ref<string[]>([])
  const browserSelection = ref<string[]>([])
  const browserSelectionHosts = computed(() => browserSelection.value.flatMap(id => connections.value.find(host => host.id === id) || []))
  const scopeBusy = ref(false)
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
  const railCollapsed = ref(false)
  const HISTORY_PREVIEW_COUNT = 5
  const historyExpanded = ref(false)
  const historyList = ref<HTMLElement | null>(null)
  const hostView = ref<'cards' | 'list'>(readHostView())
  const hostFilter = ref<'all' | 'connected'>('all')
  const browsing = ref(true)
  const scheduleCreateToken = ref(0)
  const collapsedGroups = ref<Record<string, boolean>>({})
  const pendingThreadId = ref('')
  const pendingNewConversation = ref(false)
  const sessionTick = ref(0)
  const hostPicker = ref<'switch' | 'new' | 'create' | null>(null)
  const pickerQuery = ref('')
  const pickerCollapsedGroups = ref<Record<string, boolean>>({})
  const pickerElement = ref<HTMLElement | null>(null)
  let pickerReturnFocus: HTMLElement | null = null
  let disposed = false
  let unsubscribe: (() => void) | undefined
  let unsubscribeReply: (() => void) | undefined

  const selected = computed(() => connections.value.find(connection => connection.id === selectedId.value))
  const sessionId = computed(() => selectedScopeId.value || sessions.value[selectedId.value] || '')
  const connectedCount = computed(() => Object.keys(sessions.value).length)
  const visible = computed(() => {
    const text = query.value.trim().toLocaleLowerCase()
    return connections.value.filter(connection =>
      (hostFilter.value === 'all' || !!sessions.value[connection.id]) &&
      (!text || `${connection.name} ${connection.host} ${connection.username} ${connection.note || ''} ${groupName(connection)}`.toLocaleLowerCase().includes(text)),
    )
  })
  const pickerHosts = computed(() => {
    const text = pickerQuery.value.trim().toLocaleLowerCase()
    return connections.value
      .filter(connection => {
        if (hostPicker.value === 'new' && connection.id === selectedId.value) return false
        if (!text) return true
        return `${connection.name} ${connection.host} ${connection.username} ${connection.note || ''} ${groupName(connection)}`.toLocaleLowerCase().includes(text)
      })
  })
  const groupedHosts = computed(() => groupConnections(visible.value))
  const pickerGroups = computed(() => groupConnections(pickerHosts.value, true))
  const allResultsSelected = computed(() => !!visible.value.length && visible.value.every(host => browserSelection.value.includes(host.id)))
  const selectionLocked = computed(() => scopeBusy.value || !!connectingId.value || closing.value)
  const canSelectResults = computed(() => allResultsSelected.value || new Set([...browserSelection.value, ...visible.value.map(host => host.id)]).size <= AI_WORKSPACE_MAX_HOSTS)

  function toggleBrowserHost(connectionId: string) {
    if (selectionLocked.value) return
    if (browserSelection.value.includes(connectionId)) {
      browserSelection.value = browserSelection.value.filter(id => id !== connectionId)
    } else if (browserSelection.value.length < AI_WORKSPACE_MAX_HOSTS) {
      browserSelection.value = [...browserSelection.value, connectionId]
    } else ElMessage.warning(t('ai.workspace.selectionLimit', { count: AI_WORKSPACE_MAX_HOSTS }))
  }
  function toggleResults() {
    if (selectionLocked.value || !canSelectResults.value) return
    const ids = new Set(visible.value.map(host => host.id))
    browserSelection.value = allResultsSelected.value
      ? browserSelection.value.filter(id => !ids.has(id))
      : [...new Set([...browserSelection.value, ...ids])]
  }


  function groupConnections(hosts: Connection[], connectedFirst = false) {
    return groupAiWorkspaceHosts(hosts, groups.value, { connectedFirst, sessions: sessions.value, unknownGroup: t('ai.workspace.unknownGroup'), ungrouped: t('ai.workspace.ungrouped') })
  }
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

  function readHostView(): 'cards' | 'list' {
    try { return localStorage.getItem('LiteConnect.aiWorkspace.hostView') === 'cards' ? 'cards' : 'list' }
    catch { return 'list' }
  }

  function resetFilters() {
    query.value = ''
    hostFilter.value = 'all'
  }

  function groupName(connection: Connection) {
    return groups.value.find(group => group.id === connection.group)?.name ||
      t(connection.group ? 'ai.workspace.unknownGroup' : 'ai.workspace.ungrouped')
  }
  function groupKey(id: string) { return id || '__ungrouped__' }
  function isCollapsed(id: string) { return !!collapsedGroups.value[groupKey(id)] }
  function toggleGroup(id: string) {
    const key = groupKey(id)
    collapsedGroups.value = { ...collapsedGroups.value, [key]: !collapsedGroups.value[key] }
  }
  function isPickerGroupCollapsed(id: string) {
    return !pickerQuery.value.trim() && !!pickerCollapsedGroups.value[id]
  }
  function togglePickerGroup(id: string) {
    pickerCollapsedGroups.value = { ...pickerCollapsedGroups.value, [id]: !isPickerGroupCollapsed(id) }
  }
  async function refreshRecent() {
    try {
      recent.value = await window.LiteConnect.aiListWorkspaceConversations(
        connections.value.map(connection => ({ id: connection.id, name: connection.name, host: connection.host, port: connection.port || 22 })),
        AI_WORKSPACE_HISTORY_LIMIT * 3,
      )
    } catch { /* Browse still works without the conversation index. */ }
  }

  async function refresh() {
    loading.value = true
    try {
      const [hosts, hostGroups] = await Promise.all([window.LiteConnect.getConnections(), window.LiteConnect.getGroups()])
      if (disposed) return
      connections.value = hosts
      browserSelection.value = browserSelection.value.filter(id => hosts.some(host => host.id === id))
      groups.value = hostGroups
      error.value = ''
      await refreshRecent()
    } catch (failure: any) { error.value = failure?.message || t('ai.workspace.loadFailed') }
    finally { loading.value = false }
  }

  async function applyPendingActions(id: string) {
    const threadId = pendingThreadId.value
    const wantNew = pendingNewConversation.value
    pendingThreadId.value = ''
    pendingNewConversation.value = false
    if (wantNew) {
      await loadHistory(id)
      await startNewConversation(id, () => { })
      sessionTick.value += 1
      await refreshRecent()
      return
    }
    if (!threadId) return
    await loadHistory(id)
    await switchConversation(id, threadId, () => { })
    await refreshRecent()
  }

  function openHostPicker(mode: 'switch' | 'new' | 'create', initialIds?: string[]) {
    if (connectingId.value || closing.value || scopeBusy.value) return
    pickerSelection.value = [...(initialIds || (browsing.value ? browserSelection.value : []))]
    pickerError.value = ''
    if (selectedScopeId.value && mode === 'new') mode = 'create'
    pickerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    pickerQuery.value = ''
    pickerCollapsedGroups.value = {}
    hostPicker.value = mode
    void nextTick(() => pickerElement.value?.querySelector<HTMLInputElement>('input')?.focus())
  }

  function closeHostPicker() {
    if (scopeBusy.value) return
    hostPicker.value = null
    pickerQuery.value = ''
    const target = pickerReturnFocus
    pickerReturnFocus = null
    void nextTick(() => { if (target?.isConnected) target.focus() })
  }

  function trapPickerFocus(event: KeyboardEvent) {
    const controls = Array.from(pickerElement.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input') || [])
      .filter(element => element.getClientRects().length > 0)
    if (!controls?.length) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function pickHost(connection: Connection) {
    const mode = hostPicker.value
    if (!mode || connectingId.value || closing.value) return
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
    if (scopeBusy.value || connectingId.value || closing.value) return
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
        pickerError.value = failure?.message || t('ai.workspace.connectFailed')
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

  async function closeScope() {
    const scope = activeScope.value
    if (!scope) return
    await closeConversation({ sessionId: scope.id, connectionId: scope.id })
  }

  async function closeConversation(item: { sessionId: string; connectionId: string }) {
    if (closing.value || scopeBusy.value || connectingId.value) return
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
        void applyPendingActions(event.sessionId)
      }
    } else {
      const previous = sessions.value[event.connectionId]
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
    if (!connection || connectingId.value || closing.value) return
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
      if (!disposed) onConnection({ connectionId: connection.id, sessionId: id, status: 'connected' })
    } catch (failure: any) {
      pendingThreadId.value = ''
      pendingNewConversation.value = false
      if (isSshHostKeyConfirmationRequired(failure)) waitingForTrust = true
      else if (!isSshConnectionCancelled(failure)) error.value = failure?.message || t('ai.workspace.connectFailed')
      else if (!sessions.value[connection.id]) browsing.value = true
    } finally {
      if (!waitingForTrust && connectingId.value === connection.id) connectingId.value = ''
    }
  }

  async function openCurrent(item: { connectionId: string; sessionId: string }) {
    if (closing.value) return
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

  async function disconnect(connectionId = selectedId.value) {
    const id = sessions.value[connectionId]
    if (!id || closing.value) return
    selectedId.value = connectionId
    closing.value = true
    try {
      const jobs = await window.LiteConnect.mcpListJobs()
      const state = getSessionState(id)
      if (state.loading || jobs.some(job => job.sessionId === id && job.status === 'running')) {
        try {
          await appConfirm({
            title: t('ai.workspace.disconnectTitle'), message: t('ai.workspace.disconnectMessage'),
            confirmText: t('ai.workspace.disconnect'), cancelText: t('common.cancel'), danger: true, tone: 'warning'
          })
        } catch { return }
      }
      await window.LiteConnect.aiCloseWorkspaceConnection(id)
      onConnection({ connectionId, sessionId: id, status: 'closed' })
    } catch (failure: any) { ElMessage.warning(failure?.message || t('ai.workspace.connectFailed')) }
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
  watch(hostView, value => {
    try { localStorage.setItem('LiteConnect.aiWorkspace.hostView', value) }
    catch { /* Browsing works when local storage is unavailable. */ }
  })

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
    openHostPicker,
    closeHostPicker,
    trapPickerFocus,
    pickHost,
    openScope,
    closeScope,
    closeConversation,
    startChat,
    openCurrent,
    openHistory,
    cancelConnect,
    disconnect,
    openSchedules,
    backToHosts
  }
}
