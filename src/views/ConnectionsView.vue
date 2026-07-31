<script setup lang="ts">
import { defineAsyncComponent, ref, toRef, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import AppIcon from '../components/icons/AppIcon.vue'
import GroupPanel from '../components/connections/GroupPanel.vue'
import ConnectionRow from '../components/connections/ConnectionRow.vue'
import CredentialManagerModal from '../components/connections/CredentialManagerModal.vue'
import ConnectionsToolbar from '../components/connections/ConnectionsToolbar.vue'
import type { Connection, Group } from '../env.d.ts'
import { CONNECTION_COLOR_TAGS } from '@/utils/connections/connectionTags'
import { appConfirm } from '@/composables/app/useAppDialog'
import { useConnectionList } from '@/composables/connections/useConnectionList'
import { useBatchTest } from '@/composables/connections/useBatchTest'

const ConnectionForm = defineAsyncComponent(() => import('../components/connections/ConnectionForm.vue'))

const { t } = useI18n()

const emit = defineEmits<{
  (e: 'connect', connectionId: string): void
  (e: 'connection-saved', connection: Connection): void
  (e: 'open-settings', tab?: 'network'): void
}>()

const props = withDefaults(defineProps<{
  initialData?: {
    connections: Connection[]
    groups: Group[]
  } | null
  initialDataPending?: boolean
}>(), {
  initialData: null,
  initialDataPending: false,
})

const showForm = ref(false)
const editingConnection = ref<Connection | null>(null)
const showCredentialManager = ref(false)
const pageRootRef = ref<HTMLElement | null>(null)
const toolbarRef = ref<InstanceType<typeof ConnectionsToolbar> | null>(null)

function onConnectFromRow(connectionId: string) {
  // Optimistic stats so list shows useCount / lastConnected without reload
  const now = Date.now()
  connections.value = connections.value.map((c) =>
    c.id === connectionId
      ? { ...c, useCount: (c.useCount || 0) + 1, lastConnectedAt: now }
      : c,
  )
  emit('connect', connectionId)
}

const list = useConnectionList({
  initialData: toRef(props, 'initialData'),
  initialDataPending: toRef(props, 'initialDataPending'),
  pageRootRef,
  getSearchInput: () => toolbarRef.value?.searchInputRef ?? null,
  isModalOpen: () => showForm.value || showCredentialManager.value,
  onConnect: onConnectFromRow,
})

const {
  connections,
  groups,
  activeGroupId,
  searchQuery,
  colorTagFilter,
  sortMode,
  importing,
  listKeyboardIndex,
  dragConnId,
  dropInsertIndex,
  connectionCounts,
  activeGroupName,
  filteredConnections,
  isSearching,
  loadData,
  onSelectGroup,
  onAddGroup,
  onRenameGroup,
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
  const password = conn.id
    ? await window.LiteConnect.getConnectionPassword(conn.id)
    : conn.password
  editingConnection.value = {
    ...conn,
    id: '',
    password: password || conn.password,
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

async function onFormSaved(savedConnection: Connection) {
  showForm.value = false
  editingConnection.value = null
  await loadData()
  const refreshed = connections.value.find((conn) => conn.id === savedConnection.id) || savedConnection
  emit('connection-saved', refreshed)
}

function onFormCancel() {
  showForm.value = false
  editingConnection.value = null
}

const filteredCount = computed(() => filteredConnections.value.length)

defineExpose({ loadData, editConnection: onEditConnection })
</script>

<template>
  <div ref="pageRootRef" class="connections-page">
    <GroupPanel
      :groups="groups"
      :active-group-id="activeGroupId"
      :connection-counts="connectionCounts"
      :connections="connections"
      @select="onSelectGroup"
      @add="onAddGroup"
      @rename="onRenameGroup"
      @delete="onDeleteGroup"
      @set-default="onSetDefault"
      @reorder="onReorderGroups"
      @move-connection="onMoveConnection"
      @connect="onConnectFromRow"
    />

    <div class="connections-main">
      <ConnectionsToolbar
        ref="toolbarRef"
        :active-group-name="activeGroupName"
        :search-query="searchQuery"
        :batch-testing="batchTesting"
        :filtered-count="filteredCount"
        :importing="importing"
        @update:search-query="searchQuery = $event"
        @batch-test="onBatchTestGroup"
        @import="handleImport"
        @export="handleExport"
        @credentials="showCredentialManager = true"
        @add="onAddConnection"
      />

      <div class="filter-bar">
        <span class="filter-label">{{ t('connections.colorTag') }}</span>
        <div class="filter-chips">
          <button
            v-for="tag in CONNECTION_COLOR_TAGS"
            :key="tag.id || 'all'"
            type="button"
            class="tag-filter-chip"
            :class="{ active: colorTagFilter === tag.id }"
            :title="tag.id ? tag.label : t('connections.showAllTags')"
            @click="colorTagFilter = tag.id"
          >
            <span class="tag-filter-swatch" :style="{ background: tag.color }"></span>
            <span>{{ tag.id ? tag.label : t('connections.all') }}</span>
          </button>
        </div>
        <div class="sort-bar">
          <span class="filter-label">{{ t('connections.sortLabel') }}</span>
          <div class="filter-chips">
            <button
              type="button"
              class="tag-filter-chip"
              :class="{ active: sortMode === 'manual' }"
              @click="sortMode = 'manual'"
            >
              {{ t('connections.sortManual') }}
            </button>
            <button
              type="button"
              class="tag-filter-chip"
              :class="{ active: sortMode === 'recent' }"
              @click="sortMode = 'recent'"
            >
              {{ t('connections.sortRecent') }}
            </button>
            <button
              type="button"
              class="tag-filter-chip"
              :class="{ active: sortMode === 'frequent' }"
              @click="sortMode = 'frequent'"
            >
              {{ t('connections.sortFrequent') }}
            </button>
          </div>
        </div>
        <button
          v-if="searchQuery || colorTagFilter"
          type="button"
          class="clear-filters"
          @click="clearFilters"
        >
          {{ t('connections.clearFilters') }}
        </button>
      </div>

      <div
        class="connections-list"
        @dragleave="onConnListDragLeave"
      >
        <div
          v-for="(conn, index) in filteredConnections"
          :key="conn.id"
          class="connection-row-wrap"
          :data-conn-index="index"
          :class="{
            'drop-before': !isSearching && !colorTagFilter && dropInsertIndex === index && dragConnId && dragConnId !== conn.id,
            'is-dragging-source': dragConnId === conn.id,
            'keyboard-active': listKeyboardIndex === index,
          }"
          @dragover="!isSearching && !colorTagFilter && onConnRowDragOver($event, index)"
          @drop="onConnRowDrop"
          @mouseenter="listKeyboardIndex = index"
        >
          <ConnectionRow
            :connection="conn"
            :test-status="getTestStatus(conn.id)"
            :reorder-disabled="isSearching || !!colorTagFilter"
            :keyboard-active="listKeyboardIndex === index"
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
        <div
          v-if="filteredConnections.length > 0 && dragConnId && !isSearching && !colorTagFilter"
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
              <button type="button" class="ui-btn" @click="clearFilters">{{ t('connections.clearFilters') }}</button>
            </div>
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
                {{ t('connections.importConfig') }}
              </button>
              <button type="button" class="ui-btn" @click="showCredentialManager = true">
                {{ t('connections.addCredentialsFirst') }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <CredentialManagerModal v-model="showCredentialManager" />

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
  overflow: hidden;
}

.connections-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 18px 22px 16px;
  min-width: 0;
}

.filter-bar {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
}

.filter-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-right: 2px;
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.sort-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-left: auto;
}

.sort-bar .filter-chips {
  flex: 0 1 auto;
}

.tag-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.tag-filter-chip:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}

.tag-filter-chip.active {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent);
}

.tag-filter-swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.clear-filters {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  white-space: nowrap;
}

.clear-filters:hover {
  text-decoration: underline;
}

.connections-list {
  flex: 1;
  overflow-y: auto;
  padding-right: 2px;
}

.connection-row-wrap {
  position: relative;
}

.connection-row-wrap.drop-before::before {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  top: -1px;
  height: 2px;
  background: var(--accent);
  border-radius: 1px;
  z-index: 2;
  pointer-events: none;
  box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 50%, transparent);
}

.connection-row-wrap.is-dragging-source {
  opacity: 0.45;
}

.connection-row-wrap.drop-tail {
  height: 12px;
}

.empty-connections {
  border: 1px dashed var(--border-color);
  border-radius: 12px;
  background: transparent;
  margin-top: 8px;
}
</style>
