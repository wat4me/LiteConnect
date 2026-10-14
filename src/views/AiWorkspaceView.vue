<script setup lang="ts">
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
import AiSidebar from '@/components/ai/AiSidebar.vue'
import AiSchedulePanel from '@/components/ai/AiSchedulePanel.vue'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const emit = defineEmits<{ (event: 'open-connections'): void }>()
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


function groupConnections(hostsToGroup: Connection[], connectedFirst = false) {
  const sections: { id: string; name: string; hosts: Connection[] }[] = []
  const byGroup = new Map<string, Connection[]>()
  const compareHosts = (a: Connection, b: Connection) =>
    Number(b.pinned === true) - Number(a.pinned === true) ||
    (connectedFirst ? Number(!!sessions.value[b.id]) - Number(!!sessions.value[a.id]) : 0) ||
    (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'zh-CN')
  for (const connection of hostsToGroup) {
    const id = connection.group || ''
    const list = byGroup.get(id) || []
    list.push(connection)
    byGroup.set(id, list)
  }
  const ordered = [...groups.value].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'))
  for (const group of ordered) {
    const hosts = byGroup.get(group.id)
    if (!hosts?.length) continue
    sections.push({ id: group.id, name: group.name, hosts: hosts.sort(compareHosts) })
    byGroup.delete(group.id)
  }
  for (const [id, hosts] of byGroup) {
    sections.push({
      id: id || '__ungrouped__',
      name: id ? t('ai.workspace.unknownGroup') : t('ai.workspace.ungrouped'),
      hosts: hosts.sort(compareHosts),
    })
  }
  return sections
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
    return { hostCount: scope.connectionIds.length, connected: scope.connectionIds.every(id => !!sessions.value[id]), connectionId: scope.id, sessionId: scope.id, hostLabel: scopeLabel(scope), threadId: state.activeThreadId,
      title: summary?.customTitle || summary?.title || t('ai.workspace.openChat'), updatedAt: summary?.updatedAt || scope.createdAt,
      viewing: !browsing.value && selectedScopeId.value === scope.id }
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
    await startNewConversation(id, () => {})
    sessionTick.value += 1
    await refreshRecent()
    return
  }
  if (!threadId) return
  await loadHistory(id)
  await switchConversation(id, threadId, () => {})
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
  if (scopeBusy.value || connectingId.value) return
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
    if (threadId) await switchConversation(scope.id, threadId, () => {})
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
  const state = getSessionState(scope.id)
  if (state.loading) { ElMessage.warning(t('ai.workspace.scopeBusyHint')); return }
  await window.LiteConnect.aiSuppressBackgroundReplies(scope.id, state.activeThreadId)
  const next = { ...scopes.value }
  delete next[scope.id]
  scopes.value = next
  selectedScopeId.value = ''
  browsing.value = true
  await refreshRecent()
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
        await appConfirm({ title: t('ai.workspace.disconnectTitle'), message: t('ai.workspace.disconnectMessage'),
          confirmText: t('ai.workspace.disconnect'), cancelText: t('common.cancel'), danger: true, tone: 'warning' })
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
  if (props.active && !loading.value && !disposed) void refresh()
}

watch(browsing, value => { if (value) void refreshRecent() })
watch(() => props.active, active => { if (active) void refresh() })
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
  if (connectingId.value) void window.LiteConnect.aiCancelWorkspaceConnection(connectingId.value).catch(() => {})
  for (const scope of Object.values(scopes.value)) void nextTick(() => disposeAiSessionState(scope.id))
  for (const id of Object.values(sessions.value)) {
    void nextTick(() => disposeAiSessionState(id))
    void window.LiteConnect.aiCloseWorkspaceConnection(id).catch(() => {})
  }
})
</script>

<template>
  <div class="ai-workspace" :class="{ 'is-schedule': showSchedules }">
    <aside class="ai-workspace-rail" :class="{ collapsed: railCollapsed }">
      <div class="rail-top-actions">
        <button type="button" class="workspace-new-chat" :title="t('ai.workspace.newConversationMenu')" :aria-label="t('ai.workspace.newConversationMenu')" :disabled="!!connectingId || closing || !connections.length" @click="openHostPicker('create')">
          <AppIcon name="plus" size="sm" /><span v-if="!railCollapsed">{{ t('ai.workspace.newConversationMenu') }}</span>
        </button>
        <button type="button" class="ui-icon-btn rail-collapse" :title="t(railCollapsed ? 'ai.workspace.expandRail' : 'ai.workspace.collapseRail')" :aria-label="t(railCollapsed ? 'ai.workspace.expandRail' : 'ai.workspace.collapseRail')" :aria-expanded="!railCollapsed" @click="railCollapsed = !railCollapsed"><AppIcon :name="railCollapsed ? 'chevron-right' : 'chevron-left'" size="xs" /></button>
      </div>
      <nav class="workspace-primary-nav" :aria-label="t('ai.workspace.navigation')">
        <button type="button" class="workspace-manage workspace-host-entry" :class="{ active: browsing && !showSchedules }" :aria-current="browsing && !showSchedules ? 'page' : undefined" :title="t('ai.schedule.host')" @click="backToHosts"><AppIcon name="server" size="sm" /><span v-if="!railCollapsed">{{ t('ai.schedule.host') }}</span></button>
        <button type="button" class="workspace-manage workspace-schedule-entry" :class="{ active: showSchedules }" :aria-current="showSchedules ? 'page' : undefined" :title="t('ai.schedule.title')" @click="openSchedules()"><AppIcon name="activity" size="sm" /><span v-if="!railCollapsed">{{ t('ai.schedule.title') }}</span></button>
      </nav>
      <div v-show="!railCollapsed" class="rail-conversations">
        <section class="rail-section rail-current">
          <div class="rail-section-head">
            <h3>{{ t('ai.workspace.currentChats') }}</h3>
            <span class="rail-count">{{ currentConversations.length }}</span>
          </div>
          <div class="rail-list rail-current-list" role="region" :aria-label="t('ai.workspace.currentChats')" tabindex="0">
            <p v-if="!currentConversations.length" class="rail-empty">{{ t('ai.workspace.noCurrentChats') }}</p>
            <button
              v-for="item in currentConversations"
              :key="item.sessionId"
              type="button"
              class="rail-item"
              :data-connection-id="item.connectionId"
              :class="{ active: item.viewing && !showSchedules && !browsing }"
              :title="`${item.title}\n${item.hostLabel}`"
              :aria-current="item.viewing && !showSchedules && !browsing ? 'page' : undefined"
              @click="openCurrent(item)"
            >
              <span class="rail-item-title"><span class="connection-dot" :class="{ connected: item.connected }" /><span class="rail-title-text">{{ item.title }}</span><span class="rail-host-count">{{ t('ai.workspace.hostCountBadge', { count: item.hostCount }) }}</span></span>
              <span class="rail-item-meta">{{ item.hostLabel }}</span>
            </button>
          </div>
        </section>

        <section class="rail-section rail-history">
          <div class="rail-section-head">
            <h3>{{ t('ai.workspace.recentChats') }}</h3>
            <span class="rail-count">{{ historyConversations.length }}</span>
          </div>
          <div ref="historyList" class="rail-list rail-history-list" role="region" :aria-label="t('ai.workspace.recentChats')" tabindex="0">
            <p v-if="!historyConversations.length" class="rail-empty">{{ t('ai.workspace.noRecentChats') }}</p>
            <div v-for="section in historySections" :key="section.label" class="rail-history-group">
              <h4>{{ section.label }}</h4>
              <button
                v-for="item in section.items"
                :key="`${item.connectionId}:${item.threadId}`"
                type="button"
                class="rail-item"
              :data-connection-id="item.connectionId"
                :title="`${item.title}\n${item.hostLabel} · ${new Date(item.updatedAt).toLocaleString()}`"
                @click="openHistory(item)"
              >
                <span class="rail-item-title"><span class="rail-title-text">{{ item.title }}</span><span class="rail-host-count">{{ t('ai.workspace.hostCountBadge', { count: item.connectionIds?.length || 1 }) }}</span></span>
                <span class="rail-item-meta">{{ item.hostLabel }}</span>
              </button>
            </div>
          </div>
          <button v-if="historyConversations.length > HISTORY_PREVIEW_COUNT" type="button" class="rail-history-toggle" :aria-expanded="historyExpanded" @click="toggleHistory">
            <AppIcon :name="historyExpanded ? 'chevron-up' : 'chevron-down'" size="xs" />
            {{ historyExpanded ? t('ai.workspace.collapseHistory') : t('ai.workspace.expandHistory', { count: historyConversations.length - HISTORY_PREVIEW_COUNT }) }}
          </button>
        </section>
      </div>

    </aside>

    <AiSchedulePanel
      v-if="showSchedules"
      :connections="connections"
      :connection-id="selectedId"
      :create-token="scheduleCreateToken"
      :return-to-chat="!!sessionId"
      @close="showSchedules = false; browsing = !sessionId"
    />

    <main v-show="!showSchedules" class="ai-workspace-main">
      <div v-if="!browsing" class="workspace-chat">
        <header v-if="activeScope" class="workspace-target workspace-scope-target">
          <button type="button" class="ui-btn ui-btn-xs" @click="backToHosts"><AppIcon name="chevron-left" size="xs" />{{ t('ai.workspace.backToHosts') }}</button>
          <details class="workspace-scope-details">
            <summary>
              <span>{{ t('ai.workspace.scopeCount', { count: activeScope.connectionIds.length }) }}</span>
              <span class="workspace-scope-ratio" :class="{ ready: scopeReady }">{{ t('ai.workspace.scopeConnectionRatio', { connected: scopeTargets?.filter(target => target.sessionId).length || 0, count: activeScope.connectionIds.length }) }}</span>
              <span class="workspace-scope-names"><span v-for="target in scopeTargets?.slice(0, 3)" :key="target.connectionId" class="workspace-scope-chip" :title="target.name">{{ target.name }}</span><span v-if="activeScope.connectionIds.length > 3">+{{ activeScope.connectionIds.length - 3 }}</span></span>
              <AppIcon name="chevron-down" size="xs" />
            </summary>
            <ul><li v-for="target in scopeTargets" :key="target.connectionId"><span class="connection-dot" :class="{ connected: !!target.sessionId }" /><strong>{{ target.name }}</strong><span>{{ target.username }}@{{ target.host }}:{{ target.port }}</span></li></ul>
          </details>
          <button v-if="!scopeReady" type="button" class="ui-btn ui-btn-xs" :disabled="scopeBusy" @click="openScope({ id: activeScope.id })">{{ t('ai.workspace.retryConnect') }}</button>
          <button type="button" class="ui-btn ui-btn-xs" :disabled="scopeBusy" @click="closeScope">{{ t('ai.workspace.closeScope') }}</button>
        </header>
        <p v-if="activeScope && !scopeReady" class="workspace-error inset" role="alert">{{ t('ai.workspace.scopeDisconnected') }}</p>
        <header v-else-if="selected" class="workspace-target">
          <button type="button" class="ui-btn ui-btn-xs" @click="backToHosts"><AppIcon name="chevron-left" size="xs" />{{ t('ai.workspace.backToHosts') }}</button>
          <button
            type="button"
            class="workspace-target-host"
            :title="t('ai.workspace.switchHost')"
            :disabled="!!connectingId || closing"
            @click="openHostPicker('switch')"
          >
            <strong>{{ selected.name }}</strong>
            <span>{{ selected.username }}@{{ selected.host }}:{{ selected.port || 22 }}</span>
            <AppIcon name="chevron-down" size="xs" />
          </button>
          <button type="button" class="ui-btn ui-btn-xs workspace-expand-scope" :disabled="selectionLocked" @click="openHostPicker('create', [selected.id])">{{ t('ai.workspace.collaborateMore') }}</button>
          <span class="workspace-target-status" :class="{ connected: !!sessionId, connecting: connectingId === selected.id }"><span class="connection-dot" :class="{ connected: !!sessionId, connecting: connectingId === selected.id }" />{{ connectingId === selected.id ? t('ai.workspace.connecting') : sessionId ? t('ai.workspace.connected') : t('ai.workspace.disconnected') }}</span>
          <button v-if="connectingId === selected.id" type="button" class="ui-btn ui-btn-xs" @click="cancelConnect">{{ t('common.cancel') }}</button>
          <button v-else-if="sessionId" type="button" class="ui-btn ui-btn-xs" :disabled="closing" @click="disconnect()">{{ t('ai.workspace.disconnect') }}</button>
        </header>
        <p v-if="error && sessionId" class="workspace-error inset" role="alert">{{ error }}</p>
        <div v-if="sessionId" class="lite-ai-chat">
          <AiSidebar
            :key="sessionId"
            :session-id="sessionId"
            :workspace-targets="scopeTargets"
            :execution-available="!activeScope || scopeReady"
            :active="props.active && !showSchedules && !hostPicker"
            workspace
            @request-other-host-chat="openHostPicker('new')"
          />
        </div>
        <div v-else class="workspace-connect-panel" role="status">
          <AppIcon name="server" size="md" />
          <h3>{{ connectingId === selectedId ? t('ai.workspace.connectingTitle') : t('ai.workspace.connectFailedTitle') }}</h3>
          <p>{{ connectingId === selectedId ? t('ai.workspace.connectingHint') : (error || t('ai.workspace.connectFailedHint')) }}</p>
          <div v-if="connectingId !== selectedId" class="workspace-connect-actions">
            <button type="button" class="ui-btn ui-btn-primary ui-btn-sm" :disabled="closing || !!connectingId" @click="startChat(selected)">{{ t('ai.workspace.retryConnect') }}</button>
            <button type="button" class="ui-btn ui-btn-sm" :disabled="closing || !!connectingId" @click="openHostPicker('switch')">{{ t('ai.workspace.switchHost') }}</button>
            <button type="button" class="ui-btn ui-btn-sm" @click="backToHosts">{{ t('ai.workspace.backToHosts') }}</button>
          </div>
        </div>
      </div>

      <div v-else class="workspace-browser">
        <div class="workspace-toolbar">
          <div class="workspace-filter-tabs" role="group" :aria-label="t('ai.workspace.filterHosts')">
            <button type="button" data-filter="all" :class="{ active: hostFilter === 'all' }" :aria-pressed="hostFilter === 'all'" @click="hostFilter = 'all'">{{ t('ai.workspace.allHosts') }}<span>{{ connections.length }}</span></button>
            <button type="button" data-filter="connected" :class="{ active: hostFilter === 'connected' }" :aria-pressed="hostFilter === 'connected'" @click="hostFilter = 'connected'">{{ t('ai.workspace.connected') }}<span>{{ connectedCount }}</span></button>
          </div>
          <div class="workspace-toolbar-controls">
            <div class="workspace-search-field">
              <AppIcon name="search" size="sm" />
              <input v-model="query" class="workspace-search" :placeholder="t('ai.workspace.search')" :aria-label="t('ai.workspace.search')" />
              <button v-if="query" type="button" class="workspace-search-clear" :title="t('ai.workspace.clearSearch')" :aria-label="t('ai.workspace.clearSearch')" @click="query = ''"><AppIcon name="close" size="xs" /></button>
            </div>
            <div class="workspace-view-switch" role="group" :aria-label="t('ai.workspace.viewMode')">
              <button type="button" data-view="cards" :class="{ active: hostView === 'cards' }" :aria-pressed="hostView === 'cards'" @click="hostView = 'cards'"><AppIcon name="home-grid" size="sm" />{{ t('ai.workspace.cardViewLabel') }}</button>
              <button type="button" data-view="list" :class="{ active: hostView === 'list' }" :aria-pressed="hostView === 'list'" @click="hostView = 'list'"><AppIcon name="list" size="sm" />{{ t('ai.workspace.listViewLabel') }}</button>
            </div>
          </div>
          <div class="workspace-toolbar-actions">
            <button type="button" class="ui-icon-btn" :title="t('ai.workspace.refresh')" :aria-label="t('ai.workspace.refresh')" :disabled="loading" @click="refresh"><AppIcon name="refresh" size="sm" /></button>
            <button type="button" class="ui-btn ui-btn-sm workspace-manage-button" :title="t('ai.workspace.manageConnections')" :aria-label="t('ai.workspace.manageConnections')" @click="emit('open-connections')"><AppIcon name="settings" size="sm" /><span class="workspace-manage-label">{{ t('ai.workspace.manageConnections') }}</span></button>
          </div>
        </div>

        <div class="workspace-selection-guide">
          <span><AppIcon name="circle-check" size="sm" />{{ t('ai.workspace.selectionHint') }}</span>
          <button type="button" class="workspace-text-action workspace-select-results" :disabled="!visible.length || selectionLocked || !canSelectResults" :title="!canSelectResults ? t('ai.workspace.selectionLimit', { count: AI_WORKSPACE_MAX_HOSTS }) : undefined" @click="toggleResults">{{ t(allResultsSelected ? 'ai.workspace.deselectResults' : 'ai.workspace.selectResults') }}</button>
        </div>
        <div class="workspace-host-scroll">
        <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
        <p v-if="loading" class="workspace-caption" role="status">{{ t('common.loading') }}</p>
        <div v-else-if="!visible.length" class="workspace-empty" role="status">
          <span class="workspace-empty-icon"><AppIcon :name="connections.length ? 'search' : 'server'" size="2xl" /></span>
          <h3>{{ !connections.length ? t('ai.workspace.noSavedHosts') : hostFilter === 'connected' && !query ? t('ai.workspace.noConnectedHosts') : t('ai.workspace.noConnections') }}</h3>
          <p>{{ connections.length ? t('ai.workspace.emptyFilterHint') : t('ai.workspace.emptyHostsHint') }}</p>
          <button v-if="connections.length" type="button" class="ui-btn ui-btn-sm" @click="resetFilters">{{ t('ai.workspace.resetFilters') }}</button>
          <button v-else type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click="emit('open-connections')">{{ t('ai.workspace.manageConnections') }}</button>
        </div>

        <section v-for="section in groupedHosts" :key="section.id" class="workspace-group">
          <button type="button" class="workspace-group-header" :aria-expanded="!isCollapsed(section.id)" @click="toggleGroup(section.id)">
            <AppIcon :name="isCollapsed(section.id) ? 'chevron-right' : 'chevron-down'" size="xs" />
            <AppIcon name="folder" size="sm" />
            <strong>{{ section.name }}</strong>
            <span>{{ t('ai.workspace.groupCount', { count: section.hosts.length }) }}</span>
          </button>
          <div v-if="hostView === 'list' && !isCollapsed(section.id)" class="workspace-list-heading" aria-hidden="true">
            <span>{{ t('ai.workspace.serverName') }}</span><span>{{ t('ai.workspace.connectionAddress') }}</span><span>{{ t('ai.workspace.connectionStatus') }}</span>
          </div>
          <div v-show="!isCollapsed(section.id)" class="workspace-card-grid" :class="{ 'is-list': hostView === 'list' }">
            <article
              v-for="connection in section.hosts"
              :key="connection.id"
              class="workspace-card"
              :class="{
                pinned: connection.pinned === true,
                selected: browserSelection.includes(connection.id),
                connected: !!sessions[connection.id],
                connecting: connectingId === connection.id,
              }"
              :data-connection-id="connection.id"
              :aria-label="`${connection.name}, ${connection.username}@${connection.host}:${connection.port || 22}`"
              @click="toggleBrowserHost(connection.id)"
            >
              <div class="workspace-card-top">
                <input type="checkbox" class="workspace-host-checkbox" :checked="browserSelection.includes(connection.id)" :disabled="selectionLocked || (!browserSelection.includes(connection.id) && browserSelection.length >= AI_WORKSPACE_MAX_HOSTS)" :aria-label="t('ai.workspace.selectNamed', { name: connection.name })" @click.stop @change="toggleBrowserHost(connection.id)" @keydown.enter.stop.prevent="toggleBrowserHost(connection.id)" />
                <span class="workspace-host-icon"><AppIcon name="server" size="md" /></span>
                <div class="workspace-host-name">
                  <span class="workspace-host-label">
                    <strong :title="connection.name">{{ connection.name }}</strong>
                    <span v-if="connection.pinned" class="workspace-pin" role="img" :title="t('connections.pinned')" :aria-label="t('connections.pinned')"><AppIcon name="pin-fill" size="xs" /></span>
                  </span>
                  <span v-if="connection.note" class="workspace-card-note" :title="connection.note">{{ connection.note }}</span>
                </div>
              </div>
              <p class="workspace-host-address" :title="`${connection.username}@${connection.host}:${connection.port || 22}`">{{ connection.username }}@{{ connection.host }}:{{ connection.port || 22 }}</p>
              <span class="workspace-card-status" :class="{ connected: !!sessions[connection.id], connecting: connectingId === connection.id }">
                <span class="connection-dot" :class="{ connected: !!sessions[connection.id], connecting: connectingId === connection.id }" />
                {{ connectingId === connection.id ? t('ai.workspace.connecting') : sessions[connection.id] ? t('ai.workspace.connected') : t('ai.workspace.disconnected') }}
              </span>

            </article>
          </div>
        </section>
        </div>
        <footer class="workspace-selection-bar" :class="{ 'has-selection': browserSelection.length > 0 }">
          <div class="workspace-selection-summary">
            <div v-if="browserSelection.length" class="workspace-selection-heading"><strong aria-live="polite">{{ t('ai.workspace.selectionCount', { count: browserSelection.length }) }}</strong><button v-if="browserSelection.length" type="button" class="workspace-text-action workspace-clear-selection" :disabled="selectionLocked" @click="browserSelection = []">{{ t('ai.workspace.clearSelection') }}</button></div>
            <div v-if="browserSelection.length" class="workspace-selection-chips" :aria-label="t('ai.workspace.selectedServers')">
              <button v-for="host in browserSelectionHosts" :key="host.id" type="button" class="workspace-selection-chip" :disabled="selectionLocked" :title="host.name" :aria-label="t('ai.workspace.removeSelected', { name: host.name })" @click="toggleBrowserHost(host.id)"><span>{{ host.name }}</span><AppIcon name="close" size="xs" /></button>
            </div>
            <span v-else class="workspace-selection-empty">{{ t('ai.workspace.selectionEmpty') }}</span>
          </div>
          <button v-if="connectingId" type="button" class="ui-btn ui-btn-sm" @click="cancelConnect">{{ t('common.cancel') }}</button>
          <button type="button" class="ui-btn ui-btn-primary ui-btn-sm workspace-start-scope" :disabled="!browserSelection.length || selectionLocked" @click="openScope({ connectionIds: browserSelection })"><AppIcon name="ai-chat" size="sm" />{{ scopeBusy ? t('ai.workspace.connecting') : t('ai.workspace.startCollaboration', { count: browserSelection.length }) }}</button>
        </footer>
      </div>
    </main>

    <div v-if="hostPicker && !showSchedules" class="host-picker-layer" @keydown.esc.prevent="closeHostPicker">
      <button type="button" class="host-picker-backdrop" :aria-label="t('common.cancel')" @click="closeHostPicker" />
      <section ref="pickerElement" class="host-picker" role="dialog" aria-modal="true" :aria-label="hostPicker === 'create' ? t('ai.workspace.newConversationMenu') : hostPicker === 'new' ? t('ai.workspace.newOnOtherTitle') : t('ai.workspace.switchHost')" @keydown.tab="trapPickerFocus">
        <header>
          <div>
            <h3>{{ hostPicker === 'create' ? t('ai.workspace.newConversationMenu') : hostPicker === 'new' ? t('ai.workspace.newOnOtherTitle') : t('ai.workspace.switchHost') }}</h3>
            <p>{{ hostPicker === 'create' ? t('ai.workspace.scopeHint') : hostPicker === 'new' ? t('ai.workspace.scopeHint') : t('ai.workspace.switchHostHint') }}</p>
          </div>
          <button type="button" class="ui-icon-btn" :title="t('common.cancel')" :aria-label="t('common.cancel')" @click="closeHostPicker"><AppIcon name="close" size="sm" /></button>
        </header>
        <input
          v-model="pickerQuery"
          class="workspace-search host-picker-search"
          :placeholder="t('ai.workspace.pickHostSearch')"
          :aria-label="t('ai.workspace.pickHostSearch')"
          autofocus
        />
        <p v-if="!pickerHosts.length" class="rail-empty">{{ t('ai.workspace.pickHostEmpty') }}</p>
        <div v-else class="host-picker-list">
          <section v-for="section in pickerGroups" :key="section.id" class="host-picker-group">
            <button type="button" class="host-picker-group-heading" :aria-expanded="!isPickerGroupCollapsed(section.id)" :disabled="!!pickerQuery.trim()" @click="togglePickerGroup(section.id)">
              <AppIcon :name="isPickerGroupCollapsed(section.id) ? 'chevron-right' : 'chevron-down'" size="xs" />
              <AppIcon name="folder" size="sm" />
              <strong :title="section.name">{{ section.name }}</strong>
              <span>{{ t('ai.workspace.groupCount', { count: section.hosts.length }) }}</span>
            </button>
            <div v-show="!isPickerGroupCollapsed(section.id)" class="host-picker-group-items">
              <button
                v-for="connection in section.hosts"
                :key="connection.id"
                type="button"
                class="host-picker-item"
                :class="{ pinned: connection.pinned === true, connected: !!sessions[connection.id], current: hostPicker === 'switch' ? connection.id === selectedId : pickerSelection.includes(connection.id) }"
                :aria-pressed="hostPicker !== 'switch' ? pickerSelection.includes(connection.id) : undefined"
                :disabled="!!connectingId || closing || scopeBusy || (hostPicker !== 'switch' && !pickerSelection.includes(connection.id) && pickerSelection.length >= AI_WORKSPACE_MAX_HOSTS)"
                @click="pickHost(connection)"
              >
                <span class="host-picker-item-main">
                  <span class="workspace-host-label">
                    <strong :title="connection.name">{{ connection.name }}</strong>
                    <span v-if="connection.pinned" class="workspace-pin" role="img" :title="t('connections.pinned')" :aria-label="t('connections.pinned')"><AppIcon name="pin-fill" size="xs" /></span>
                  </span>
                  <span>{{ connection.username }}@{{ connection.host }}:{{ connection.port || 22 }}</span>
                </span>
                <span v-if="hostPicker !== 'switch'" class="host-picker-check" aria-hidden="true"><AppIcon :name="pickerSelection.includes(connection.id) ? 'circle-check' : 'plus'" size="sm" /></span>
                <span v-else class="host-picker-item-meta">
                  <span v-if="connection.id === selectedId">{{ t('ai.workspace.currentHost') }}</span>
                  <span v-else-if="sessions[connection.id]">{{ t('ai.workspace.connected') }}</span>
                  <span>{{ hostPicker === 'switch' ? t('ai.workspace.switchHostAction') : t('ai.workspace.openNewAction') }}</span>
                </span>
              </button>
            </div>
          </section>
        </div>
        <p v-if="pickerError" class="workspace-error" role="alert">{{ pickerError }}</p>
        <footer v-if="hostPicker !== 'switch'" class="host-picker-footer">
          <span>{{ t('ai.workspace.scopeSelected', { count: pickerSelection.length, max: AI_WORKSPACE_MAX_HOSTS }) }}</span>
          <button v-if="connectingId" type="button" class="ui-btn ui-btn-sm" @click="cancelConnect">{{ t('common.cancel') }}</button>
          <button type="button" class="ui-btn ui-btn-primary ui-btn-sm" :disabled="!pickerSelection.length || scopeBusy || !!connectingId" @click="openScope({ connectionIds: pickerSelection })">{{ t(scopeBusy ? 'ai.workspace.connecting' : 'ai.workspace.scopeStart') }}</button>
        </footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
.workspace-host-scroll { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.workspace-toolbar { flex-shrink: 0; }
.workspace-selection-guide { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-shrink: 0; margin: 0 0 12px; color: var(--text-secondary); font-size: 11px; }
.workspace-selection-guide > span { display: flex; align-items: center; gap: 6px; min-width: 0; }
.workspace-text-action { padding: 4px; border: 0; background: transparent; color: var(--accent); cursor: pointer; font: inherit; font-size: 11px; flex-shrink: 0; }
.workspace-text-action:disabled { opacity: .5; cursor: not-allowed; }
.workspace-host-checkbox { width: 16px; height: 16px; margin: 0; flex-shrink: 0; accent-color: var(--accent); cursor: pointer; }
.workspace-host-checkbox:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.workspace-selection-bar { display: flex; flex-shrink: 0; align-items: center; gap: 12px; padding: 14px 0 0; margin-top: 12px; border-top: 1px solid var(--border-color); }
.workspace-selection-summary { flex: 1; min-width: 0; }
.workspace-selection-bar:not(.has-selection) { padding-top: 8px; margin-top: 8px; }
.workspace-scope-ratio { font-size: 11px; color: var(--text-secondary); font-weight: 400; }
.workspace-scope-ratio.ready { color: var(--success); }
.workspace-selection-heading { display: flex; align-items: center; gap: 10px; font-size: 12px; margin-bottom: 5px; }
.workspace-selection-empty { font-size: 11px; color: var(--text-secondary); }
.workspace-selection-chips { display: flex; flex-wrap: wrap; gap: 5px; max-height: 60px; overflow: auto; }
.workspace-selection-chip, .workspace-scope-chip { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 180px; padding: 3px 7px; border: 1px solid var(--border-color); border-radius: 5px; background: var(--bg-secondary); color: var(--text-secondary); font: inherit; font-size: 11px; }
.workspace-selection-chip { cursor: pointer; }
.workspace-selection-chip > span, .workspace-scope-chip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workspace-selection-chip:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.workspace-start-scope { flex-shrink: 0; white-space: nowrap; }
.workspace-scope-details summary { flex-wrap: wrap; }
.workspace-scope-names { display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap; min-width: 0; }

.host-picker-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 14px; border-top: 1px solid var(--border-color); font-size: 12px; color: var(--text-secondary); flex-shrink: 0; }
.host-picker-check { font-size: 18px; color: var(--accent); }
.workspace-scope-details { flex: 1; min-width: 0; position: relative; }
.workspace-scope-details summary { display: flex; align-items: center; gap: 8px; cursor: pointer; list-style: none; font-weight: 600; }
.workspace-scope-details ul { position: absolute; top: 100%; left: 0; z-index: 5; max-width: min(600px, 65vw); max-height: 240px; overflow: auto; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-primary); box-shadow: 0 8px 24px #0002; list-style: none; }
.workspace-scope-details li { display: flex; align-items: center; gap: 8px; padding: 6px; flex-wrap: wrap; overflow-wrap: anywhere; }
.workspace-scope-details li > span:last-child { color: var(--text-secondary); }

.ai-workspace { position: relative; display: flex; height: 100%; min-height: 0; min-width: 0; background: var(--bg-primary); color: var(--text-primary); container: ai-workspace / inline-size; }
.ai-workspace-rail { display: flex; flex-direction: column; width: 252px; flex-shrink: 0; padding: 20px 12px 12px; border-right: 1px solid var(--border-color); background: var(--bg-secondary); min-height: 0; }
.rail-top-actions { display: flex; flex-shrink: 0; align-items: center; gap: 8px; margin-bottom: 20px; }
.workspace-new-chat { display: flex; flex: 1; align-items: center; justify-content: center; gap: 8px; min-width: 0; min-height: 36px; border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border-color)); border-radius: 8px; background: var(--accent-bg); color: var(--accent); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.workspace-new-chat:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 17%, var(--bg-secondary)); }
.workspace-new-chat:disabled { opacity: 0.5; cursor: not-allowed; }
.workspace-primary-nav { display: flex; flex-direction: column; gap: 4px; padding-bottom: 18px; border-bottom: 1px solid var(--border-color); margin-bottom: 20px; }
.workspace-primary-nav .workspace-manage { justify-content: flex-start; gap: 10px; }
.workspace-manage.active { color: var(--accent); background: var(--accent-bg); font-weight: 600; }
.rail-conversations { display: grid; grid-template-rows: minmax(0, min(35%, 240px)) minmax(0, 1fr); gap: 20px; flex: 1; min-height: 0; overflow: hidden; }
.rail-section { display: flex; flex-direction: column; gap: 4px; min-height: 0; overflow: hidden; }
.rail-list { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; overscroll-behavior: contain; }
.rail-list:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; border-radius: 6px; }
.rail-section-head { display: flex; flex-shrink: 0; align-items: center; gap: 6px; margin-bottom: 6px; padding: 0 10px; }
.rail-section h3,
.rail-section-head h3 { margin: 0 10px 6px; font-size: 11px; font-weight: 500; color: var(--text-secondary); }
.rail-section-head h3 { margin: 0; flex: 1; }
.rail-count { font-size: 10px; color: var(--text-secondary); background: var(--bg-tertiary); padding: 1px 5px; border-radius: 4px; }
.rail-history { padding-top: 16px; border-top: 1px solid var(--border-color); }
.rail-history-group h4 { margin: 14px 10px 5px; color: var(--text-secondary); font-size: 10px; font-weight: 400; }
.rail-history-group:first-child h4 { margin-top: 4px; }
.rail-history-toggle { display: flex; flex-shrink: 0; align-items: center; justify-content: center; gap: 6px; width: 100%; min-height: 30px; margin-top: 4px; padding: 6px 8px; border: 0; border-radius: 6px; color: var(--text-secondary); background: transparent; cursor: pointer; font: inherit; font-size: 11px; }
.rail-history-toggle:hover { color: var(--accent); background: var(--accent-bg); }
.rail-empty { margin: 0; padding: 10px; color: var(--text-secondary); font-size: 11px; line-height: 1.6; }
.rail-item { display: flex; flex-direction: column; gap: 5px; width: 100%; text-align: left; padding: 10px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--text-primary); cursor: pointer; font: inherit; }
.rail-item:hover { background: var(--hover-bg); }
.rail-item.active { background: var(--accent-bg); color: var(--accent); }
.rail-item-title { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 12px; }
.rail-title-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail-host-count { flex-shrink: 0; padding: 2px 5px; border-radius: 4px; background: var(--bg-secondary); color: var(--text-secondary); font-size: 10px; }

.rail-item-meta { font-size: 10px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workspace-manage { display: flex; align-items: center; padding: 10px; border: 0; border-radius: 7px; color: var(--text-secondary); background: transparent; cursor: pointer; font: inherit; font-size: 12px; }
.workspace-manage:hover { background: var(--accent-bg); color: var(--text-primary); }
.ai-workspace-main { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.workspace-chat { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.workspace-connect-panel {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  flex: 1; min-height: 0; padding: 32px 24px; text-align: center;
}
.workspace-connect-panel h3 { margin: 8px 0 0; font-size: 16px; }
.workspace-connect-panel p { margin: 0; max-width: 420px; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.workspace-connect-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 8px; }
.workspace-target { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border-color); font-size: 12px; }
.workspace-target-host {
  flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px;
  padding: 4px 8px; margin: -4px -8px; border: 0; border-radius: 8px; background: transparent;
  color: inherit; font: inherit; text-align: left; cursor: pointer; overflow-wrap: anywhere;
}
.workspace-target-host:hover:not(:disabled) { background: var(--accent-bg); }
.workspace-target-host:disabled { cursor: not-allowed; opacity: 0.7; }
.workspace-target-host strong { color: var(--text-primary); }
.workspace-target-host span, .workspace-target-status { color: var(--text-secondary); }
.workspace-target-status { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-size: 11px; }
.workspace-target-status.connected { color: var(--success); }
.workspace-target-host :deep(.app-icon) { color: var(--text-secondary); flex-shrink: 0; }
.host-picker-layer {
  position: absolute; inset: 0; z-index: 20; display: flex; align-items: flex-start; justify-content: center;
  padding: 48px 20px 24px; pointer-events: none;
}
.host-picker-backdrop {
  position: absolute; inset: 0; border: 0; padding: 0; margin: 0; background: color-mix(in srgb, var(--overlay-bg) 45%, transparent);
  cursor: pointer; pointer-events: auto;
}
.host-picker {
  position: relative; z-index: 1; display: flex; flex-direction: column; gap: 12px; width: min(440px, 100%);
  max-height: min(70vh, 560px); padding: 16px; border: 1px solid var(--border-color); border-radius: 14px;
  background: var(--bg-primary); box-shadow: 0 18px 48px color-mix(in srgb, var(--overlay-bg) 55%, transparent);
  pointer-events: auto;
}
.host-picker > header { display: flex; align-items: flex-start; gap: 12px; }
.host-picker > header h3 { margin: 0 0 4px; font-size: 15px; }
.host-picker > header p { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.host-picker > header button { margin-left: auto; flex-shrink: 0; }
.host-picker-search { width: 100%; flex-shrink: 0; }
.host-picker-list { display: flex; flex-direction: column; gap: 12px; overflow: auto; min-height: 0; }
.host-picker-group { flex-shrink: 0; min-width: 0; }
.host-picker-group-heading { display: flex; align-items: center; gap: 7px; width: 100%; padding: 8px 10px; border: 0; border-radius: 6px; background: var(--bg-secondary); color: var(--text-secondary); font: inherit; text-align: left; cursor: pointer; }
.host-picker-group-heading:hover:not(:disabled) { background: var(--hover-bg); }
.host-picker-group-heading:disabled { cursor: default; }
.host-picker-group-heading strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); font-size: 12px; font-weight: 600; }
.host-picker-group-heading > span { flex-shrink: 0; font-size: 11px; }
.host-picker-group-items { display: flex; flex-direction: column; gap: 4px; padding-top: 4px; }
.host-picker-item {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; width: 100%;
  padding: 10px 12px; border: 1px solid transparent; border-radius: 10px; background: transparent;
  color: var(--text-primary); font: inherit; text-align: left; cursor: pointer;
}
.host-picker-item:hover:not(:disabled), .host-picker-item.current { background: var(--accent-bg); border-color: var(--accent); }
.host-picker-item.connected:not(.current) { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--success) 30%, transparent); }
.host-picker-item:disabled { opacity: 0.55; cursor: not-allowed; }
.host-picker-item-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.host-picker-item-main strong { font-size: 13px; }
.host-picker-item-main span { color: var(--text-secondary); font-size: 12px; overflow-wrap: anywhere; }
.workspace-host-label { display: flex; align-items: center; gap: 6px; min-width: 0; }
.workspace-host-label strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
.workspace-host-label .workspace-pin { display: inline-flex; align-items: center; flex-shrink: 0; color: var(--accent); }
.host-picker-item-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; color: var(--text-secondary); font-size: 11px; }
.lite-ai-chat { display: flex; flex: 1; min-height: 0; min-width: 0; width: 100%; max-width: 1100px; margin: 0 auto; }
.lite-ai-chat :deep(.ai-sidebar) { width: 100%; max-width: none; min-width: 0; border-left: 0; flex: 1; }
.workspace-browser { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; padding: 20px clamp(20px, 3vw, 48px); overflow: hidden; container-type: inline-size; }
.workspace-toolbar-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: auto; }
.workspace-toolbar { display: flex; flex-wrap: wrap; min-width: 0; gap: 12px; align-items: center; justify-content: space-between; padding: 0 0 14px; margin-bottom: 12px; border-bottom: 1px solid var(--border-color); }
.workspace-toolbar-controls { display: flex; flex: 1 1 300px; min-width: min(240px, 100%); gap: 10px; align-items: center; }
.workspace-filter-tabs { display: flex; flex-shrink: 0; align-items: center; gap: 4px; }
.workspace-filter-tabs button { display: inline-flex; align-items: center; gap: 7px; padding: 7px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.workspace-filter-tabs button:hover { background: var(--hover-bg); }
.workspace-filter-tabs button.active { color: var(--text-primary); background: var(--bg-secondary); font-weight: 600; }
.workspace-filter-tabs button span { padding: 0 5px; border-radius: 4px; background: var(--bg-tertiary); color: var(--text-secondary); font-size: 10px; font-weight: 400; }
.workspace-search-field { display: flex; align-items: center; flex: 1; min-width: 0; height: 34px; padding: 0 10px; gap: 7px; border: 1px solid var(--border-color); border-radius: 7px; color: var(--text-secondary); background: var(--bg-primary); }
.workspace-search-field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-bg); }
.workspace-search-field > .workspace-search { width: 100%; min-width: 0; height: 100%; padding: 0; border: 0; border-radius: 0; background: transparent; outline: none; }
.workspace-search-clear { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 20px; height: 20px; border: 0; border-radius: 4px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.workspace-search-clear:hover { background: var(--hover-bg); }
.workspace-search { width: min(260px, 100%); box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 7px; color: var(--text-primary); background: var(--bg-secondary); font: inherit; font-size: 12px; }
.workspace-caption { color: var(--text-secondary); font-size: 12px; }
.workspace-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 64px 16px; text-align: center; color: var(--text-secondary); font-size: 12px; }
.workspace-empty-icon { display: grid; place-items: center; width: 60px; height: 60px; margin-bottom: 4px; border-radius: 18px; background: var(--bg-secondary); }
.workspace-empty h3 { color: var(--text-primary); font-size: 15px; font-weight: 600; }
.workspace-empty p { max-width: 340px; line-height: 1.7; }
.workspace-group { margin-bottom: 24px; }
.workspace-group-header { display: flex; align-items: center; gap: 8px; width: 100%; padding: 12px 2px; border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; font: inherit; text-align: left; }
.workspace-group-header strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; color: var(--text-primary); }
.workspace-group-header span { flex-shrink: 0; font-size: 10px; }
.workspace-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(210px, 100%), 1fr)); gap: 10px; }
.workspace-card { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--border-color); border-radius: 9px; background: var(--bg-primary); cursor: pointer; text-align: left; min-width: 0; }
.workspace-card:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color)); background: color-mix(in srgb, var(--accent) 3%, var(--bg-primary)); }
.workspace-card.selected { border-color: color-mix(in srgb, var(--accent) 55%, var(--border-color)); background: color-mix(in srgb, var(--accent) 5%, var(--bg-primary)); }
.workspace-card-top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.workspace-host-icon { display: grid; place-items: center; flex-shrink: 0; width: 34px; height: 34px; border: 1px solid var(--border-color); border-radius: 9px; color: var(--text-secondary); background: var(--bg-secondary); }
.workspace-card-grid:not(.is-list) .workspace-host-icon { width: 30px; height: 30px; border-radius: 8px; }
.workspace-card.connected .workspace-host-icon { color: var(--accent); background: var(--accent-bg); border-color: transparent; }
.workspace-host-name { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.workspace-host-name strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
.workspace-host-address { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
.workspace-card-note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); font-size: 11px; }
.workspace-card-status { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; color: var(--text-secondary); font-size: 10px; white-space: nowrap; }
.workspace-card-status.connected { color: var(--success); }
.workspace-card-status.connecting { color: var(--accent); }
.connection-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: var(--text-secondary); opacity: 0.55; }
.connection-dot.connected { background: var(--success); opacity: 1; }
.connection-dot.connecting { background: var(--accent); opacity: 1; }
.workspace-error { padding: 10px 0; margin: 0; color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }
.workspace-error.inset { padding-left: 20px; padding-right: 20px; }
.ai-workspace-rail.collapsed { width: 54px; padding: 20px 8px 12px; }
.ai-workspace-rail.collapsed .rail-top-actions { flex-direction: column; }
.ai-workspace-rail.collapsed .workspace-new-chat { width: 100%; flex: none; }
.ai-workspace-rail.collapsed .workspace-manage { justify-content: center; padding: 10px 6px; }
.workspace-card:focus-visible, .ai-workspace button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.workspace-view-switch { display: inline-flex; flex-shrink: 0; align-items: center; padding: 3px; gap: 2px; border: 1px solid var(--border-color); border-radius: 7px; background: var(--bg-secondary); }
.workspace-view-switch button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 5px 8px; border: 0; border-radius: 4px; background: transparent; color: var(--text-secondary); font: inherit; font-size: 11px; white-space: nowrap; cursor: pointer; }
.workspace-view-switch button:hover { background: var(--hover-bg); color: var(--text-primary); }
.workspace-view-switch button.active { color: var(--accent); background: var(--bg-primary); box-shadow: 0 1px 3px color-mix(in srgb, var(--overlay-bg) 18%, transparent); }
.workspace-view-switch button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.workspace-list-heading, .is-list .workspace-card { display: grid; grid-template-columns: minmax(130px, 1.1fr) minmax(130px, 1fr) 76px; align-items: center; gap: 16px; }
.workspace-list-heading { padding: 9px 16px; color: var(--text-secondary); font-size: 10px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-bottom: 0; border-radius: 8px 8px 0 0; }

.workspace-card-grid.is-list { grid-template-columns: minmax(0, 1fr); gap: 0; border: 1px solid var(--border-color); border-radius: 0 0 8px 8px; overflow: hidden; }
.is-list .workspace-card { min-height: 58px; padding: 10px 16px; border: 0; border-bottom: 1px solid var(--border-color); border-radius: 0; }
.is-list .workspace-card:last-child { border-bottom: 0; }
.is-list .workspace-card.selected { box-shadow: inset 3px 0 var(--accent); }
.is-list .workspace-card:focus-visible { outline-offset: -2px; }
@container (max-width: 660px) {
  .workspace-list-heading { display: none; }
  .workspace-card-grid.is-list { border-radius: 8px; }
  .is-list .workspace-card { grid-template-columns: minmax(0, 1fr) auto; gap: 7px 12px; }
  .is-list .workspace-card-top { grid-column: 1; grid-row: 1; }
  .is-list .workspace-host-address { grid-column: 1; grid-row: 2; padding-left: 70px; }
  .is-list .workspace-card-status { grid-column: 2; grid-row: 1; justify-self: end; }
  .workspace-toolbar-controls { flex: 1 1 100%; order: 1; }
}
@container ai-workspace (max-width: 900px) {
  .ai-workspace-rail:not(.collapsed) { width: 218px; }
  .workspace-browser { padding: 20px; }
  .workspace-target { flex-wrap: wrap; gap: 8px; padding: 12px 16px; }
  .workspace-target-host { flex-basis: 50%; }
}
@container ai-workspace (max-width: 640px) {
  .ai-workspace-rail:not(.collapsed) { width: 182px; padding-left: 8px; padding-right: 8px; }
  .workspace-browser { padding: 20px 14px; }
}
@container (max-width: 340px) {
  .workspace-selection-bar { flex-wrap: wrap; gap: 8px; }
  .workspace-selection-summary { flex-basis: 100%; }
  .workspace-start-scope { width: 100%; justify-content: center; }
  .workspace-selection-guide { align-items: flex-start; }
  .workspace-selection-guide > span { line-height: 1.6; }

  .workspace-toolbar-actions { gap: 6px; }
  .workspace-manage-label { display: none; }
  .workspace-manage-button { width: 32px; height: 32px; padding: 0; }
  .workspace-view-switch button { padding: 5px; gap: 3px; }
  .workspace-toolbar-controls { flex-wrap: wrap; }
  .workspace-search-field { flex-basis: 100%; }
  .workspace-view-switch { margin-left: auto; }
  .is-list .workspace-card { padding: 12px; }
  .is-list .workspace-card-top { grid-column: 1 / -1; }
  .is-list .workspace-card-status { grid-column: 1; grid-row: 3; justify-self: start; }
  .is-list .workspace-host-address { grid-column: 1 / -1; }
}
</style>
