<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Connection, Group } from '@shared/types/connection'
import type { AiWorkspaceConnectionEvent } from '@shared/aiWorkspace'
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
const error = ref('')
const loading = ref(false)
const closing = ref(false)
const showSchedules = ref(false)
const railCollapsed = ref(false)
const hostView = ref<'cards' | 'list'>('cards')
const browsing = ref(true)
const scheduleCreateToken = ref(0)
const collapsedGroups = ref<Record<string, boolean>>({})
const pendingThreadId = ref('')
const pendingNewConversation = ref(false)
const sessionTick = ref(0)
const hostPicker = ref<'switch' | 'new' | null>(null)
const pickerQuery = ref('')
let disposed = false
let unsubscribe: (() => void) | undefined
let unsubscribeReply: (() => void) | undefined

const selected = computed(() => connections.value.find(connection => connection.id === selectedId.value))
const sessionId = computed(() => sessions.value[selectedId.value] || '')
const connectedCount = computed(() => Object.keys(sessions.value).length)
const visible = computed(() => {
  const text = query.value.trim().toLocaleLowerCase()
  return connections.value.filter(connection => !text || `${connection.name} ${connection.host} ${connection.username} ${groupName(connection)}`.toLocaleLowerCase().includes(text))
})
const pickerHosts = computed(() => {
  const text = pickerQuery.value.trim().toLocaleLowerCase()
  return connections.value
    .filter(connection => {
      if (hostPicker.value === 'new' && connection.id === selectedId.value) return false
      if (!text) return true
      return `${connection.name} ${connection.host} ${connection.username} ${groupName(connection)}`.toLocaleLowerCase().includes(text)
    })
    .sort((a, b) => Number(!!sessions.value[b.id]) - Number(!!sessions.value[a.id]) || a.name.localeCompare(b.name, 'zh-CN'))
})
const groupedHosts = computed(() => {
  const sections: { id: string; name: string; hosts: Connection[] }[] = []
  const byGroup = new Map<string, Connection[]>()
  for (const connection of visible.value) {
    const id = connection.group || ''
    const list = byGroup.get(id) || []
    list.push(connection)
    byGroup.set(id, list)
  }
  const ordered = [...groups.value].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'))
  for (const group of ordered) {
    const hosts = byGroup.get(group.id)
    if (!hosts?.length) continue
    sections.push({ id: group.id, name: group.name, hosts: hosts.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'zh-CN')) })
    byGroup.delete(group.id)
  }
  for (const [id, hosts] of byGroup) {
    sections.push({
      id: id || '__ungrouped__',
      name: id ? t('ai.workspace.unknownGroup') : t('ai.workspace.ungrouped'),
      hosts: hosts.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'zh-CN')),
    })
  }
  return sections
})
const currentConversations = computed(() => {
  void sessionTick.value
  return Object.entries(sessions.value).flatMap(([connectionId, id]) => {
    const connection = connections.value.find(item => item.id === connectionId)
    if (!connection) return []
    const active = recent.value.find(item => item.connectionId === connectionId && item.active)
    const state = getSessionState(id)
    const summary = state.threads.find(thread => thread.id === state.activeThreadId)
    const title = summary?.customTitle || summary?.title || active?.title || t('ai.workspace.openChat')
    return [{
      connectionId,
      sessionId: id,
      hostLabel: connection.name,
      threadId: state.activeThreadId || active?.threadId || '',
      title,
      updatedAt: summary?.updatedAt || active?.updatedAt || Date.now(),
      viewing: !browsing.value && selectedId.value === connectionId,
    }]
  }).sort((a, b) => Number(b.viewing) - Number(a.viewing) || b.updatedAt - a.updatedAt)
})
const historyConversations = computed(() => {
  const open = new Set(currentConversations.value.map(item => `${item.connectionId}:${item.threadId}`))
  return recent.value
    .filter(item => !open.has(`${item.connectionId}:${item.threadId}`))
    .slice(0, AI_WORKSPACE_HISTORY_LIMIT)
})

function groupName(connection: Connection) {
  return groups.value.find(group => group.id === connection.group)?.name || ''
}
function groupKey(id: string) { return id || '__ungrouped__' }
function isCollapsed(id: string) { return !!collapsedGroups.value[groupKey(id)] }
function toggleGroup(id: string) {
  const key = groupKey(id)
  collapsedGroups.value = { ...collapsedGroups.value, [key]: !collapsedGroups.value[key] }
}
function formatTime(value: number) {
  if (!value) return ''
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString()
}

async function refreshRecent() {
  if (!connections.value.length) { recent.value = []; return }
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

function openHostPicker(mode: 'switch' | 'new') {
  if (connectingId.value || closing.value) return
  pickerQuery.value = ''
  hostPicker.value = mode
}

function closeHostPicker() {
  hostPicker.value = null
  pickerQuery.value = ''
}

async function pickHost(connection: Connection) {
  const mode = hostPicker.value
  if (!mode || connectingId.value || closing.value) return
  closeHostPicker()
  if (mode === 'switch') {
    if (connection.id === selectedId.value && sessions.value[connection.id]) {
      browsing.value = false
      return
    }
    await startChat(connection)
    return
  }
  await startChat(connection, '', true)
}

function setSession(connectionId: string, id: string) {
  sessions.value = { ...sessions.value, [connectionId]: id }
  sessionTick.value += 1
}

function clearSession(connectionId: string) {
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
      const fallbackId = Object.keys(sessions.value)[0]
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

function selectHost(connection: Connection) {
  if (closing.value) return
  showSchedules.value = false
  selectedId.value = connection.id
  error.value = ''
  browsing.value = true
}

async function startChat(connection = selected.value, threadId = '', forceNew = false) {
  if (!connection || connectingId.value || closing.value) return
  showSchedules.value = false
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
  const connection = connections.value.find(entry => entry.id === item.connectionId)
  if (!connection) return
  selectedId.value = connection.id
  browsing.value = false
  showSchedules.value = false
}

async function openHistory(item: AiWorkspaceConversationItem) {
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

watch(browsing, value => { if (value) void refreshRecent() })

onMounted(() => {
  unsubscribe = window.LiteConnect.onAiWorkspaceConnection(onConnection)
  unsubscribeReply = onReplyComplete(() => {
    sessionTick.value += 1
    void refreshRecent()
  })
  void refresh()
})
onBeforeUnmount(() => {
  disposed = true
  unsubscribe?.()
  unsubscribeReply?.()
  if (connectingId.value) void window.LiteConnect.aiCancelWorkspaceConnection(connectingId.value).catch(() => {})
  for (const id of Object.values(sessions.value)) {
    void nextTick(() => disposeAiSessionState(id))
    void window.LiteConnect.aiCloseWorkspaceConnection(id).catch(() => {})
  }
})
</script>

<template>
  <div class="ai-workspace" :class="{ 'is-schedule': showSchedules }">
    <aside class="ai-workspace-rail" :class="{ collapsed: railCollapsed }">
      <header>
        <AppIcon v-if="!railCollapsed" name="ai-chat" size="sm" />
        <strong v-if="!railCollapsed">LiteAI</strong>
        <button v-if="!railCollapsed" type="button" class="ui-icon-btn" :title="t('ai.workspace.refresh')" :disabled="loading" @click="refresh"><AppIcon name="refresh" size="sm" /></button>
        <button type="button" class="ui-icon-btn rail-collapse" :title="t(railCollapsed ? 'ai.workspace.expandRail' : 'ai.workspace.collapseRail')" :aria-label="t(railCollapsed ? 'ai.workspace.expandRail' : 'ai.workspace.collapseRail')" :aria-expanded="!railCollapsed" @click="railCollapsed = !railCollapsed"><AppIcon :name="railCollapsed ? 'chevron-right' : 'chevron-left'" size="xs" /></button>
      </header>
      <nav class="workspace-primary-nav" :aria-label="t('ai.workspace.navigation')">
        <button type="button" class="workspace-manage workspace-host-entry" :class="{ active: browsing && !showSchedules }" :aria-current="browsing && !showSchedules ? 'page' : undefined" :title="t('ai.schedule.host')" @click="backToHosts"><AppIcon name="server" size="sm" /><span v-if="!railCollapsed">{{ t('ai.schedule.host') }}</span></button>
        <button v-if="sessionId" type="button" class="workspace-manage workspace-chat-entry" :class="{ active: !browsing && !showSchedules }" :aria-current="!browsing && !showSchedules ? 'page' : undefined" :title="t('ai.workspace.currentChats')" @click="showSchedules = false; browsing = false"><AppIcon name="ai-chat" size="sm" /><span v-if="!railCollapsed">{{ t('ai.workspace.currentChats') }}</span></button>
        <button type="button" class="workspace-manage workspace-schedule-entry" :class="{ active: showSchedules }" :aria-current="showSchedules ? 'page' : undefined" :title="t('ai.schedule.title')" @click="openSchedules()"><AppIcon name="activity" size="sm" /><span v-if="!railCollapsed">{{ t('ai.schedule.title') }}</span></button>
      </nav>
      <section v-show="!railCollapsed" class="rail-section">
        <div class="rail-section-head">
          <h3>{{ t('ai.workspace.currentChats') }}</h3>
          <button
            type="button"
            class="ui-btn ui-btn-xs rail-new-host"
            :title="t('ai.workspace.newOnOther')"
            :disabled="!!connectingId || closing || !connections.length"
            :aria-label="t('ai.workspace.newOnOther')"
            @click="openHostPicker('new')"
          >
            <AppIcon name="plus" size="xs" /><span>{{ t('ai.workspace.otherHost') }}</span>
          </button>
        </div>
        <p v-if="!currentConversations.length" class="rail-empty">{{ t('ai.workspace.noCurrentChats') }}</p>
        <button
          v-for="item in currentConversations"
          :key="item.sessionId"
          type="button"
          class="rail-item"
          :class="{ active: item.viewing && !showSchedules && !browsing }"
          @click="openCurrent(item)"
        >
          <span class="rail-item-title">{{ item.title }}</span>
          <span class="rail-item-meta">{{ item.hostLabel }}</span>
        </button>
      </section>

      <section v-show="!railCollapsed" class="rail-section rail-history">
        <h3>{{ t('ai.workspace.recentChats') }}</h3>
        <p v-if="!historyConversations.length" class="rail-empty">{{ t('ai.workspace.noRecentChats') }}</p>
        <button
          v-for="item in historyConversations"
          :key="`${item.connectionId}:${item.threadId}`"
          type="button"
          class="rail-item"
          @click="openHistory(item)"
        >
          <span class="rail-item-title">{{ item.title }}</span>
          <span class="rail-item-meta">{{ item.hostLabel }} · {{ formatTime(item.updatedAt) }}</span>
        </button>
      </section>

      <nav class="workspace-nav">
        <button type="button" class="workspace-manage" :title="t('ai.workspace.manageConnections')" @click="emit('open-connections')"><AppIcon name="settings" size="sm" /><span v-if="!railCollapsed">{{ t('ai.workspace.manageConnections') }}</span></button>
      </nav>
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
        <header v-if="selected" class="workspace-target">
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
          <span class="workspace-target-status">{{ connectingId === selected.id ? t('ai.workspace.connecting') : sessionId ? t('ai.workspace.connected') : t('ai.workspace.disconnected') }}</span>
          <button v-if="connectingId === selected.id" type="button" class="ui-btn ui-btn-xs" @click="cancelConnect">{{ t('common.cancel') }}</button>
          <button v-else-if="sessionId" type="button" class="ui-btn ui-btn-xs" :disabled="closing" @click="disconnect()">{{ t('ai.workspace.disconnect') }}</button>
        </header>
        <p v-if="error && sessionId" class="workspace-error inset" role="alert">{{ error }}</p>
        <div v-if="sessionId" class="lite-ai-chat">
          <AiSidebar
            :session-id="sessionId"
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
        <header class="workspace-browser-header">
          <div>
            <h2>{{ t('ai.workspace.browseTitle') }}</h2>
            <p>{{ t('ai.workspace.browseHint') }}</p>
          </div>
          <div class="workspace-toolbar">
            <input v-model="query" class="workspace-search" :placeholder="t('ai.workspace.search')" :aria-label="t('ai.workspace.search')" />
            <div class="workspace-view-switch" role="group" :aria-label="t('ai.workspace.viewMode')">
              <button type="button" data-view="cards" :class="{ active: hostView === 'cards' }" :aria-pressed="hostView === 'cards'" @click="hostView = 'cards'"><AppIcon name="home-grid" size="sm" />{{ t('ai.workspace.cardViewLabel') }}</button>
              <button type="button" data-view="list" :class="{ active: hostView === 'list' }" :aria-pressed="hostView === 'list'" @click="hostView = 'list'"><AppIcon name="list" size="sm" />{{ t('ai.workspace.listViewLabel') }}</button>
            </div>
          </div>
        </header>

        <div class="workspace-stats">
          <span>{{ t('ai.workspace.hostTotal', { count: visible.length }) }}</span>
          <span v-if="connectedCount">{{ t('ai.workspace.connectedCount', { count: connectedCount }) }}</span>
          <span>{{ t('ai.workspace.groupTotal', { count: groupedHosts.length }) }}</span>
        </div>

        <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
        <p v-if="loading" class="workspace-caption">{{ t('common.loading') }}</p>
        <p v-else-if="!visible.length" class="workspace-empty">
          {{ t('ai.workspace.noConnections') }}
          <button type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click="emit('open-connections')">{{ t('ai.workspace.manageConnections') }}</button>
        </p>

        <section v-for="section in groupedHosts" :key="section.id" class="workspace-group">
          <button type="button" class="workspace-group-header" @click="toggleGroup(section.id)">
            <AppIcon :name="isCollapsed(section.id) ? 'chevron-right' : 'chevron-down'" size="xs" />
            <strong>{{ section.name }}</strong>
            <span>{{ t('ai.workspace.groupCount', { count: section.hosts.length }) }}</span>
          </button>
          <div v-show="!isCollapsed(section.id)" class="workspace-card-grid" :class="{ 'is-list': hostView === 'list' }">
            <article
              v-for="connection in section.hosts"
              :key="connection.id"
              class="workspace-card"
              :class="{
                selected: selectedId === connection.id,
                connected: !!sessions[connection.id],
                connecting: connectingId === connection.id,
              }"
              tabindex="0"
              @keydown.enter.self.prevent="startChat(connection)"
              @keydown.space.self.prevent="selectHost(connection)"
              @click="selectHost(connection)"
              @dblclick="startChat(connection)"
            >
              <div class="workspace-card-top">
                <AppIcon name="server" size="sm" />
                <strong>{{ connection.name }}</strong>
                <span v-if="sessions[connection.id]" class="workspace-card-status connected">{{ t('ai.workspace.connected') }}</span>
                <span v-else-if="connectingId === connection.id" class="workspace-card-status connecting">{{ t('ai.workspace.connecting') }}</span>
              </div>
              <p>{{ connection.username }}@{{ connection.host }}:{{ connection.port || 22 }}</p>
              <p v-if="connection.note" class="workspace-card-note">{{ connection.note }}</p>
              <div class="workspace-card-actions" @click.stop @dblclick.stop>
                <button v-if="connectingId === connection.id" type="button" class="ui-btn ui-btn-xs" @click="cancelConnect">{{ t('common.cancel') }}</button>
                <template v-else>
                  <button type="button" class="ui-btn ui-btn-primary ui-btn-xs" :disabled="closing || !!connectingId" @click="startChat(connection)">{{ sessions[connection.id] ? t('ai.workspace.continueChat') : t('ai.workspace.startChat') }}</button>
                  <button v-if="sessions[connection.id]" type="button" class="ui-btn ui-btn-xs" :disabled="closing || !!connectingId" @click="disconnect(connection.id)">{{ t('ai.workspace.disconnect') }}</button>
                </template>
              </div>
            </article>
          </div>
        </section>


      </div>
    </main>

    <div v-if="hostPicker && !showSchedules" class="host-picker-layer" @keydown.esc.prevent="closeHostPicker">
      <button type="button" class="host-picker-backdrop" :aria-label="t('common.cancel')" @click="closeHostPicker" />
      <section class="host-picker" role="dialog" :aria-label="hostPicker === 'new' ? t('ai.workspace.newOnOtherTitle') : t('ai.workspace.switchHost')">
        <header>
          <div>
            <h3>{{ hostPicker === 'new' ? t('ai.workspace.newOnOtherTitle') : t('ai.workspace.switchHost') }}</h3>
            <p>{{ hostPicker === 'new' ? t('ai.workspace.newOnOtherHint') : t('ai.workspace.switchHostHint') }}</p>
          </div>
          <button type="button" class="ui-icon-btn" :title="t('common.cancel')" @click="closeHostPicker"><AppIcon name="close" size="sm" /></button>
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
          <button
            v-for="connection in pickerHosts"
            :key="connection.id"
            type="button"
            class="host-picker-item"
            :class="{ connected: !!sessions[connection.id], current: connection.id === selectedId }"
            :disabled="!!connectingId || closing"
            @click="pickHost(connection)"
          >
            <span class="host-picker-item-main">
              <strong>{{ connection.name }}</strong>
              <span>{{ connection.username }}@{{ connection.host }}:{{ connection.port || 22 }}</span>
            </span>
            <span class="host-picker-item-meta">
              <span v-if="connection.id === selectedId">{{ t('ai.workspace.currentHost') }}</span>
              <span v-else-if="sessions[connection.id]">{{ t('ai.workspace.connected') }}</span>
              <span>{{ hostPicker === 'new' ? t('ai.workspace.openNewAction') : t('ai.workspace.switchHostAction') }}</span>
            </span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ai-workspace { position: relative; display: flex; height: 100%; min-height: 0; min-width: 0; background: var(--bg-primary); color: var(--text-primary); }
.ai-workspace-rail { display: flex; flex-direction: column; width: 248px; flex-shrink: 0; padding: 16px 12px; border-right: 1px solid var(--border-color); background: var(--bg-secondary); min-height: 0; }
.ai-workspace-rail > header { display: flex; align-items: center; gap: 8px; font-size: 15px; margin-bottom: 14px; }
.ai-workspace-rail > header button { margin-left: auto; }
.rail-section { display: flex; flex-direction: column; gap: 4px; min-height: 0; }
.rail-section-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.rail-section h3,
.rail-section-head h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-secondary); }
.rail-section-head h3 { margin: 0; flex: 1; }
.rail-history { flex: 1; min-height: 0; margin-top: 16px; overflow: auto; }
.rail-empty { margin: 0; padding: 8px 4px; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.rail-item { display: flex; flex-direction: column; gap: 4px; width: 100%; text-align: left; padding: 9px 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text-primary); cursor: pointer; font: inherit; }
.rail-item:hover, .rail-item.active { background: var(--accent-bg); border-color: var(--accent); }
.rail-item-title { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail-item-meta { font-size: 11px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workspace-nav { margin-top: auto; display: flex; flex-direction: column; gap: 2px; padding-top: 12px; }
.workspace-manage { display: flex; align-items: center; justify-content: space-between; padding: 8px; border: 0; border-radius: 7px; color: var(--text-secondary); background: transparent; cursor: pointer; font-size: 12px; }
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
.host-picker-search { width: 100%; }
.host-picker-list { display: flex; flex-direction: column; gap: 4px; overflow: auto; min-height: 0; }
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
.host-picker-item-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; color: var(--text-secondary); font-size: 11px; }
.lite-ai-chat { display: flex; flex: 1; min-height: 0; min-width: 0; width: 100%; max-width: 1100px; margin: 0 auto; }
.lite-ai-chat :deep(.ai-sidebar) { width: 100%; max-width: none; min-width: 0; border-left: 0; flex: 1; }
.workspace-browser { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; padding: 18px 20px; overflow: auto; }
.workspace-browser-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
.workspace-browser-header h2 { margin: 0 0 4px; font-size: 20px; }
.workspace-browser-header p { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; max-width: 520px; }
.workspace-toolbar { display: flex; flex-wrap: nowrap; flex: 0 1 440px; width: 440px; max-width: 100%; min-width: 0; margin-left: auto; gap: 8px; align-items: center; }
.workspace-toolbar > .workspace-search { flex: 1 1 0; width: 0; min-width: 0; height: 36px; }
.workspace-search { width: min(260px, 100%); box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 7px; color: var(--text-primary); background: var(--bg-secondary); font: inherit; font-size: 12px; }
.workspace-stats { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-bottom: 16px; color: var(--text-secondary); font-size: 12px; }
.workspace-caption { color: var(--text-secondary); font-size: 12px; }
.workspace-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; color: var(--text-secondary); font-size: 13px; }
.workspace-group { margin-bottom: 18px; }
.workspace-group-header { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 2px; border: 0; background: transparent; color: var(--text-primary); cursor: pointer; font: inherit; }
.workspace-group-header strong { font-size: 13px; }
.workspace-group-header span { color: var(--text-secondary); font-size: 12px; }
.workspace-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.workspace-card { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg-secondary); cursor: pointer; text-align: left; min-width: 0; }
.workspace-card:hover, .workspace-card.selected { border-color: var(--accent); background: var(--accent-bg); }
.workspace-card.connected { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--success) 35%, transparent); }
.workspace-card-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.workspace-card-top strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.workspace-card p { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.workspace-card-note { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.workspace-card-status { flex-shrink: 0; font-size: 11px; padding: 2px 7px; border-radius: 999px; background: var(--bg-primary); color: var(--text-secondary); }
.workspace-card-status.connected { color: var(--success); background: color-mix(in srgb, var(--success) 14%, transparent); }
.workspace-card-status.connecting { color: var(--accent); background: var(--accent-bg); }
.workspace-card-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 4px; }
.workspace-error { padding: 10px 0; margin: 0; color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }
.workspace-error.inset { padding-left: 20px; padding-right: 20px; }
@media (max-width: 900px) {
  .ai-workspace-rail { width: 200px; }
  .workspace-browser { padding: 16px 14px; }
  .workspace-search { width: 100%; }
}
@media (max-width: 640px) {
  .workspace-card-grid { grid-template-columns: 1fr; }
}
.workspace-primary-nav { display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px; }
.workspace-primary-nav .workspace-manage, .workspace-nav .workspace-manage { justify-content: flex-start; gap: 8px; }
.workspace-manage.active { color: var(--accent); background: var(--accent-bg); }
.ai-workspace-rail.collapsed { width: 46px; padding: 12px 6px; }
.ai-workspace-rail.collapsed > header { justify-content: center; }
.ai-workspace-rail.collapsed > header button { margin: 0; }
.ai-workspace-rail.collapsed .workspace-nav { margin-top: auto; }
.ai-workspace-rail.collapsed .workspace-manage { justify-content: center; padding: 10px 6px; }
.rail-new-host { gap: 4px; }
.workspace-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.workspace-view-switch { display: inline-flex; flex-shrink: 0; align-items: center; padding: 3px; gap: 2px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); }
.workspace-view-switch button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 5px 9px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.workspace-view-switch button:hover { background: var(--hover-bg); color: var(--text-primary); }
.workspace-view-switch button.active { color: var(--accent); background: var(--accent-bg); border-color: color-mix(in srgb, var(--accent) 25%, transparent); }
.workspace-view-switch button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.workspace-card-grid.is-list { grid-template-columns: 1fr; }
.is-list .workspace-card { display: grid; grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr) auto; gap: 6px 14px; align-items: center; }
.is-list .workspace-card-actions { grid-column: 3; grid-row: 1 / 3; padding: 0; margin: 0; }
.is-list .workspace-card-note { grid-column: 1 / 3; }
@media(max-width:900px) { .is-list .workspace-card { grid-template-columns: minmax(0,1fr) auto; } .is-list .workspace-card > p { grid-column: 1; } .is-list .workspace-card-actions { grid-column: 2; } }
</style>
