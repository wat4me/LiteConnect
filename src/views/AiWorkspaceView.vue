<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Connection, Group } from '@shared/types/connection'
import type { AiWorkspaceConnectionEvent } from '@shared/aiWorkspace'
import { isSshHostKeyConfirmationRequired } from '@shared/sshHostKeyConfirmation'
import { isSshConnectionCancelled } from '@shared/sshConnectionProgress'
import { disposeAiSessionState, useAiChat } from '@/composables/ai/useAiChat'
import { appConfirm } from '@/composables/app/useAppDialog'
import { ElMessage } from 'element-plus/es/components/message/index'
import AiSidebar from '@/components/ai/AiSidebar.vue'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const emit = defineEmits<{ (event: 'open-connections'): void }>()
const { t } = useI18n()
const { getSessionState } = useAiChat()
const connections = ref<Connection[]>([])
const groups = ref<Group[]>([])
const query = ref('')
const selectedId = ref('')
const connectingId = ref('')
const sessions = ref<Record<string, string>>({})
const error = ref('')
const loading = ref(false)
const closing = ref(false)
let disposed = false
let unsubscribe: (() => void) | undefined
const selected = computed(() => connections.value.find(connection => connection.id === selectedId.value))
const sessionId = computed(() => sessions.value[selectedId.value] || '')
const visible = computed(() => {
  const text = query.value.trim().toLocaleLowerCase()
  return connections.value.filter(connection => !text || `${connection.name} ${connection.host} ${connection.username}`.toLocaleLowerCase().includes(text))
})
function groupName(connection: Connection) { return groups.value.find(group => group.id === connection.group)?.name || '' }

async function refresh() {
  loading.value = true
  try {
    const [hosts, hostGroups] = await Promise.all([window.LiteConnect.getConnections(), window.LiteConnect.getGroups()])
    if (disposed) return
    connections.value = hosts
    groups.value = hostGroups
    error.value = ''
  } catch (failure: any) { error.value = failure?.message || t('ai.workspace.loadFailed') }
  finally { loading.value = false }
}

function onConnection(event: AiWorkspaceConnectionEvent) {
  if (disposed) return
  if (event.status === 'connected' && event.sessionId) {
    sessions.value[event.connectionId] = event.sessionId
    if (connectingId.value === event.connectionId) connectingId.value = ''
    if (selectedId.value === event.connectionId) error.value = ''
  } else {
    const previous = sessions.value[event.connectionId]
    if (previous) void nextTick(() => disposeAiSessionState(previous))
    delete sessions.value[event.connectionId]
    if (connectingId.value === event.connectionId) connectingId.value = ''
  }
}

async function connect(connection: Connection) {
  if (connectingId.value || closing.value) return
  selectedId.value = connection.id
  error.value = ''
  if (sessions.value[connection.id]) return
  connectingId.value = connection.id
  let waitingForTrust = false
  try {
    const id = await window.LiteConnect.aiOpenWorkspaceConnection(connection.id)
    if (!disposed) onConnection({ connectionId: connection.id, sessionId: id, status: 'connected' })
  } catch (failure: any) {
    if (isSshHostKeyConfirmationRequired(failure)) waitingForTrust = true
    else if (!isSshConnectionCancelled(failure)) error.value = failure?.message || t('ai.workspace.connectFailed')
  } finally {
    if (!waitingForTrust && connectingId.value === connection.id) connectingId.value = ''
  }
}

async function cancelConnect() {
  const id = connectingId.value
  if (!id) return
  try { await window.LiteConnect.aiCancelWorkspaceConnection(id) }
  catch (failure: any) { ElMessage.warning(failure?.message || t('ai.workspace.connectFailed')) }
}

async function disconnect() {
  const id = sessionId.value
  const connectionId = selectedId.value
  if (!id || closing.value) return
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

onMounted(() => {
  unsubscribe = window.LiteConnect.onAiWorkspaceConnection(onConnection)
  void refresh()
})
onBeforeUnmount(() => {
  disposed = true
  unsubscribe?.()
  if (connectingId.value) void window.LiteConnect.aiCancelWorkspaceConnection(connectingId.value).catch(() => {})
  for (const id of Object.values(sessions.value)) {
    void nextTick(() => disposeAiSessionState(id))
    void window.LiteConnect.aiCloseWorkspaceConnection(id).catch(() => {})
  }
})
</script>

<template>
  <div class="ai-workspace">
    <aside class="ai-workspace-hosts">
      <header><AppIcon name="ai-chat" size="sm" /><strong>LiteAI</strong><button type="button" class="ui-icon-btn" :title="t('ai.workspace.refresh')" :disabled="loading" @click="refresh"><AppIcon name="refresh" size="sm" /></button></header>
      <p class="workspace-caption">{{ t('ai.workspace.hostsHint') }}</p>
      <input v-model="query" class="workspace-search" :placeholder="t('ai.workspace.search')" :aria-label="t('ai.workspace.search')" />
      <div class="workspace-host-list">
        <p v-if="loading" class="workspace-caption">{{ t('common.loading') }}</p>
        <button v-for="connection in visible" :key="connection.id" type="button" class="workspace-host" :class="{ selected: selectedId === connection.id }" :disabled="!!connectingId || closing" :aria-pressed="selectedId === connection.id" @click="connect(connection)">
          <span class="workspace-host-title"><AppIcon name="server" size="sm" /><strong>{{ connection.name }}</strong><span v-if="sessions[connection.id]" class="workspace-connected-dot" :title="t('ai.workspace.connected')"></span></span>
          <span class="workspace-host-address">{{ connection.username }}@{{ connection.host }}:{{ connection.port || 22 }}</span>
          <span v-if="groupName(connection)" class="workspace-host-group">{{ groupName(connection) }}</span>
        </button>
        <p v-if="!loading && !visible.length" class="workspace-caption">{{ t('ai.workspace.noConnections') }}</p>
      </div>
      <button type="button" class="workspace-manage" @click="emit('open-connections')">{{ t('ai.workspace.manageConnections') }}<AppIcon name="chevron-right" size="xs" /></button>
    </aside>
    <main class="ai-workspace-main">
      <header v-if="selected" class="workspace-target">
        <div><strong>{{ selected.name }}</strong><span>{{ selected.username }}@{{ selected.host }}</span></div>
        <span class="workspace-target-status">{{ connectingId ? t('ai.workspace.connecting') : sessionId ? t('ai.workspace.connected') : t('ai.workspace.disconnected') }}</span>
        <button v-if="connectingId" type="button" class="ui-btn ui-btn-xs" @click="cancelConnect">{{ t('common.cancel') }}</button>
        <button v-else-if="sessionId" type="button" class="ui-btn ui-btn-xs" :disabled="closing" @click="disconnect">{{ t('ai.workspace.disconnect') }}</button>
      </header>
      <p v-if="error" class="workspace-error" role="alert">{{ error }}</p>
      <div v-if="sessionId" class="lite-ai-chat">
        <AiSidebar :session-id="sessionId" :active="props.active" workspace />
      </div>
      <div v-else class="workspace-welcome">
        <AppIcon name="ai-chat" size="xl" />
        <h2>{{ connectingId ? t('ai.workspace.connectingTitle') : t('ai.workspace.welcome') }}</h2>
        <p>{{ connectingId ? t('ai.workspace.connectingHint') : t('ai.workspace.welcomeHint') }}</p>
        <button v-if="!connectingId && selected" type="button" class="ui-btn ui-btn-primary" @click="connect(selected)">{{ t('ai.workspace.retryConnect') }}</button>
        <button v-else-if="!connectingId && !connections.length" type="button" class="ui-btn" @click="emit('open-connections')">{{ t('ai.workspace.manageConnections') }}</button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.ai-workspace { display: flex; height: 100%; min-height: 0; min-width: 0; background: var(--bg-primary); color: var(--text-primary); }
.ai-workspace-hosts { display: flex; flex-direction: column; width: 236px; flex-shrink: 0; padding: 16px 12px; border-right: 1px solid var(--border-color); background: var(--bg-secondary); min-height: 0; }
.ai-workspace-hosts > header { display: flex; align-items: center; gap: 8px; font-size: 15px; }
.ai-workspace-hosts > header button { margin-left: auto; }
.workspace-caption { color: var(--text-secondary); font-size: 12px; line-height: 1.5; margin: 10px 2px; }
.workspace-search { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 7px; color: var(--text-primary); background: var(--bg-primary); font: inherit; font-size: 12px; }
.workspace-host-list { flex: 1; overflow-y: auto; min-height: 0; margin-top: 10px; }
.workspace-host { display: flex; flex-direction: column; gap: 5px; width: 100%; text-align: left; padding: 10px; margin: 3px 0; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text-primary); cursor: pointer; }
.workspace-host:hover, .workspace-host.selected { background: var(--accent-bg); border-color: var(--accent); }
.workspace-host:disabled { cursor: default; }
.workspace-host-title { display: flex; align-items: center; gap: 7px; width: 100%; min-width: 0; }
.workspace-host-title strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.workspace-connected-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); flex-shrink: 0; }
.workspace-host-address, .workspace-host-group { color: var(--text-secondary); font-size: 11px; overflow-wrap: anywhere; }
.workspace-manage { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding: 8px; border: 0; color: var(--text-secondary); background: transparent; cursor: pointer; font-size: 12px; }
.ai-workspace-main { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.workspace-target { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border-color); font-size: 12px; }
.workspace-target > div { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px 10px; overflow-wrap: anywhere; }
.workspace-target > div > span, .workspace-target-status { color: var(--text-secondary); }
.workspace-target-status { flex-shrink: 0; }
.lite-ai-chat { display: flex; flex: 1; min-height: 0; min-width: 0; width: 100%; max-width: 1100px; margin: 0 auto; }
.lite-ai-chat :deep(.ai-sidebar) { width: 100%; max-width: none; min-width: 0; border-left: 0; flex: 1; }
.workspace-welcome { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; padding: 28px; text-align: center; color: var(--text-secondary); }
.workspace-welcome h2 { color: var(--text-primary); font-size: 20px; font-weight: 600; margin: 16px 0 8px; }
.workspace-welcome p { max-width: 420px; font-size: 13px; line-height: 1.7; }
.workspace-error { padding: 10px 20px; margin: 0; color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }
@media (max-width: 760px) { .ai-workspace-hosts { width: 180px; padding: 12px 8px; } .workspace-target { padding: 10px 12px; gap: 8px; } .workspace-target-status { display: none; } }
</style>
