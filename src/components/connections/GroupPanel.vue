<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'
import type { Connection, Group } from '../../env.d.ts'
import { getConnectionTagColor } from '../../utils/connectionTags'

const { t } = useI18n()

const UNGROUPED_ID = '__ungrouped__'

const props = defineProps<{
  groups: Group[]
  activeGroupId: string | null
  connectionCounts: Record<string, number>
  connections: Connection[]
}>()

const emit = defineEmits<{
  (e: 'select', groupId: string): void
  (e: 'add'): void
  (e: 'addConnection'): void
  (e: 'rename', group: Group): void
  (e: 'delete', groupId: string): void
  (e: 'setDefault', groupId: string | null): void
  (e: 'reorder', orderedIds: string[]): void
  (e: 'connect', connectionId: string): void
  (e: 'moveConnection', connectionId: string, groupId: string | null): void
}>()

const editingId = ref<string | null>(null)
const editingName = ref('')
const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)
const dragConnId = ref<string | null>(null)
const dropTargetGroupId = ref<string | null>(null)
const groupSearchQuery = ref('')
const collapsedGroupIds = ref<Set<string>>(new Set())
const ungroupedCollapsed = ref(false)

const normalizedGroupSearchQuery = computed(() => groupSearchQuery.value.trim().toLowerCase())

const visibleGroups = computed(() => {
  const query = normalizedGroupSearchQuery.value
  if (!query) return props.groups
  return props.groups.filter((group) => {
    if (group.name.toLowerCase().includes(query)) return true
    return getConnectionsForGroup(group.id).some((conn) => matchesConnection(conn, query))
  })
})

const visibleUngroupedConnections = computed(() => {
  const query = normalizedGroupSearchQuery.value
  const connections = getConnectionsForGroup(UNGROUPED_ID)
  if (!query || t('groups.ungrouped').toLowerCase().includes(query)) return connections
  return connections.filter((conn) => matchesConnection(conn, query))
})

const showUngrouped = computed(() => {
  const query = normalizedGroupSearchQuery.value
  return !query || t('groups.ungrouped').toLowerCase().includes(query) || visibleUngroupedConnections.value.length > 0
})

function getConnectionsForGroup(groupId: string): Connection[] {
  if (groupId === UNGROUPED_ID) {
    return props.connections.filter((c) => !c.group)
  }
  return props.connections.filter((c) => c.group === groupId)
}

function getGroupIndex(groupId: string): number {
  return props.groups.findIndex((g) => g.id === groupId)
}

function getVisibleConnectionsForGroup(groupId: string): Connection[] {
  const query = normalizedGroupSearchQuery.value
  const connections = getConnectionsForGroup(groupId)
  if (!query) return connections
  return connections.filter((conn) => matchesConnection(conn, query))
}

function matchesConnection(conn: Connection, query: string): boolean {
  return (
    conn.name.toLowerCase().includes(query) ||
    conn.host.toLowerCase().includes(query) ||
    conn.username.toLowerCase().includes(query)
  )
}

function isGroupCollapsed(groupId: string): boolean {
  return !normalizedGroupSearchQuery.value && collapsedGroupIds.value.has(groupId)
}

function toggleGroupCollapsed(groupId: string) {
  const next = new Set(collapsedGroupIds.value)
  if (next.has(groupId)) {
    next.delete(groupId)
  } else {
    next.add(groupId)
  }
  collapsedGroupIds.value = next
}

function isUngroupedCollapsed(): boolean {
  return !normalizedGroupSearchQuery.value && ungroupedCollapsed.value
}

function toggleUngroupedCollapsed() {
  ungroupedCollapsed.value = !ungroupedCollapsed.value
}

function startRename(group: Group) {
  editingId.value = group.id
  editingName.value = group.name
}

function finishRename(group: Group) {
  if (editingName.value.trim() && editingName.value.trim() !== group.name) {
    emit('rename', { ...group, name: editingName.value.trim() })
  }
  editingId.value = null
}

function cancelRename() {
  editingId.value = null
}

function onDragStart(index: number) {
  if (dragConnId.value || index < 0) return
  dragIndex.value = index
}

function onDragOver(e: DragEvent, index: number) {
  if (dragConnId.value || index < 0) return
  e.preventDefault()
  dropIndex.value = index
}

function onDragLeave() {
  dropIndex.value = null
}

function onDrop(e: DragEvent, index: number) {
  e.preventDefault()
  if (dragConnId.value || index < 0) return
  if (dragIndex.value !== null && dragIndex.value !== index) {
    const ids = props.groups.map((g) => g.id)
    const [moved] = ids.splice(dragIndex.value, 1)
    ids.splice(index, 0, moved)
    emit('reorder', ids)
  }
  dragIndex.value = null
  dropIndex.value = null
}

function onDragEnd() {
  dragIndex.value = null
  dropIndex.value = null
}

function onConnDragStart(e: DragEvent, connId: string) {
  dragConnId.value = connId
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-lite-connect-conn', connId)
  }
}

function onConnDragEnd() {
  dragConnId.value = null
  dropTargetGroupId.value = null
}

function onGroupDragOverConn(e: DragEvent, groupId: string) {
  const types = e.dataTransfer?.types ? Array.from(e.dataTransfer.types) : []
  if (
    !dragConnId.value &&
    !types.includes('application/x-lite-connect-conn') &&
    !types.includes('application/x-lite-ssh-conn')
  ) {
    return
  }
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropTargetGroupId.value = groupId
}

function onGroupDragLeaveConn() {
  dropTargetGroupId.value = null
}

function onGroupDragLeave(e: DragEvent) {
  onDragLeave()
  onGroupDragLeaveConn()
}

function onGroupDragOver(e: DragEvent, groupId: string) {
  onDragOver(e, getGroupIndex(groupId))
  onGroupDragOverConn(e, groupId)
}

function onGroupDrop(e: DragEvent, groupId: string) {
  onDrop(e, getGroupIndex(groupId))
  onGroupDropConn(e, groupId)
}

function onGroupDropConn(e: DragEvent, groupId: string) {
  e.preventDefault()
  const connId =
    dragConnId.value ||
    e.dataTransfer?.getData('application/x-lite-connect-conn') ||
    e.dataTransfer?.getData('application/x-lite-ssh-conn')
  if (connId) {
    emit('moveConnection', connId, groupId)
  }
  dragConnId.value = null
  dropTargetGroupId.value = null
}

function onUngroupedDropConn(e: DragEvent) {
  e.preventDefault()
  const connId =
    dragConnId.value ||
    e.dataTransfer?.getData('application/x-lite-connect-conn') ||
    e.dataTransfer?.getData('application/x-lite-ssh-conn')
  if (connId) {
    emit('moveConnection', connId, null)
  }
  dragConnId.value = null
  dropTargetGroupId.value = null
}

function onUngroupedDragOverConn(e: DragEvent) {
  const types = e.dataTransfer?.types ? Array.from(e.dataTransfer.types) : []
  if (
    !dragConnId.value &&
    !types.includes('application/x-lite-connect-conn') &&
    !types.includes('application/x-lite-ssh-conn')
  ) {
    return
  }
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropTargetGroupId.value = UNGROUPED_ID
}
</script>

<template>
  <div class="group-panel">
    <div class="group-panel-title">{{ t('groups.title') }}</div>
    <div class="group-search">
      <input
        v-model="groupSearchQuery"
        class="group-search-input"
        :placeholder="t('groups.searchPlaceholder')"
      />
    </div>
    <div class="group-list">
      <template v-for="group in visibleGroups" :key="group.id">
        <div
          class="group-item"
          :class="{
            active: group.id === activeGroupId,
            dragging: dragIndex === getGroupIndex(group.id),
            'drop-above': dropIndex === getGroupIndex(group.id) && dragIndex !== null && dragIndex < getGroupIndex(group.id),
            'drop-below': dropIndex === getGroupIndex(group.id) && dragIndex !== null && dragIndex > getGroupIndex(group.id),
            'drop-target': dropTargetGroupId === group.id,
          }"
          @click="emit('select', group.id)"
          @dragover="onGroupDragOver($event, group.id)"
          @dragleave="onGroupDragLeave"
          @drop="onGroupDrop($event, group.id)"
        >
          <div v-if="dropIndex === getGroupIndex(group.id) && dragIndex !== null && dragIndex < getGroupIndex(group.id)" class="drop-indicator top"></div>
          <div class="group-item-content">
            <span
              class="group-drag-handle"
              draggable="true"
              :title="t('groups.dragSort')"
              :aria-label="t('groups.dragSort')"
              @dragstart.stop="onDragStart(getGroupIndex(group.id))"
              @dragend="onDragEnd"
              @click.stop
            >
              <AppIcon name="grip" :size="12" />
            </span>
            <button class="collapse-btn" @click.stop="toggleGroupCollapsed(group.id)">
              <AppIcon :name="isGroupCollapsed(group.id) ? 'chevron-right' : 'chevron-down'" :size="12" />
            </button>
            <span v-if="group.isDefault" class="default-star" :title="t('groups.defaultGroup')">
              <AppIcon name="star-fill" :size="12" />
            </span>
            <template v-if="editingId === group.id">
              <input
                v-model="editingName"
                class="rename-input"
                @keyup.enter="finishRename(group)"
                @keyup.escape="cancelRename"
                @blur="finishRename(group)"
                @click.stop
              />
            </template>
            <template v-else>
              <span class="group-name">{{ group.name }}</span>
              <span class="group-count">{{ connectionCounts[group.id] || 0 }}</span>
            </template>
          </div>
          <div v-if="editingId !== group.id" class="group-actions">
            <el-tooltip :content="t('groups.rename')" placement="right">
              <button class="icon-btn-tiny" @click.stop="startRename(group)">
                <AppIcon name="edit" :size="12" />
              </button>
            </el-tooltip>
            <el-tooltip :content="group.isDefault ? t('groups.unsetDefault') : t('groups.setDefault')" placement="right">
              <button class="icon-btn-tiny" @click.stop="emit('setDefault', group.isDefault ? null : group.id)">
                <AppIcon :name="group.isDefault ? 'star-fill' : 'star'" :size="12" />
              </button>
            </el-tooltip>
            <el-tooltip :content="t('groups.delete')" placement="right">
              <button class="icon-btn-tiny danger" @click.stop="emit('delete', group.id)">
                <AppIcon name="delete" :size="12" />
              </button>
            </el-tooltip>
          </div>
          <div v-if="dropIndex === getGroupIndex(group.id) && dragIndex !== null && dragIndex > getGroupIndex(group.id)" class="drop-indicator bottom"></div>
        </div>
        <div v-if="!isGroupCollapsed(group.id)" class="group-connections">
          <div
            v-for="conn in getVisibleConnectionsForGroup(group.id)"
            :key="conn.id"
            class="sidebar-conn"
            :class="{ dragging: dragConnId === conn.id }"
            @dblclick="emit('connect', conn.id)"
          >
            <span
              class="sidebar-conn-handle"
              draggable="true"
              :title="t('groups.dragToOther')"
              @dragstart.stop="onConnDragStart($event, conn.id)"
              @dragend="onConnDragEnd"
              @click.stop
              @dblclick.stop
            >
              <AppIcon name="grip" :size="10" />
            </span>
            <span
              class="sidebar-conn-dot"
              :style="conn.colorTag ? { background: getConnectionTagColor(conn.colorTag), opacity: 1 } : undefined"
            ></span>
            <span class="sidebar-conn-name" :title="conn.note || conn.name">{{ conn.name }}</span>
          </div>
        </div>
      </template>

      <div v-if="visibleGroups.length === 0 && !showUngrouped" class="empty-groups">
        {{ t('groups.noMatch') }}
      </div>

      <div
        v-if="showUngrouped"
        class="group-item ungrouped"
        :class="{ active: UNGROUPED_ID === activeGroupId, 'drop-target': dropTargetGroupId === UNGROUPED_ID }"
        @click="emit('select', UNGROUPED_ID)"
        @dragover="onUngroupedDragOverConn"
        @dragleave="onGroupDragLeaveConn"
        @drop="onUngroupedDropConn"
      >
        <div class="group-item-content">
          <button class="collapse-btn" @click.stop="toggleUngroupedCollapsed">
            <AppIcon :name="isUngroupedCollapsed() ? 'chevron-right' : 'chevron-down'" :size="12" />
          </button>
          <span class="group-name">{{ t('groups.ungrouped') }}</span>
          <span class="group-count">{{ connectionCounts[UNGROUPED_ID] || 0 }}</span>
        </div>
      </div>
      <div v-if="showUngrouped && !isUngroupedCollapsed()" class="group-connections">
        <div
          v-for="conn in visibleUngroupedConnections"
          :key="conn.id"
          class="sidebar-conn"
          :class="{ dragging: dragConnId === conn.id }"
          @dblclick="emit('connect', conn.id)"
        >
          <span
            class="sidebar-conn-handle"
            draggable="true"
            :title="t('groups.dragToOther')"
            @dragstart.stop="onConnDragStart($event, conn.id)"
            @dragend="onConnDragEnd"
            @click.stop
            @dblclick.stop
          >
            <AppIcon name="grip" :size="10" />
          </span>
          <span
            class="sidebar-conn-dot"
            :style="conn.colorTag ? { background: getConnectionTagColor(conn.colorTag), opacity: 1 } : undefined"
          ></span>
          <span class="sidebar-conn-name" :title="conn.note || conn.name">{{ conn.name }}</span>
        </div>
      </div>
    </div>

    <div class="group-panel-footer">
      <button class="add-group-btn" @click="emit('add')">
        <AppIcon name="plus" :size="14" />
        <span>{{ t('groups.newGroup') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.group-panel {
  width: 220px;
  min-width: 220px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  user-select: none;
}

.group-panel-title {
  padding: 16px 16px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.group-search {
  padding: 0 8px 8px;
}

.group-search-input {
  width: 100%;
  padding: 7px 9px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.group-search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-bg);
}

.group-search-input::placeholder {
  color: var(--text-secondary);
}

.group-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px;
}

.group-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s ease;
  margin-bottom: 1px;
}

.group-item:hover {
  background: var(--hover-bg);
}

.group-item.active {
  background: var(--accent-bg);
}

.group-item.active .group-name {
  color: var(--accent);
  font-weight: 600;
}

.group-item.dragging {
  opacity: 0.4;
}

.group-item-content {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.group-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 3px;
  color: var(--text-secondary);
  opacity: 0;
  cursor: grab;
  transition: opacity 0.12s ease, background 0.12s ease;
}

.group-item:hover .group-drag-handle {
  opacity: 0.5;
}

.group-drag-handle:hover {
  opacity: 1 !important;
  background: var(--hover-bg);
  color: var(--text-primary);
}

.group-drag-handle:active {
  cursor: grabbing;
}

.group-name {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.group-count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.default-star {
  color: var(--warning);
  display: flex;
  align-items: center;
}

.collapse-btn {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
}

.collapse-btn:hover {
  color: var(--text-primary);
  background: var(--hover-bg);
}

.empty-groups {
  padding: 14px 8px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
}

.group-actions {
  display: flex;
  gap: 1px;
  opacity: 0;
  transition: opacity 0.15s;
}

.group-item:hover .group-actions {
  opacity: 1;
}

.icon-btn-tiny {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 3px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: all 0.15s;
}

.icon-btn-tiny:hover {
  color: var(--text-primary);
  background: var(--hover-bg);
}

.icon-btn-tiny.danger:hover {
  color: var(--danger);
}

.rename-input {
  width: 100%;
  padding: 2px 6px;
  background: var(--bg-primary);
  border: 1px solid var(--accent);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}

.drop-indicator {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent);
  border-radius: 1px;
}

.drop-indicator.top {
  top: -1px;
}

.drop-indicator.bottom {
  bottom: -1px;
}

.ungrouped {
  cursor: default;
}

.group-item.drop-target {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
  background: var(--accent-bg);
}

.sidebar-conn.dragging {
  opacity: 0.4;
}

.group-panel-footer {
  padding: 12px;
  border-top: 1px solid var(--border-color);
}

.add-group-btn {
  width: 100%;
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: transparent;
  color: var(--accent);
  border: 1px dashed var(--border-color);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.add-group-btn:hover {
  background: var(--accent-bg);
  border-color: var(--accent);
}

.group-connections {
  padding: 0 4px 2px 4px;
}

.sidebar-conn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px 5px 16px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.sidebar-conn:hover {
  background: var(--hover-bg);
}

.sidebar-conn-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 3px;
  color: var(--text-secondary);
  opacity: 0;
  cursor: grab;
  transition: opacity 0.12s ease, background 0.12s ease;
}

.sidebar-conn:hover .sidebar-conn-handle {
  opacity: 0.45;
}

.sidebar-conn-handle:hover {
  opacity: 1 !important;
  background: var(--hover-bg);
  color: var(--text-primary);
}

.sidebar-conn-handle:active {
  cursor: grabbing;
}

.sidebar-conn-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-secondary);
  flex-shrink: 0;
  opacity: 0.35;
}

.sidebar-conn-name {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-conn:hover .sidebar-conn-name {
  color: var(--text-primary);
}
</style>
