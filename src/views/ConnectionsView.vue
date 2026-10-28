<script setup lang="ts">
import { defineAsyncComponent, ref, toRef, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import AppIcon from '../components/icons/AppIcon.vue'
import GroupPanel from '../components/connections/GroupPanel.vue'
import ConnectionRow from '../components/connections/ConnectionRow.vue'
import VirtualList from '@/components/common/VirtualList.vue'
import ConnectionsToolbar from '../components/connections/ConnectionsToolbar.vue'
import ToolbarDropdown from '../components/common/ToolbarDropdown.vue'
import type { Connection, Group } from '../env.d.ts'
import { CONNECTION_COLOR_TAGS } from '@/utils/connections/connectionTags'
import { appConfirm } from '@/composables/app/useAppDialog'
import { useConnectionList } from '@/composables/connections/useConnectionList'
import { useBatchTest } from '@/composables/connections/useBatchTest'
import { normalizeConnectionSortMode, type ConnectionSortMode } from '@shared/connectionSort'

const ConnectionForm = defineAsyncComponent(() => import('../components/connections/ConnectionForm.vue'))
const CredentialManagerModal = defineAsyncComponent(() => import('../components/connections/CredentialManagerModal.vue'))

const { t } = useI18n()

const emit = defineEmits<{
  (e: 'connect', connectionId: string): void
  (e: 'cancel-connect', connectionId: string): void
  (e: 'connection-saved', connection: Connection): void
  (e: 'open-settings', tab?: 'network'): void
}>()

const props = withDefaults(defineProps<{
  initialData?: {
    connections: Connection[]
    groups: Group[]
  } | null
  initialDataPending?: boolean
  connectingConnectionIds?: Set<string>
  connectionStages?: Record<string, import('@shared/sshConnectionProgress').SshConnectionStage>
  connectionErrors?: Record<string, string>
}>(), {
  initialData: null,
  initialDataPending: false,
  connectingConnectionIds: () => new Set<string>(),
})

const showForm = ref(false)
const editingConnection = ref<Connection | null>(null)
const showCredentialManager = ref(false)
const pageRootRef = ref<HTMLElement | null>(null)
const connectionsListRef = ref<HTMLElement | null>(null)
const toolbarRef = ref<InstanceType<typeof ConnectionsToolbar> | null>(null)
const virtualListRef = ref<{ scrollToIndex: (index: number) => void; resetScroll: () => void } | null>(null)
const connectionKey = (connection: Connection) => connection.id

const DENSITY_KEY = 'LiteConnect.connections.density'
const compactList = ref(false)
try { compactList.value = localStorage.getItem(DENSITY_KEY) === 'compact' } catch { /* Keep the standard view if storage is unavailable. */ }
watch(compactList, compact => {
  try { localStorage.setItem(DENSITY_KEY, compact ? 'compact' : 'standard') } catch { /* The current view remains usable without persistence. */ }
})

/** useCount / lastConnected display & sort; default on */
const usageStatsEnabled = ref(true)
let sortModeReady = false
let persistedSortMode: ConnectionSortMode = 'manual'
let queuedSortMode: ConnectionSortMode = 'manual'
let sortSaveRevision = 0
let sortSaveQueue: Promise<void> = Promise.resolve()

function onUsageStatsSettingsChange(e: Event) {
  const detail = (e as CustomEvent<{ enabled?: boolean }>).detail
  if (typeof detail?.enabled === 'boolean') {
    usageStatsEnabled.value = detail.enabled
  }
}

onMounted(async () => {
  const [usageResult, settingsResult] = await Promise.allSettled([
    window.LiteConnect.getConnectionUsageStatsEnabled(),
    window.LiteConnect.getAllSettings(),
  ])
  usageStatsEnabled.value = usageResult.status === 'fulfilled' ? usageResult.value : true
  const storedMode = settingsResult.status === 'fulfilled'
    ? settingsResult.value.connectionSortMode
    : 'manual'
  persistedSortMode = normalizeConnectionSortMode(storedMode, usageStatsEnabled.value)
  queuedSortMode = persistedSortMode
  sortMode.value = persistedSortMode
  sortModeReady = true
  window.addEventListener('connection-usage-stats-settings-change', onUsageStatsSettingsChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('connection-usage-stats-settings-change', onUsageStatsSettingsChange)
})

watch(usageStatsEnabled, (enabled) => {
  if (!enabled && (sortMode.value === 'recent' || sortMode.value === 'frequent')) {
    selectSortMode('manual')
  }
})

function selectSortMode(mode: ConnectionSortMode) {
  const next = normalizeConnectionSortMode(mode, usageStatsEnabled.value)
  sortMode.value = next
  if (!sortModeReady || next === queuedSortMode) return
  queuedSortMode = next
  const revision = ++sortSaveRevision
  sortSaveQueue = sortSaveQueue
    .catch(() => {})
    .then(async () => {
      try {
        await window.LiteConnect.setManySettings({ connectionSortMode: next })
        persistedSortMode = next
      } catch (err: any) {
        if (revision === sortSaveRevision) {
          queuedSortMode = persistedSortMode
          sortMode.value = persistedSortMode
        }
        ElMessage.error(err?.message || t('connections.sortSaveFailed'))
      }
    })
}

function onConnectFromRow(connectionId: string) {
  if (props.connectingConnectionIds.has(connectionId)) return
  // Optimistic stats so list shows useCount / lastConnected without reload
  if (usageStatsEnabled.value) {
    const now = Date.now()
    connections.value = connections.value.map((c) =>
      c.id === connectionId
        ? { ...c, useCount: (c.useCount || 0) + 1, lastConnectedAt: now }
        : c,
    )
  }
  emit('connect', connectionId)
}

const list = useConnectionList({
  initialData: toRef(props, 'initialData'),
  initialDataPending: toRef(props, 'initialDataPending'),
  pageRootRef,
  connectionsListRef,
  getSearchInput: () => toolbarRef.value?.searchInputRef ?? null,
  isModalOpen: () => showForm.value || showCredentialManager.value,
  onConnect: onConnectFromRow,
  revealConnection: index => virtualListRef.value?.scrollToIndex(index),
})

const {
  connections,
  groups,
  activeGroupId,
  smartView,
  inSmartView,
  searchQuery,
  searchScope,
  reorderDisabled,
  getConnectionGroupName,
  colorTagFilter,
  sortMode,
  importing,
  listKeyboardIndex,
  dragConnId,
  dropInsertIndex,
  connectionCounts,
  smartViewCounts,
  usedColorTags,
  activeGroupName,
  filteredConnections,
  crossGroupSearchHits,
  groupConnectionTotal,
  loadData,
  onSelectGroup,
  onSelectSmartView,
  expandSearchToAllGroups,
  onAddGroup,
  onRenameGroup,
  onMoveGroup,
  onDeleteGroup,
  onSetDefault,
  onReorderGroups,
  onMoveConnection,
  onConnDragStart,
  onConnDragEnd,
  onConnRowDragOver,
  onConnListDragLeave,
  onConnRowDrop,
  togglePin,
  clearFilters,
  handleExport,
  handleImport,
} = list

watch([activeGroupId, smartView, searchQuery, searchScope, colorTagFilter, sortMode], () => {
  virtualListRef.value?.resetScroll()
}, { flush: 'post' })

async function onOpenInNewWindow(connectionId: string) {
  try {
    await window.LiteConnect.openConnectionWindow(connectionId)
  } catch (err: any) {
    ElMessage.error(err?.message || t('connections.openInNewWindowFailed'))
  }
}

const { batchTesting, onTestConnection, onBatchTestGroup, getTestStatus } = useBatchTest(filteredConnections)

function onAddConnection() {
  editingConnection.value = null
  showForm.value = true
}

function generateCopyName(originalName: string): string {
  const existingNames = connections.value.map(c => c.name)
  const match = originalName.match(/^(.+?)\s*\((\d+)\)$/)
  let baseName = originalName.trim()
  let counter = 1

  if (match) {
    baseName = match[1].trim()
    counter = parseInt(match[2]) + 1
  }

  while (existingNames.includes(`${baseName} (${counter})`)) {
    counter++
  }
  return `${baseName} (${counter})`
}

async function onCopyConnection(conn: Connection) {
  const secrets = conn.id
    ? await window.LiteConnect.getConnectionSecrets(conn.id)
    : {
        password: conn.password || '',
        privateKey: conn.privateKey || '',
        jumpPassword: conn.jumpPassword || '',
        jumpPrivateKey: conn.jumpPrivateKey || '',
      }
  editingConnection.value = {
    ...conn,
    id: '',
    password: secrets.password,
    privateKey: secrets.privateKey,
    jumpPassword: secrets.jumpPassword,
    jumpPrivateKey: secrets.jumpPrivateKey,
    hasPrivateKey: !!secrets.privateKey,
    hasJumpPassword: !!secrets.jumpPassword,
    hasJumpPrivateKey: !!secrets.jumpPrivateKey,
    name: generateCopyName(conn.name),
    createdAt: 0,
    updatedAt: 0,
  }
  showForm.value = true
}

function onEditConnection(conn: Connection) {
  editingConnection.value = { ...conn }
  showForm.value = true
}

async function onDeleteConnection(connectionId: string) {
  const conn = connections.value.find((c) => c.id === connectionId)
  if (!conn) return
  try {
    await appConfirm({
      title: t('connections.deleteTitle'),
      message: t('connections.deleteMessage', { name: conn.name }),
      detail: t('connections.deleteDetail'),
      confirmText: t('common.delete'),
      danger: true,
      tone: 'danger',
    })
    await window.LiteConnect.deleteConnection(connectionId)
    ElMessage.success(t('connections.deleted'))
    await loadData()
  } catch {}
}

async function onFormSaved(
  savedConnection: Connection,
  meta?: { continueCreating?: boolean },
) {
  await loadData()
  const refreshed = connections.value.find((conn) => conn.id === savedConnection.id) || savedConnection
  emit('connection-saved', refreshed)
  if (meta?.continueCreating) {
    // Keep dialog open for continuous create / copy; form resets itself
    return
  }
  showForm.value = false
  editingConnection.value = null
}

function onFormCancel() {
  showForm.value = false
  editingConnection.value = null
}

const filteredCount = computed(() => filteredConnections.value.length)
const allConnectionsActive = computed(() => !smartView.value && searchScope.value === 'all')
const sortItems = computed(() => [
  { id: 'manual', label: t('connections.sortManual'), disabled: smartView.value === 'recent' },
  ...(usageStatsEnabled.value ? [
    { id: 'recent', label: t('connections.sortRecent') },
    { id: 'frequent', label: t('connections.sortFrequent'), disabled: smartView.value === 'recent' },
  ] : []),
])
const displayedSort = computed(() => smartView.value === 'recent' ? 'recent' : sortMode.value)
const colorFilterItems = computed(() => CONNECTION_COLOR_TAGS.map(tag => ({
  id: tag.id, label: tag.id ? tag.label : t('connections.all'),
  color: tag.id ? tag.color : undefined,
})))
const activeColorTag = computed(() => CONNECTION_COLOR_TAGS.find(tag => tag.id && tag.id === colorTagFilter.value))

defineExpose({ loadData, editConnection: onEditConnection })
</script>

<template>
  <div ref="pageRootRef" class="connections-page">
    <GroupPanel
      :groups="groups"
      :active-group-id="activeGroupId"
      :smart-view="smartView"
      :all-connections-active="allConnectionsActive"
      :connection-counts="connectionCounts"
      :smart-view-counts="smartViewCounts"
      :used-color-tags="usedColorTags"
      :connections="connections"
      :connecting-connection-ids="connectingConnectionIds"
      :connection-errors="connectionErrors"
      @cancel-connect="emit('cancel-connect', $event)"
      @select="onSelectGroup"
      @select-smart="onSelectSmartView"
      @select-all="expandSearchToAllGroups"
      @add="onAddGroup"
      @rename="onRenameGroup"
      @move-group="onMoveGroup"
      @delete="onDeleteGroup"
      @set-default="onSetDefault"
      @reorder="onReorderGroups"
      @move-connection="onMoveConnection"
      @connect="onConnectFromRow"
      @pin="togglePin"
    />

    <div class="connections-main">
      <ConnectionsToolbar
        ref="toolbarRef"
        :active-group-name="activeGroupName"
        :search-query="searchQuery"
        :search-scope="searchScope"
        :in-smart-view="inSmartView"
        :heading-icon="smartView === 'pinned' ? 'pin' : smartView === 'recent' ? 'history' : inSmartView ? 'list' : allConnectionsActive ? 'home-grid' : 'folder'"
        :batch-testing="batchTesting"
        :filtered-count="filteredCount"
        :total-count="groupConnectionTotal"
        :importing="importing"
        :filters-active="!!(searchQuery || colorTagFilter)"
        @update:search-query="searchQuery = $event"
        @batch-test="onBatchTestGroup"
        @import="handleImport"
        @export="handleExport"
        @credentials="showCredentialManager = true"
        @add="onAddConnection"
        @clear-filters="clearFilters"
      >
      <template #filters>
      <div class="filter-bar">
        <div v-if="!smartView?.startsWith('tag:')" class="color-filter">
          <ToolbarDropdown
            class="tag-filter" :model-value="colorTagFilter"
            :label="t('connections.filterByTag')" :items="colorFilterItems"
            :aria-label="t('connections.filterByTag')" menu-class="tag-filter-menu" teleport
            @select="colorTagFilter = $event"
          />
          <span v-if="activeColorTag" class="active-tag">
            <span class="tag-filter-swatch" :style="{ background: activeColorTag.color }" aria-hidden="true"></span>
            <span>{{ activeColorTag.label }}</span>
            <button type="button" class="active-tag-clear" :title="t('connections.clearColorFilter')" :aria-label="t('connections.clearColorFilter')" @click="colorTagFilter = ''"><AppIcon name="close" size="xs" /></button>
          </span>
        </div>
        <div class="sort-bar">
          <ToolbarDropdown
            class="sort-control" :model-value="displayedSort"
            :label="sortItems.find(item => item.id === displayedSort)?.label || t('connections.sortManual')"
            :aria-label="t('connections.sortLabel')" :items="sortItems" menu-class="sort-menu" teleport
            @select="selectSortMode($event as ConnectionSortMode)"
          />
        </div>
        <div class="density-switch" role="group" :aria-label="t('connections.listDensity')">
          <button type="button" :class="{ active: !compactList }" :aria-pressed="!compactList" :title="t('connections.standardListHint')" @click="compactList = false">{{ t('connections.standardList') }}</button>
          <button type="button" :class="{ active: compactList }" :aria-pressed="compactList" :title="t('connections.compactListHint')" @click="compactList = true">{{ t('connections.compactList') }}</button>
        </div>
      </div>

      </template>
      </ConnectionsToolbar>
      <button
        v-if="crossGroupSearchHits > 0 && filteredCount === 0"
        type="button"
        class="cross-group-hint"
        @click="expandSearchToAllGroups"
      >
        {{ t('connections.expandSearchAll', { count: crossGroupSearchHits }) }}
      </button>
      <p v-else-if="crossGroupSearchHits > 0" class="cross-group-hint-inline">
        <button type="button" class="cross-group-link" @click="expandSearchToAllGroups">
          {{ t('connections.expandSearchAll', { count: crossGroupSearchHits }) }}
        </button>
      </p>

      <p class="list-keyboard-hint">{{ t('connections.searchKeyboardHint') }}</p>

      <div
        ref="connectionsListRef"
        class="connections-list"
        :class="{ compact: compactList }"
        @dragleave="onConnListDragLeave"
      >
        <VirtualList
          ref="virtualListRef"
          :items="filteredConnections"
          :item-key="connectionKey"
          :estimated-size="compactList ? 36 : 60"
          :gap="compactList ? 3 : 8"
          :scroll-container="connectionsListRef"
          :pinned-key="dragConnId"
          v-slot="{ item: conn, index }"
        >
        <div
          class="connection-row-wrap"
          :data-conn-index="index"
          :class="{
            'drop-before': !reorderDisabled && dropInsertIndex === index && dragConnId && dragConnId !== conn.id,
            'is-dragging-source': dragConnId === conn.id,
            'keyboard-active': listKeyboardIndex === index,
          }"
          @dragover="!reorderDisabled && onConnRowDragOver($event, index)"
          @drop="onConnRowDrop"
          @mouseenter="listKeyboardIndex = index"
        >
          <ConnectionRow
            :connection="conn"
            :compact="compactList"
            :test-status="getTestStatus(conn.id)"
            :reorder-disabled="reorderDisabled"
            :group-name="searchScope === 'all' || inSmartView || conn.group !== activeGroupId ? getConnectionGroupName(conn) : undefined"
            :keyboard-active="listKeyboardIndex === index"
            :show-usage-stats="usageStatsEnabled"
            :connecting="connectingConnectionIds.has(conn.id)"
            :connection-stage="connectionStages?.[conn.id]"
            :connection-error="connectionErrors?.[conn.id]"
            @cancel-connect="emit('cancel-connect', $event)"
            @connect="onConnectFromRow"
            @test="onTestConnection"
            @edit="onEditConnection"
            @delete="onDeleteConnection"
            @copy="onCopyConnection"
            @pin="togglePin"
            @open-window="onOpenInNewWindow"
            @drag-start="onConnDragStart"
            @drag-end="onConnDragEnd"
          />
        </div>
        </VirtualList>
        <div
          v-if="filteredConnections.length > 0 && dragConnId && !reorderDisabled"
          class="connection-row-wrap drop-tail"
          :class="{ 'drop-before': dropInsertIndex === filteredConnections.length }"
          @dragover="onConnRowDragOver($event, filteredConnections.length)"
          @drop="onConnRowDrop"
        ></div>

        <div v-if="filteredConnections.length === 0" class="ui-empty empty-connections">
          <div class="ui-empty-icon" aria-hidden="true">
            <AppIcon name="monitor" size="xl" />
          </div>
          <template v-if="searchQuery || colorTagFilter">
            <p class="ui-empty-title">{{ t('connections.emptyFilteredTitle') }}</p>
            <p class="ui-empty-desc">{{ t('connections.emptyFilteredDesc') }}</p>
            <div class="ui-empty-actions">
              <button
                v-if="crossGroupSearchHits > 0"
                type="button"
                class="ui-btn ui-btn-primary"
                @click="expandSearchToAllGroups"
              >
                {{ t('connections.expandSearchAll', { count: crossGroupSearchHits }) }}
              </button>
              <button type="button" class="ui-btn" @click="clearFilters">{{ t('connections.clearFilters') }}</button>
            </div>
          </template>
          <template v-else-if="smartView === 'pinned'">
            <p class="ui-empty-title">{{ t('connections.emptySmartPinnedTitle') }}</p>
            <p class="ui-empty-desc">{{ t('connections.emptySmartPinnedDesc') }}</p>
          </template>
          <template v-else-if="smartView === 'recent'">
            <p class="ui-empty-title">{{ t('connections.emptySmartRecentTitle') }}</p>
            <p class="ui-empty-desc">{{ t('connections.emptySmartRecentDesc') }}</p>
          </template>
          <template v-else-if="smartView?.startsWith('tag:')">
            <p class="ui-empty-title">{{ t('connections.emptySmartTagTitle') }}</p>
            <p class="ui-empty-desc">{{ t('connections.emptySmartTagDesc') }}</p>
          </template>
          <template v-else>
            <p class="ui-empty-title">{{ t('connections.emptyGroupTitle', { name: activeGroupName }) }}</p>
            <p class="ui-empty-desc">{{ t('connections.emptyGroupDesc') }}</p>
            <div class="ui-empty-actions">
              <button type="button" class="ui-btn ui-btn-primary" @click="onAddConnection">
                <AppIcon name="plus" size="sm" />
                {{ t('connections.newConnection') }}
              </button>
              <button type="button" class="ui-btn" :disabled="importing" @click="handleImport">
                {{ t('connections.import') }}
              </button>
              <button type="button" class="ui-btn" @click="showCredentialManager = true">
                {{ t('connections.addCredentialsFirst') }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <CredentialManagerModal v-if="showCredentialManager" v-model="showCredentialManager" />

    <ConnectionForm
      v-if="showForm"
      :connection="editingConnection"
      :default-group-id="activeGroupId || undefined"
      @saved="onFormSaved"
      @cancel="onFormCancel"
      @open-settings="(tab) => emit('open-settings', tab)"
    />
  </div>
</template>

<style scoped>
.connections-page {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.connections-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 18px 22px 20px;
  min-width: 0;
  min-height: 0;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
}

.cross-group-hint {
  flex-shrink: 0;
  align-self: flex-start;
  margin: 0 0 8px;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border-color));
  border-radius: 8px;
  background: var(--accent-bg);
  color: var(--accent);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.cross-group-hint-inline {
  margin: 0 0 6px;
  font-size: 12px;
}

.cross-group-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.color-filter {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.sort-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.active-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 4px 2px 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border-color));
  background: var(--accent-bg);
  color: var(--text-primary);
  font-size: 11px;
}
.active-tag-clear { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--text-secondary); cursor: pointer; }
.active-tag-clear:hover { background: var(--hover-bg); color: var(--text-primary); }
.active-tag-clear:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.tag-filter :deep(.dropdown-trigger) { min-height: 30px; padding: 3px 10px; font-size: 12px; }
.sort-control :deep(.dropdown-trigger) { min-height: 30px; padding: 3px 10px; font-size: 12px; }

.tag-filter-swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.list-keyboard-hint {
  flex-shrink: 0;
  margin: 0 0 4px;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
}

.connections-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-anchor: none;
  padding-right: 2px;
  /* Room for insertion line above first row + last-row descenders */
  padding-top: 6px;
  padding-bottom: 8px;
}

.density-switch { display: inline-flex; flex-shrink: 0; gap: 2px; padding: 2px; border: 1px solid var(--border-color); border-radius: 6px; }
.density-switch button { padding: 3px 8px; border: 0; border-radius: 4px; background: transparent; color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.density-switch button:hover { background: var(--hover-bg); color: var(--text-primary); }
.density-switch button.active { background: var(--accent-bg); color: var(--accent); }
.density-switch button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.connection-row-wrap {
  position: relative;
}

/* Independent rounded cards: light gap between rows (drop line sits in this gap) */

/*
 * Insertion indicator: full-width accent line + end caps (VS Code / Finder style).
 * Positioned in the gap above the target row.
 */
.connection-row-wrap.drop-before::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -5px;
  height: 2px;
  background: var(--accent);
  border-radius: 1px;
  z-index: 3;
  pointer-events: none;
  box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 55%, transparent);
}

/* Left / right circular caps on the insertion line */
.connection-row-wrap.drop-before::after {
  content: '';
  position: absolute;
  left: -1px;
  right: -1px;
  top: -8px;
  height: 8px;
  z-index: 4;
  pointer-events: none;
  background:
    radial-gradient(circle at 3px 50%, var(--accent) 0 3px, transparent 3.5px),
    radial-gradient(circle at calc(100% - 3px) 50%, var(--accent) 0 3px, transparent 3.5px);
}

/* First row: line sits just above the card (list has padding-top) */
.connection-row-wrap[data-conn-index='0'].drop-before::before {
  top: -4px;
}

.connection-row-wrap[data-conn-index='0'].drop-before::after {
  top: -7px;
}

.connection-row-wrap.drop-tail {
  height: 14px;
}

.connection-row-wrap.drop-tail.drop-before::before {
  top: 4px;
}

.connection-row-wrap.drop-tail.drop-before::after {
  top: 1px;
}

.empty-connections {
  border: 1px dashed var(--border-color);
  border-radius: 12px;
  background: transparent;
  margin-top: 8px;
}
</style>
