<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Connection } from '@shared/types/connection'
import type { AiWorkspaceConversationItem } from '@shared/aiWorkspaceConversations'
import type { AiPendingAction } from '@/utils/ai/pendingAction'
import AppIcon from '@/components/icons/AppIcon.vue'
import AiWorkspaceChatPane from '@/components/ai/AiWorkspaceChatPane.vue'
import AiWorkspaceHostPicker from '@/components/ai/AiWorkspaceHostPicker.vue'
import AiSettingsPanel from '@/components/ai/AiSettingsPanel.vue'
import AiSchedulePanel from '@/components/ai/AiSchedulePanel.vue'
import ConnectionsAiDraft from './ConnectionsAiDraft.vue'
import { useAiWorkspace } from '@/composables/ai/workspace/useAiWorkspace'
import { useAiChat } from '@/composables/ai/useAiChat'

const props = defineProps<{
  active: boolean
  open: boolean
  refreshToken?: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'connect', connectionId: string): void
}>()

const { t } = useI18n()
const { settings, refreshSettings, replaceSettings } = useAiChat()

const {
  connections,
  error,
  loading,
  connectingId,
  closing,
  selectedId,
  browsing,
  activeScope,
  scopeTargets,
  scopeReady,
  scopeBusy,
  pickerError,
  selectionLocked,
  revealGeneration,
  sessions,
  currentConversations,
  pendingConversationCount,
  historyConversations,
  historySections,
  historyExpanded,
  HISTORY_PREVIEW_COUNT,
  toggleHistory,
  selected,
  sessionId,
  hostPicker,
  pickerQuery,
  pickerElement,
  pickerHosts,
  pickerGroups,
  pickerSelection,
  isPickerGroupCollapsed,
  togglePickerGroup,
  trapPickerFocus,
  openHostPicker,
  closeHostPicker,
  pickHost,
  openScope,
  openCurrent,
  openHistory,
  closeConversation,
  startChat,
  retryConnect,
  cancelConnect,
  disconnect,
  refresh,
  refreshRecent,
  hasConversation,
  revealConversation,
  showSchedules,
  scheduleCreateToken,
  openSchedules,
} = useAiWorkspace({ active: () => props.active && props.open })

const rootRef = ref<HTMLElement | null>(null)
const backButton = ref<HTMLButtonElement | null>(null)
const draftRef = ref<InstanceType<typeof ConnectionsAiDraft> | null>(null)
const hostPickerRef = ref<InstanceType<typeof AiWorkspaceHostPicker> | null>(null)
watchEffect(() => { pickerElement.value = hostPickerRef.value?.pickerEl ?? null })

/* ---------- Layout: the rail docks beside the chat, or floats on narrow windows ---------- */
const width = ref(1200)
const narrow = computed(() => width.value < 760)
const railOpen = ref(false)
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(([entry]) => { if (entry?.contentRect.width) width.value = entry.contentRect.width })
  if (rootRef.value) observer.observe(rootRef.value)
})
onBeforeUnmount(() => observer?.disconnect())
watch(narrow, value => { if (!value) railOpen.value = false })
function closeRailIfFloating() { if (narrow.value) railOpen.value = false }

/* ---------- Draft: a conversation that connects when its first message is sent ---------- */
type Draft = { connectionIds: string[]; text: string }
const draft = ref<Draft | null>(null)
const draftVisible = ref(false)
const draftStatus = ref<'idle' | 'connecting' | 'error'>('idle')
const draftError = ref('')
const pendingSend = ref<{ connectionIds: string[]; text: string } | null>(null)
const sendRequest = ref<{ id: number; sessionId: string; text: string; mode: 'send' } | null>(null)
let sending = false
let requestSeq = 0

const draftHosts = computed(() => (draft.value?.connectionIds || []).flatMap(id => connections.value.find(host => host.id === id) || []))
const draftRecent = computed(() => {
  const ids = draft.value?.connectionIds
  if (!ids || ids.length !== 1) return []
  return historyConversations.value.filter(item => !item.workspaceId && item.connectionId === ids[0]).slice(0, 3)
})
const configured = computed(() => (settings.value.providers || []).some(p => (p.apiKey || '').trim() && (p.baseUrl || '').trim()))
const draftText = computed({
  get: () => draft.value?.text ?? '',
  set: value => { if (draft.value) draft.value.text = value },
})

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every(id => b.includes(id))
}

function showDraft(connectionIds: string[]) {
  showSchedules.value = false
  if (!draft.value || !sameIds(draft.value.connectionIds, connectionIds)) {
    draft.value = { connectionIds: [...connectionIds], text: '' }
    draftStatus.value = 'idle'
    draftError.value = ''
  }
  draftVisible.value = true
  closeRailIfFloating()
  void nextTick(() => draftRef.value?.focus())
}

function discardDraft() {
  if (draftStatus.value === 'connecting') return
  draft.value = null
  draftVisible.value = false
}

function removeDraftHost(connectionId: string) {
  if (!draft.value || draft.value.connectionIds.length <= 1) return
  draft.value.connectionIds = draft.value.connectionIds.filter(id => id !== connectionId)
}

/** Hands the queued text to the conversation once the matching target is ready. */
function tryDeliver() {
  const pending = pendingSend.value
  if (!pending) return
  const single = pending.connectionIds.length === 1
  const matches = single
    ? !activeScope.value && selectedId.value === pending.connectionIds[0]
    : !!activeScope.value && sameIds(activeScope.value.connectionIds, pending.connectionIds)
  if (matches && sessionId.value && !browsing.value && !selectionLocked.value) {
    sendRequest.value = { id: ++requestSeq, sessionId: sessionId.value, text: pending.text, mode: 'send' }
    pendingSend.value = null
    draft.value = null
    draftVisible.value = false
    draftStatus.value = 'idle'
    return
  }
  // A single host may still be waiting for host-key or credential confirmation.
  if (sending || selectionLocked.value) return
  if (single && connectingId.value === pending.connectionIds[0]) return
  failDraft()
}

function failDraft() {
  pendingSend.value = null
  const message = error.value || pickerError.value
  draftStatus.value = message ? 'error' : 'idle'
  draftError.value = message
}

watch([pendingSend, sessionId, selectionLocked, browsing, connectingId], () => { if (!sending) tryDeliver() })

async function sendDraft() {
  const current = draft.value
  const text = current?.text.trim()
  if (!current || !text || selectionLocked.value || !configured.value) return
  const hosts = draftHosts.value
  if (!hosts.length) return
  draftStatus.value = 'connecting'
  draftError.value = ''
  error.value = ''
  pickerError.value = ''
  pendingSend.value = { connectionIds: hosts.map(host => host.id), text }
  sending = true
  try {
    if (hosts.length === 1) await startChat(hosts[0], '', true)
    else await openScope({ connectionIds: hosts.map(host => host.id) })
  } finally {
    sending = false
  }
  tryDeliver()
}

async function cancelDraftConnect() {
  await cancelConnect()
}

/* ---------- Navigation between rail entries ---------- */
const view = computed<'schedules' | 'draft' | 'chat' | 'empty'>(() => {
  if (showSchedules.value) return 'schedules'
  if (draft.value && draftVisible.value) return 'draft'
  if (!browsing.value && (sessionId.value || connectingId.value || error.value)) return 'chat'
  return 'empty'
})

async function openForConnections(hosts: Connection[]) {
  if (!hosts.length) return
  pickerError.value = ''
  if (hosts.length === 1) {
    const existing = currentConversations.value.find(item => item.hostCount <= 1 && item.connectionId === hosts[0].id)
    if (existing) {
      draftVisible.value = false
      await openCurrent(existing)
      return
    }
  }
  showDraft(hosts.map(host => host.id))
}

async function selectCurrent(item: (typeof currentConversations.value)[number]) {
  draftVisible.value = false
  showSchedules.value = false
  closeRailIfFloating()
  if (item.pendingAction) revealConversation(item.sessionId)
  else await openCurrent(item)
}

async function selectHistory(item: AiWorkspaceConversationItem) {
  draftVisible.value = false
  closeRailIfFloating()
  await openHistory(item)
}

function selectDraft() {
  showSchedules.value = false
  draftVisible.value = true
  closeRailIfFloating()
}

function newConversation() {
  closeRailIfFloating()
  openHostPicker('create', draft.value?.connectionIds || activeScope.value?.connectionIds || (selectedId.value ? [selectedId.value] : []))
}

function selectSchedules() {
  closeRailIfFloating()
  openSchedules()
}

function startFromPicker(connectionIds: string[]) {
  const hosts = connectionIds.flatMap(id => connections.value.find(host => host.id === id) || [])
  closeHostPicker()
  if (!hosts.length) return
  if (draft.value && draftStatus.value !== 'connecting') draft.value = null
  void openForConnections(hosts)
}

const terminalTarget = computed(() => {
  if (selected.value) return { connectionId: selected.value.id, name: selected.value.name }
  return scopeTargets.value?.find(target => !!target.sessionId) ?? scopeTargets.value?.[0]
})

const disconnectedScopeTargets = computed(() => scopeTargets.value?.filter(target => !target.sessionId) ?? [])
const disconnectedScopeNames = computed(() => disconnectedScopeTargets.value.map(target => target.name).join(t('ai.workspace.scopeHostSeparator')))

function pendingActionHint(action: AiPendingAction) {
  return t(action === 'approval' ? 'ai.activity.approval' : action === 'question' ? 'ai.activity.question' : 'ai.workspace.pendingMixed')
}

/* ---------- Model settings modal ---------- */
const showModelSettings = ref(false)
const modelSettingsRef = ref<InstanceType<typeof AiSettingsPanel> | null>(null)
async function openModelSettings() {
  try { await refreshSettings() } catch { /* the panel shows its own load error */ }
  showModelSettings.value = true
}
function requestCloseModelSettings() {
  if (modelSettingsRef.value) void modelSettingsRef.value.goBack()
  else showModelSettings.value = false
}

watch(() => props.open, async open => {
  if (!open) return
  void refreshSettings().catch(() => {})
  await nextTick()
  if (view.value === 'draft') draftRef.value?.focus()
  else if (!narrow.value) backButton.value?.focus({ preventScroll: true })
}, { immediate: true })

watch(() => props.refreshToken, (next, prev) => {
  if (next !== undefined && next !== prev) void refresh()
})

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  if (showModelSettings.value || hostPicker.value) return
  if (railOpen.value) { railOpen.value = false; event.preventDefault() }
}

const busy = computed(() => loading.value || selectionLocked.value)

defineExpose({
  busy,
  pendingCount: pendingConversationCount,
  openCount: computed(() => currentConversations.value.length),
  openForConnections,
  showSessions: () => {
    showSchedules.value = false
    if (narrow.value && view.value === 'empty') railOpen.value = true
  },
  hasConversation,
  revealConversation(id: string) {
    if (!revealConversation(id)) return false
    draftVisible.value = false
    return true
  },
})
</script>

<template>
  <section
    ref="rootRef"
    class="connections-ai-workspace"
    :class="{ narrow, 'rail-open': railOpen }"
    :aria-label="t('connections.aiWorkspaceTitle')"
    @keydown="onKeydown"
  >
    <Teleport to="body">
      <div
        v-if="showModelSettings"
        class="ai-model-settings-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="t('ai.manageModels')"
        @click.self="requestCloseModelSettings"
        @keydown.esc.stop.prevent="requestCloseModelSettings"
      >
        <div class="ai-model-settings-modal">
          <AiSettingsPanel
            ref="modelSettingsRef"
            :model-value="settings"
            layout="modal"
            @saved="replaceSettings"
            @close="showModelSettings = false"
          />
        </div>
      </div>
    </Teleport>

    <button v-if="narrow && railOpen" type="button" class="ai-rail-backdrop" :aria-label="t('common.close')" @click="railOpen = false" />

    <aside v-show="!narrow || railOpen" class="ai-rail" :aria-label="t('connections.aiSessions')">
      <div class="ai-rail-top">
        <button ref="backButton" type="button" class="ui-btn ui-btn-ghost ui-btn-sm ai-back-to-connections" @click="emit('close')">
          <AppIcon name="chevron-left" size="sm" />
          <span>{{ t('connections.aiBackToConnections') }}</span>
        </button>
        <button type="button" class="ui-btn ui-btn-sm ai-rail-new" :disabled="selectionLocked || !connections.length" @click="newConversation">
          <AppIcon name="plus" size="sm" />
          <span>{{ t('ai.workspace.newConversationMenu') }}</span>
        </button>
        <button type="button" class="ai-rail-nav" :class="{ active: view === 'schedules' }" :aria-current="view === 'schedules' ? 'page' : undefined" @click="selectSchedules">
          <AppIcon name="calendar-clock" size="sm" />
          <span>{{ t('ai.schedule.title') }}</span>
        </button>
      </div>

      <div class="ai-rail-scroll">
        <section class="ai-rail-section">
          <div class="ai-rail-head">
            <h3>{{ t('ai.workspace.currentChats') }}</h3>
            <span v-if="pendingConversationCount" class="ai-rail-pending" :title="t('ai.workspace.pendingCount', { count: pendingConversationCount })">
              <AppIcon name="bell" size="xs" />{{ pendingConversationCount }}
            </span>
          </div>
          <div v-if="draft" class="ai-rail-row" :class="{ active: view === 'draft' }">
            <button type="button" class="ai-rail-item ai-rail-draft" :aria-current="view === 'draft' ? 'page' : undefined" @click="selectDraft">
              <AppIcon name="edit" size="xs" class="ai-rail-draft-icon" />
              <span class="ai-rail-main">
                <span class="ai-rail-title">{{ draft.text.trim() || t('connections.aiDraftRailTitle') }}</span>
                <span class="ai-rail-meta">{{ draftHosts.map(host => host.name).join(t('ai.workspace.scopeHostSeparator')) }}</span>
              </span>
            </button>
            <button
              type="button"
              class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close ai-rail-close"
              :disabled="draftStatus === 'connecting'"
              :title="t('connections.aiDraftDiscard')"
              :aria-label="t('connections.aiDraftDiscard')"
              @click="discardDraft"
            ><AppIcon name="close" size="xs" /></button>
          </div>
          <p v-if="!draft && !currentConversations.length" class="ai-rail-empty">{{ t('ai.workspace.noCurrentChats') }}</p>
          <div
            v-for="item in currentConversations"
            :key="item.sessionId || item.connectionId"
            class="ai-rail-row"
            :class="{ active: item.viewing && view === 'chat' }"
            :data-session-id="item.sessionId"
          >
            <button
              type="button"
              class="ai-rail-item"
              :disabled="selectionLocked"
              :aria-current="item.viewing && view === 'chat' ? 'page' : undefined"
              :title="`${item.title}\n${item.hostLabel}${item.pendingAction ? '\n' + pendingActionHint(item.pendingAction) : ''}`"
              @click="selectCurrent(item)"
            >
              <span class="ai-rail-dot" :class="{ connected: item.connected }" aria-hidden="true" />
              <span class="ai-rail-main">
                <span class="ai-rail-title">{{ item.title || item.hostLabel }}</span>
                <span class="ai-rail-meta">{{ item.hostLabel }}</span>
              </span>
              <span v-if="item.hostCount > 1" class="ai-rail-badge">{{ t('ai.workspace.hostCountBadge', { count: item.hostCount }) }}</span>
              <span v-if="item.pendingAction" class="ai-rail-bell" role="img" :aria-label="pendingActionHint(item.pendingAction)"><AppIcon name="bell" size="xs" /></span>
            </button>
            <button
              type="button"
              class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close ai-rail-close"
              :disabled="selectionLocked"
              :title="t('ai.workspace.closeNamed', { name: item.title || item.hostLabel })"
              :aria-label="t('ai.workspace.closeNamed', { name: item.title || item.hostLabel })"
              @click.stop="closeConversation(item)"
            ><AppIcon name="close" size="xs" /></button>
          </div>
        </section>

        <section class="ai-rail-section">
          <div class="ai-rail-head">
            <h3>{{ t('ai.workspace.recentChats') }}</h3>
            <span v-if="historyConversations.length" class="ai-rail-count">{{ historyConversations.length }}</span>
          </div>
          <p v-if="!historyConversations.length" class="ai-rail-empty">{{ t('ai.workspace.noRecentChats') }}</p>
          <div v-for="section in historySections" :key="section.label" class="ai-rail-group">
            <h4>{{ section.label }}</h4>
            <button
              v-for="item in section.items"
              :key="`${item.workspaceId || item.connectionId}:${item.threadId}`"
              type="button"
              class="ai-rail-item standalone"
              :disabled="selectionLocked"
              :title="`${item.title}\n${item.hostLabel}`"
              @click="selectHistory(item)"
            >
              <span class="ai-rail-main">
                <span class="ai-rail-title">{{ item.title || item.hostLabel }}</span>
                <span class="ai-rail-meta">{{ item.hostLabel }}</span>
              </span>
              <span v-if="item.connectionIds && item.connectionIds.length > 1" class="ai-rail-badge">{{ t('ai.workspace.hostCountBadge', { count: item.connectionIds.length }) }}</span>
            </button>
          </div>
          <button
            v-if="historyConversations.length > HISTORY_PREVIEW_COUNT"
            type="button"
            class="ui-btn ui-btn-ghost ui-btn-xs ai-rail-more"
            :aria-expanded="historyExpanded"
            @click="toggleHistory"
          >
            <AppIcon :name="historyExpanded ? 'chevron-up' : 'chevron-down'" size="xs" />
            {{ historyExpanded ? t('ai.workspace.collapseHistory') : t('ai.workspace.expandHistory', { count: historyConversations.length - HISTORY_PREVIEW_COUNT }) }}
          </button>
        </section>
      </div>

      <div class="ai-rail-bottom">
        <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm ai-rail-models" @click="openModelSettings">
          <AppIcon name="models" size="sm" />
          <span>{{ t('ai.manageModels') }}</span>
        </button>
      </div>
    </aside>

    <main class="ai-main">
      <AiSchedulePanel
        v-if="view === 'schedules'"
        class="ai-schedules"
        :connections="connections"
        :connection-id="selectedId"
        :create-token="scheduleCreateToken"
        return-to-chat
        @close="showSchedules = false"
      />
      <ConnectionsAiDraft
        v-if="view === 'draft' && draft"
        ref="draftRef"
        v-model:text="draftText"
        :hosts="draftHosts"
        :status="draftStatus"
        :error="draftError"
        :configured="configured"
        :recent="draftRecent"
        :locked="selectionLocked && draftStatus !== 'connecting'"
        :active="props.active && props.open && view === 'draft' && !hostPicker && !showModelSettings"
        @send="sendDraft"
        @cancel-connect="cancelDraftConnect"
        @open-settings="openModelSettings"
        @open-history="selectHistory"
        @remove-host="removeDraftHost"
      >
        <template v-if="narrow" #header-leading>
          <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ai-rail-toggle" :title="t('connections.aiSessions')" :aria-label="t('connections.aiSessions')" @click="railOpen = true">
            <AppIcon name="list" size="sm" />
            <span v-if="pendingConversationCount" class="ai-rail-toggle-dot" aria-hidden="true" />
          </button>
        </template>
        <template #header-trailing>
          <button
            v-if="draftHosts[0]"
            type="button"
            class="ui-btn ui-btn-sm ai-open-terminal"
            :title="t('connections.aiOpenTerminalNamed', { name: draftHosts[0].name })"
            :aria-label="t('connections.aiOpenTerminalNamed', { name: draftHosts[0].name })"
            @click="emit('connect', draftHosts[0].id)"
          >
            <AppIcon name="terminal" size="sm" />
            <span>{{ t('connections.openTerminal') }}</span>
          </button>
        </template>
      </ConnectionsAiDraft>

      <AiWorkspaceChatPane
        v-if="!browsing"
        v-show="view === 'chat'"
        :session-id="sessionId"
        :reveal-generation="revealGeneration"
        :active-scope="activeScope ?? null"
        :scope-targets="scopeTargets"
        :scope-ready="scopeReady"
        :scope-busy="scopeBusy"
        :disconnected-scope-targets="disconnectedScopeTargets"
        :disconnected-scope-names="disconnectedScopeNames"
        :selected="selected"
        :selected-id="selectedId"
        :connecting-id="connectingId"
        :closing="closing"
        :selection-locked="selectionLocked"
        :error="error"
        :active="props.active && props.open && view === 'chat' && !hostPicker && !showModelSettings"
        :selection-request="sendRequest"
        hide-switch-host
        @request-other-host-chat="newConversation"
        @disconnect="disconnect()"
        @conversation-cleared="refreshRecent"
        @retry-scope="id => openScope({ id })"
        @retry-connect="retryConnect"
        @cancel-connect="cancelConnect"
        @selection-consumed="sendRequest = null"
      >
        <template v-if="narrow" #header-leading>
          <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ai-rail-toggle" :title="t('connections.aiSessions')" :aria-label="t('connections.aiSessions')" @click="railOpen = true">
            <AppIcon name="list" size="sm" />
            <span v-if="pendingConversationCount" class="ai-rail-toggle-dot" aria-hidden="true" />
          </button>
        </template>
        <template #header-trailing>
          <button
            v-if="terminalTarget"
            type="button"
            class="ui-btn ui-btn-sm ai-open-terminal"
            :title="t('connections.aiOpenTerminalNamed', { name: terminalTarget.name })"
            :aria-label="t('connections.aiOpenTerminalNamed', { name: terminalTarget.name })"
            @click="emit('connect', terminalTarget.connectionId)"
          >
            <AppIcon name="terminal" size="sm" />
            <span>{{ t('connections.openTerminal') }}</span>
          </button>
        </template>
        <template #connect-secondary-actions>
          <button type="button" class="ui-btn ui-btn-sm" :disabled="busy" @click="newConversation">
            {{ t('connections.aiChooseHosts') }}
          </button>
        </template>
      </AiWorkspaceChatPane>

      <div v-if="view === 'empty'" class="ai-main-empty ui-empty">
        <button v-if="narrow" type="button" class="ui-btn ui-btn-sm ai-rail-toggle ai-empty-rail-toggle" @click="railOpen = true">
          <AppIcon name="list" size="sm" />{{ t('connections.aiSessions') }}
        </button>
        <span class="ui-empty-icon" aria-hidden="true"><AppIcon name="ai-chat" size="xl" /></span>
        <p class="ui-empty-title">{{ t('connections.aiEmptyTitle') }}</p>
        <p class="ui-empty-desc">{{ t('connections.aiEmptyHint') }}</p>
        <p v-if="error || pickerError" class="ai-main-error" role="alert">{{ error || pickerError }}</p>
        <div class="ui-empty-actions">
          <button type="button" class="ui-btn ui-btn-primary ui-btn-sm" :disabled="selectionLocked || !connections.length" @click="newConversation">
            <AppIcon name="plus" size="sm" />{{ t('ai.workspace.newConversationMenu') }}
          </button>
        </div>
      </div>
    </main>

    <AiWorkspaceHostPicker
      v-if="hostPicker"
      ref="hostPickerRef"
      v-model:query="pickerQuery"
      :mode="hostPicker"
      :picker-hosts="pickerHosts"
      :picker-groups="pickerGroups"
      :picker-selection="pickerSelection"
      :selected-id="selectedId"
      :sessions="sessions"
      :connecting-id="connectingId"
      :closing="closing"
      :scope-busy="scopeBusy"
      :picker-error="pickerError"
      :is-group-collapsed="isPickerGroupCollapsed"
      :trap-focus="trapPickerFocus"
      @close="closeHostPicker"
      @toggle-group="togglePickerGroup"
      @pick="pickHost"
      @cancel-connect="cancelConnect"
      @start-scope="startFromPicker"
    />
  </section>
</template>

<style scoped>
.connections-ai-workspace {
  --workspace-line: color-mix(in srgb, var(--border-color) 58%, transparent);
  --workspace-panel-radius: var(--radius-lg);
  --ai-rail-width: 248px;
  position: absolute;
  inset: 0;
  z-index: 25;
  display: grid;
  grid-template-columns: var(--ai-rail-width) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  background: var(--bg-primary);
  overflow: hidden;
}

.connections-ai-workspace.narrow { grid-template-columns: minmax(0, 1fr); }

/* ---------- Rail ---------- */
.ai-rail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.narrow .ai-rail {
  position: absolute;
  z-index: 12;
  top: 0;
  bottom: 0;
  left: 0;
  width: min(var(--ai-rail-width), 86%);
  box-shadow: var(--shadow-menu);
}

.ai-rail-backdrop {
  position: absolute;
  inset: 0;
  z-index: 11;
  border: 0;
  padding: 0;
  background: color-mix(in srgb, var(--overlay-bg, #000) 22%, transparent);
  cursor: default;
}

.ai-rail-top {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 10px;
  border-bottom: 1px solid var(--workspace-line);
  flex-shrink: 0;
}

.ai-back-to-connections { justify-content: flex-start; align-self: flex-start; max-width: 100%; }
.ai-back-to-connections span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-rail-new { justify-content: center; width: 100%; }
.ai-rail-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--font-ui-sm);
  text-align: left;
  cursor: pointer;
}
.ai-rail-nav:hover { background: var(--tab-hover-surface); }
.ai-rail-nav.active { background: var(--tab-selected-surface); border-color: var(--tab-selected-edge); }
.ai-rail-nav :deep(.app-icon) { color: var(--text-secondary); }
.ai-schedules { flex: 1; min-height: 0; }

.ai-rail-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ai-rail-section { display: flex; flex-direction: column; gap: 2px; }
.ai-rail-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 6px 4px; }
.ai-rail-head h3 { margin: 0; font-size: var(--font-caption); font-weight: 600; color: var(--text-secondary); }
.ai-rail-count { font-size: var(--font-caption); color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.ai-rail-pending { display: inline-flex; align-items: center; gap: 3px; color: var(--warning); font-size: var(--font-caption); font-weight: 600; }
.ai-rail-empty { margin: 0; padding: 4px 6px; font-size: var(--font-caption); color: var(--text-secondary); line-height: 1.5; }

.ai-rail-group h4 { margin: 6px 6px 2px; font-size: var(--font-caption); font-weight: 400; color: var(--text-secondary); }

.ai-rail-row {
  display: flex;
  align-items: center;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  transition: background 0.12s, border-color 0.12s;
}
.ai-rail-row:hover { background: var(--tab-hover-surface); }
.ai-rail-row.active { background: var(--tab-selected-surface); border-color: var(--tab-selected-edge); }

.ai-rail-item {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ai-rail-item.standalone { width: 100%; }
.ai-rail-item.standalone:hover:not(:disabled) { background: var(--tab-hover-surface); }
.ai-rail-item:disabled { opacity: 0.6; cursor: not-allowed; }
.ai-rail-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

.ai-rail-main { display: flex; flex-direction: column; flex: 1; min-width: 0; gap: 1px; }
.ai-rail-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-ui-sm); font-weight: 500; }
.ai-rail-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); font-size: var(--font-caption); }
.ai-rail-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: var(--text-secondary); opacity: 0.45; }
.ai-rail-dot.connected { background: var(--success); opacity: 1; }
.ai-rail-draft-icon { flex-shrink: 0; color: var(--accent); }
.ai-rail-draft .ai-rail-title { color: var(--text-primary); }
.ai-rail-badge { flex-shrink: 0; padding: 1px 5px; border-radius: 4px; background: var(--bg-tertiary); color: var(--text-secondary); font-size: var(--font-caption); }
.ai-rail-bell { display: inline-flex; flex-shrink: 0; color: var(--warning); }

.ai-rail-close { margin-right: 3px; flex-shrink: 0; opacity: 0; }
.ai-rail-row:hover .ai-rail-close, .ai-rail-row:focus-within .ai-rail-close, .ai-rail-row.active .ai-rail-close { opacity: 1; }

.ai-rail-more { justify-content: center; width: 100%; margin-top: 4px; }

.ai-rail-bottom { padding: 8px 10px; border-top: 1px solid var(--workspace-line); flex-shrink: 0; }
.ai-rail-models { width: 100%; justify-content: flex-start; }

/* ---------- Main ---------- */
.ai-main {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.ai-main > :deep(.workspace-chat) { flex: 1; }
.ai-open-terminal { flex-shrink: 0; white-space: nowrap; }
@container ai-sidebar (max-width: 520px) {
  .ai-open-terminal span { display: none; }
}

.ai-rail-toggle { position: relative; flex-shrink: 0; }
.ai-rail-toggle-dot { position: absolute; top: 3px; right: 3px; width: 6px; height: 6px; border-radius: 50%; background: var(--warning); }
.ai-empty-rail-toggle { position: absolute; top: 10px; left: 10px; }

.ai-main-empty { flex: 1; justify-content: center; }
.ai-main-error { margin: 0; color: var(--danger); font-size: var(--font-ui-sm); max-width: 460px; overflow-wrap: anywhere; }

.ai-model-settings-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(16px, 4vh, 32px);
  background: var(--overlay-bg, rgba(0, 0, 0, 0.42));
}

.ai-model-settings-modal {
  width: min(900px, 100%);
  height: min(680px, 100%);
  min-height: 0;
  border-radius: var(--radius-xl, 14px);
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  box-shadow: var(--shadow-dialog, 0 20px 56px rgba(0, 0, 0, 0.28));
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
