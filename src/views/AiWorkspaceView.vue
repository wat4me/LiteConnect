<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { AI_WORKSPACE_MAX_HOSTS } from '@shared/aiWorkspace'
import AiSidebar from '@/components/ai/AiSidebar.vue'
import AiSettingsPanel from '@/components/ai/AiSettingsPanel.vue'
import AiSchedulePanel from '@/components/ai/AiSchedulePanel.vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { useAiWorkspace } from '@/composables/ai/workspace/useAiWorkspace'
import { useAiChat } from '@/composables/ai/useAiChat'

const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const emit = defineEmits<{ (event: 'open-connections'): void }>()
const { t } = useI18n()
const { settings, refreshSettings, replaceSettings } = useAiChat()
const showModelSettings = ref(false)
const loadingModelSettings = ref(false)
const modelSettingsButton = ref<HTMLButtonElement | null>(null)
const modelSettingsPanel = ref<InstanceType<typeof AiSettingsPanel> | null>(null)

async function openModelSettings() {
  if (loadingModelSettings.value) return
  loadingModelSettings.value = true
  try {
    await refreshSettings()
    showModelSettings.value = true
    await nextTick()
    modelSettingsPanel.value?.$el.querySelector('.settings-panel-header > button')?.focus()
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.loadSettingsFailed'))
  } finally { loadingModelSettings.value = false }
}

async function closeModelSettings() {
  showModelSettings.value = false
  await nextTick()
  modelSettingsButton.value?.focus()
}
const {
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
  startChat,
  openCurrent,
  openHistory,
  cancelConnect,
  disconnect,
  openSchedules,
  backToHosts
} = useAiWorkspace({ active: () => props.active })

let lastHostClick: { connectionId: string; selection: string[] } | undefined

function selectHost(connectionId: string, event: MouseEvent) {
  if (selectionLocked.value || event.detail > 1) return
  lastHostClick = { connectionId, selection: [...browserSelection.value] }
  toggleBrowserHost(connectionId)
}

function openHostChat(connectionId: string) {
  if (selectionLocked.value) return
  // A double-click includes a first click; restore its selection change.
  if (lastHostClick?.connectionId === connectionId) {
    browserSelection.value = lastHostClick.selection
  }
  lastHostClick = undefined
  void openScope({ connectionIds: [connectionId] })
}
</script>

<template>
  <div class="ai-workspace" :class="{ 'is-schedule': showSchedules }">
    <AiSettingsPanel v-if="showModelSettings" ref="modelSettingsPanel" class="workspace-model-settings" :model-value="settings" layout="page" @saved="replaceSettings" @close="closeModelSettings" />
    <aside v-show="!showModelSettings" class="ai-workspace-rail" :class="{ collapsed: railCollapsed }">
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
      v-show="!showModelSettings"
      :connections="connections"
      :connection-id="selectedId"
      :create-token="scheduleCreateToken"
      :return-to-chat="!!sessionId"
      @close="showSchedules = false; browsing = !sessionId"
    />

    <main v-show="!showSchedules && !showModelSettings" class="ai-workspace-main">
      <div v-if="!browsing" class="workspace-chat">
        <p v-if="activeScope && !scopeReady" class="workspace-error inset" role="alert">{{ t('ai.workspace.scopeDisconnected') }}</p>
        <p v-if="error && sessionId" class="workspace-error inset" role="alert">{{ error }}</p>
        <div v-if="sessionId" class="lite-ai-chat">
          <AiSidebar
            :key="sessionId"
            :session-id="sessionId"
            :workspace-targets="scopeTargets"
            :execution-available="!activeScope || scopeReady"
            :active="props.active && !showSchedules && !hostPicker && !showModelSettings"
            workspace
            @request-other-host-chat="openHostPicker('new')"
          >
            <template #header-leading>
              <button type="button" class="ui-btn ui-btn-xs workspace-back" :title="t('ai.workspace.backToHosts')" :aria-label="t('ai.workspace.backToHosts')" @click="backToHosts"><AppIcon name="chevron-left" size="sm" /></button>
            </template>
            <template #workspace-toolbar>
              <header v-if="activeScope" class="workspace-target workspace-scope-target">
                <details class="workspace-scope-details">
                  <summary>
                    <span>{{ t('ai.workspace.scopeCount', { count: activeScope.connectionIds.length }) }}</span>
                    <span class="workspace-scope-ratio" :class="{ ready: scopeReady }">{{ t('ai.workspace.scopeConnectionRatio', { connected: scopeTargets?.filter(target => target.sessionId).length || 0, count: activeScope.connectionIds.length }) }}</span>
                    <span class="workspace-scope-names"><span v-for="target in scopeTargets?.slice(0, 3)" :key="target.connectionId" class="workspace-scope-chip" :title="target.name">{{ target.name }}</span><span v-if="activeScope.connectionIds.length > 3">+{{ activeScope.connectionIds.length - 3 }}</span></span>
                    <AppIcon name="chevron-down" size="xs" />
                  </summary>
                  <ul><li v-for="target in scopeTargets" :key="target.connectionId"><span class="connection-dot" :class="{ connected: !!target.sessionId }" /><strong>{{ target.name }}</strong><span>{{ target.username }}@{{ target.host }}:{{ target.port }}</span></li></ul>
                </details>
                <button v-if="!scopeReady" type="button" class="ui-btn ui-btn-xs workspace-retry" :disabled="scopeBusy" @click="openScope({ id: activeScope.id })"><AppIcon name="refresh" size="xs" />{{ t('ai.workspace.retryConnect') }}</button>
              </header>
              <header v-else-if="selected" class="workspace-target">
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
                <button type="button" class="ui-btn ui-btn-xs workspace-expand-scope" :title="t('ai.workspace.collaborateMore')" :aria-label="t('ai.workspace.collaborateMore')" :disabled="selectionLocked" @click="openHostPicker('create', [selected.id])"><AppIcon name="plus" size="xs" /><span>{{ t('ai.workspace.collaborateMore') }}</span></button>
                <span class="workspace-target-status" :class="{ connected: !!sessionId, connecting: connectingId === selected.id }"><span class="connection-dot" :class="{ connected: !!sessionId, connecting: connectingId === selected.id }" />{{ connectingId === selected.id ? t('ai.workspace.connecting') : sessionId ? t('ai.workspace.connected') : t('ai.workspace.disconnected') }}</span>
              </header>
            </template>
            <template #header-trailing>
              <button v-if="activeScope" type="button" class="ui-btn ui-btn-xs workspace-session-action workspace-close-session" :disabled="scopeBusy" @click="closeScope"><AppIcon name="close" size="sm" />{{ t('ai.workspace.closeScope') }}</button>
              <button v-else-if="selected && connectingId === selected.id" type="button" class="ui-btn ui-btn-xs workspace-session-action" @click="cancelConnect"><AppIcon name="close" size="sm" />{{ t('common.cancel') }}</button>
              <button v-else-if="sessionId" type="button" class="ui-btn ui-btn-xs workspace-session-action workspace-disconnect" :disabled="closing" @click="disconnect()"><AppIcon name="close" size="sm" />{{ t('ai.workspace.disconnect') }}</button>
            </template>
          </AiSidebar>
        </div>
        <div v-else class="workspace-connect-panel" role="status">
          <AppIcon name="server" size="md" />
          <h3>{{ connectingId === selectedId ? t('ai.workspace.connectingTitle') : t('ai.workspace.connectFailedTitle') }}</h3>
          <p>{{ connectingId === selectedId ? t('ai.workspace.connectingHint') : (error || t('ai.workspace.connectFailedHint')) }}</p>
          <div v-if="connectingId" class="workspace-connect-actions">
            <button type="button" class="ui-btn ui-btn-sm" @click="cancelConnect">{{ t('common.cancel') }}</button>
          </div>
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
            <button ref="modelSettingsButton" type="button" class="ui-btn ui-btn-sm workspace-models-button" :disabled="loadingModelSettings" @click="openModelSettings"><AppIcon name="server" size="sm" />{{ t('ai.manageModels') }}</button>
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
              @click="selectHost(connection.id, $event)"
              @dblclick.prevent="openHostChat(connection.id)"
            >
              <div class="workspace-card-top">
                <input type="checkbox" class="workspace-host-checkbox" :checked="browserSelection.includes(connection.id)" :disabled="selectionLocked || (!browserSelection.includes(connection.id) && browserSelection.length >= AI_WORKSPACE_MAX_HOSTS)" :aria-label="t('ai.workspace.selectNamed', { name: connection.name })" @click.stop @dblclick.stop @change="toggleBrowserHost(connection.id)" @keydown.enter.stop.prevent="toggleBrowserHost(connection.id)" />
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

<style scoped src="./AiWorkspaceView.css"></style>
