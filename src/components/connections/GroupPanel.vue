<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'
import type { Connection, Group } from '../../env.d.ts'
import {
  getConnectionTagColor,
  getConnectionTagLabel,
  hasConnectionColorTag,
} from '@/utils/connections/connectionTags'
import { createDragAutoScroll } from '@/utils/shared/dragAutoScroll'
import {
  dataTransferHasConn,
  getDataTransferConnId,
} from '@/utils/shared/legacyStorageMigrate'
import { clampPopupToViewport } from '@/utils/shared/popupPosition'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'

const { t } = useI18n()

const props = defineProps<{
  groups: Group[]
  activeGroupId: string | null
  connectionCounts: Record<string, number>
  connections: Connection[]
  connectingConnectionIds?: Set<string>
}>()

const emit = defineEmits<{
  (e: 'select', groupId: string): void
  (e: 'add'): void
  (e: 'rename', group: Group): void
  (e: 'delete', groupId: string): void
  (e: 'setDefault', groupId: string | null): void
  (e: 'reorder', orderedIds: string[]): void
  (e: 'connect', connectionId: string): void
  (e: 'moveConnection', connectionId: string, groupId: string | null): void
}>()

const GROUP_PANEL_WIDTH_KEY = 'liteconnect-group-panel-width'
const viewportWidth = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
const maxPanelWidth = computed(() => Math.min(400, Math.max(120, Math.floor(viewportWidth.value * 0.4))))
const minPanelWidth = computed(() => Math.min(180, maxPanelWidth.value))
const panelWidth = ref(220)
const resizing = ref(false)
let resizePointerId: number | null = null
let resizeStartX = 0
let resizeStartWidth = 0
let resizeHandle: HTMLElement | null = null

function clampPanelWidth(width: number) {
  return Math.round(Math.max(minPanelWidth.value, Math.min(maxPanelWidth.value, width)))
}
function persistPanelWidth() {
  try { globalThis.localStorage?.setItem(GROUP_PANEL_WIDTH_KEY, String(panelWidth.value)) } catch { /* Resizing still works without storage. */ }
}
function updateViewportWidth() {
  viewportWidth.value = window.innerWidth
  panelWidth.value = clampPanelWidth(panelWidth.value)
}
function movePanelResize(event: PointerEvent) {
  if (!resizing.value || event.pointerId !== resizePointerId) return
  panelWidth.value = clampPanelWidth(resizeStartWidth + event.clientX - resizeStartX)
}
function stopPanelResize(event?: PointerEvent) {
  if (event && event.pointerId !== resizePointerId) return
  const wasResizing = resizing.value
  resizing.value = false
  if (resizeHandle && resizePointerId !== null && resizeHandle.hasPointerCapture?.(resizePointerId)) resizeHandle.releasePointerCapture(resizePointerId)
  resizeHandle = null
  resizePointerId = null
  window.removeEventListener('pointermove', movePanelResize)
  window.removeEventListener('pointerup', stopPanelResize)
  window.removeEventListener('pointercancel', stopPanelResize)
  window.removeEventListener('blur', cancelPanelResize)
  if (wasResizing && event?.type === 'pointerup') persistPanelWidth()
}
function cancelPanelResize() { stopPanelResize() }
function startPanelResize(event: PointerEvent) {
  if (event.button !== 0 || resizing.value) return
  event.preventDefault()
  clearDragUiState()
  resizing.value = true
  resizePointerId = event.pointerId
  resizeStartX = event.clientX
  resizeStartWidth = panelWidth.value
  resizeHandle = event.currentTarget as HTMLElement
  resizeHandle.focus()
  resizeHandle.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', movePanelResize)
  window.addEventListener('pointerup', stopPanelResize)
  window.addEventListener('pointercancel', stopPanelResize)
  window.addEventListener('blur', cancelPanelResize)
}
function resizePanelWithKeyboard(event: KeyboardEvent) {
  let width = panelWidth.value
  if (event.key === 'ArrowLeft') width -= event.shiftKey ? 40 : 10
  else if (event.key === 'ArrowRight') width += event.shiftKey ? 40 : 10
  else if (event.key === 'Home') width = minPanelWidth.value
  else if (event.key === 'End') width = maxPanelWidth.value
  else return
  event.preventDefault()
  panelWidth.value = clampPanelWidth(width)
  persistPanelWidth()
}

const editingId = ref<string | null>(null)
const editingName = ref('')
const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)
const dragConnId = ref<string | null>(null)
const dropTargetGroupId = ref<string | null>(null)
const groupSearchQuery = ref('')
const expandedGroupIds = ref<Set<string>>(new Set())
const groupListRef = ref<HTMLElement | null>(null)
const groupDragAutoScroll = createDragAutoScroll()

/** Context menu target */
type CtxMenu =
  | { kind: 'group'; group: Group }
  | { kind: 'conn'; conn: Connection }
  | { kind: 'panel' }
  | null

const ctxMenu = ref<CtxMenu>(null)
const ctxMenuRef = ref<HTMLElement | null>(null)
const ctxMenuStyle = ref<Record<string, string>>({ left: '0px', top: '0px' })
let ctxPoint: { x: number; y: number } | null = null

const ctxMenuOpen = computed(() => ctxMenu.value != null)

function clearDragUiState() {
  dragIndex.value = null
  dropIndex.value = null
  dragConnId.value = null
  dropTargetGroupId.value = null
  groupDragAutoScroll.stop()
}

function closeCtxMenu() {
  ctxMenu.value = null
  ctxPoint = null
}

async function positionCtxMenu() {
  await nextTick()
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  const menu = ctxMenuRef.value
  if (!menu || !ctxPoint) return
  const size = {
    width: menu.offsetWidth || 160,
    height: menu.offsetHeight || 180,
  }
  const pos = clampPopupToViewport(ctxPoint, size)
  ctxMenuStyle.value = {
    left: `${pos.left}px`,
    top: `${pos.top}px`,
  }
}

function openCtxMenu(e: MouseEvent, menu: NonNullable<CtxMenu>) {
  const el = e.target as HTMLElement | null
  if (el?.closest('input, textarea, [contenteditable="true"]')) return
  if (el?.closest('.group-drag-handle, .sidebar-conn-handle')) return
  e.preventDefault()
  e.stopPropagation()
  ctxPoint = { x: e.clientX, y: e.clientY }
  ctxMenu.value = menu
  void positionCtxMenu()
}

function onGroupContextMenu(e: MouseEvent, group: Group) {
  openCtxMenu(e, { kind: 'group', group })
}

function onConnContextMenu(e: MouseEvent, conn: Connection) {
  openCtxMenu(e, { kind: 'conn', conn })
}

function onPanelContextMenu(e: MouseEvent) {
  const el = e.target as HTMLElement | null
  if (el?.closest('.group-item, .sidebar-conn, .group-actions, .add-group-btn, input, button')) return
  openCtxMenu(e, { kind: 'panel' })
}

function onGroupMenuAction(
  action: 'select' | 'rename' | 'setDefault' | 'toggleCollapse' | 'delete',
  group: Group,
) {
  closeCtxMenu()
  if (action === 'select') emit('select', group.id)
  else if (action === 'rename') startRename(group)
  else if (action === 'setDefault' && !group.isDefault) emit('setDefault', group.id)
  else if (action === 'toggleCollapse') toggleGroupCollapsed(group.id)
  else if (action === 'delete') emit('delete', group.id)
}

function onConnMenuAction(action: 'connect' | 'selectGroup', conn: Connection) {
  closeCtxMenu()
  if (action === 'connect') requestConnection(conn.id)
  else if (action === 'selectGroup' && conn.group) emit('select', conn.group)
}

function requestConnection(connectionId: string) {
  if (props.connectingConnectionIds?.has(connectionId)) return
  emit('connect', connectionId)
}

function onPanelMenuAction(action: 'add') {
  closeCtxMenu()
  if (action === 'add') emit('add')
}

watch(ctxMenu, (m) => {
  if (m) void positionCtxMenu()
})

useOutsideDismiss(
  ctxMenuOpen,
  closeCtxMenu,
  () => [ctxMenuRef.value],
)

/** Single cleanup path for local + main-list-originated drags */
onMounted(() => {
  try {
    const stored = Number(globalThis.localStorage?.getItem(GROUP_PANEL_WIDTH_KEY))
    if (Number.isFinite(stored) && stored > 0) panelWidth.value = stored
  } catch { /* Use the default width when storage is unavailable. */ }
  updateViewportWidth()
  window.addEventListener('resize', updateViewportWidth)
  document.addEventListener('dragend', clearDragUiState, true)
})

onBeforeUnmount(() => {
  cancelPanelResize()
  window.removeEventListener('resize', updateViewportWidth)
  document.removeEventListener('dragend', clearDragUiState, true)
  clearDragUiState()
  closeCtxMenu()
})

const normalizedGroupSearchQuery = computed(() => groupSearchQuery.value.trim().toLowerCase())

const visibleGroups = computed(() => {
  const query = normalizedGroupSearchQuery.value
  if (!query) return props.groups
  return props.groups.filter((group) => {
    if (group.name.toLowerCase().includes(query)) return true
    return getConnectionsForGroup(group.id).some((conn) => matchesConnection(conn, query))
  })
})

function getConnectionsForGroup(groupId: string): Connection[] {
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
  return !normalizedGroupSearchQuery.value && !expandedGroupIds.value.has(groupId)
}

function toggleGroupCollapsed(groupId: string) {
  const next = new Set(expandedGroupIds.value)
  if (next.has(groupId)) {
    next.delete(groupId)
  } else {
    next.add(groupId)
  }
  expandedGroupIds.value = next
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
  groupDragAutoScroll.start(() => groupListRef.value)
}

function onDragOver(e: DragEvent, index: number) {
  if (dragConnId.value || index < 0) return
  // Connection drags (sidebar or main list) are not group reorder
  if (dataTransferHasConn(e.dataTransfer)) return
  e.preventDefault()
  dropIndex.value = index
}

function onDrop(e: DragEvent, index: number) {
  e.preventDefault()
  // Connection drop is handled by onGroupDropConn; don't treat as group reorder
  if (dragConnId.value || dataTransferHasConn(e.dataTransfer) || index < 0) {
    return
  }
  if (dragIndex.value !== null && dragIndex.value !== index) {
    const ids = props.groups.map((g) => g.id)
    const [moved] = ids.splice(dragIndex.value, 1)
    ids.splice(index, 0, moved)
    emit('reorder', ids)
  }
  clearDragUiState()
}

function onConnDragStart(e: DragEvent, connId: string) {
  dragConnId.value = connId
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-lite-connect-conn', connId)
    e.dataTransfer.setData('text/plain', connId)
  }
  groupDragAutoScroll.start(() => groupListRef.value)
}

function isConnectionDrag(e: DragEvent): boolean {
  return !!dragConnId.value || dataTransferHasConn(e.dataTransfer)
}

function onGroupDragOverConn(e: DragEvent, groupId: string) {
  if (!isConnectionDrag(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  // Also start when drag originates from the main list (no local dragstart)
  groupDragAutoScroll.start(() => groupListRef.value)
  dropTargetGroupId.value = groupId
}

/** Leave only when pointer exits the whole group block (not child→child). */
function onGroupBlockDragLeave(e: DragEvent) {
  const current = e.currentTarget as HTMLElement | null
  const related = e.relatedTarget as Node | null
  if (current && related && current.contains(related)) return
  dropTargetGroupId.value = null
}

function onGroupItemDragLeave(e: DragEvent) {
  const current = e.currentTarget as HTMLElement | null
  const related = e.relatedTarget as Node | null
  if (current && related && current.contains(related)) return
  dropIndex.value = null
}

function onGroupItemDragOver(e: DragEvent, groupId: string) {
  // Title row: group reorder indicators + connection drop highlight
  onDragOver(e, getGroupIndex(groupId))
  onGroupDragOverConn(e, groupId)
}

function onGroupItemDrop(e: DragEvent, groupId: string) {
  // Prefer connection move when a connection is being dragged (including from main list)
  if (isConnectionDrag(e)) {
    onGroupDropConn(e, groupId)
    return
  }
  onDrop(e, getGroupIndex(groupId))
}

function onGroupDropConn(e: DragEvent, groupId: string) {
  e.preventDefault()
  // Title row also handles drop; stop bubbling so moveConnection fires once
  e.stopPropagation()
  const connId = dragConnId.value || getDataTransferConnId(e.dataTransfer)
  // Same-group no-op is enforced in onMoveConnection; always emit when we have an id
  if (connId) emit('moveConnection', connId, groupId)
  clearDragUiState()
}

</script>

<template>
  <div class="group-panel" :class="{ resizing }" :style="{ width: `${panelWidth}px` }" @contextmenu="onPanelContextMenu">
    <div
      class="group-panel-resizer"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      :aria-label="t('groups.resizePanel')"
      :title="t('groups.resizePanelHint')"
      :aria-valuemin="minPanelWidth"
      :aria-valuemax="maxPanelWidth"
      :aria-valuenow="panelWidth"
      @pointerdown.stop="startPanelResize"
      @lostpointercapture="stopPanelResize"
      @keydown="resizePanelWithKeyboard"
      @click.stop
      @contextmenu.stop.prevent
    ></div>
    <div class="group-panel-title">{{ t('groups.title') }}</div>
    <div class="group-search">
      <input
        v-model="groupSearchQuery"
        class="group-search-input"
        :placeholder="t('groups.searchPlaceholder')"
      />
    </div>
    <div ref="groupListRef" class="group-list">
      <template v-for="group in visibleGroups" :key="group.id">
        <!-- Whole block accepts connection drops (not only the thin title row) -->
        <div
          class="group-block"
          :class="{ 'drop-target': dropTargetGroupId === group.id }"
          @dragover="onGroupDragOverConn($event, group.id)"
          @dragleave="onGroupBlockDragLeave"
          @drop="onGroupDropConn($event, group.id)"
        >
          <div
            class="group-item"
            tabindex="0"
            @keydown.enter.self="emit('select', group.id)"
            @keydown.space.self.prevent="emit('select', group.id)"
            :class="{
              active: group.id === activeGroupId,
              dragging: dragIndex === getGroupIndex(group.id),
              'drop-above': dropIndex === getGroupIndex(group.id) && dragIndex !== null && dragIndex < getGroupIndex(group.id),
              'drop-below': dropIndex === getGroupIndex(group.id) && dragIndex !== null && dragIndex > getGroupIndex(group.id),
            }"
            @click="emit('select', group.id)"
            @contextmenu="onGroupContextMenu($event, group)"
            @dragover="onGroupItemDragOver($event, group.id)"
            @dragleave="onGroupItemDragLeave"
            @drop="onGroupItemDrop($event, group.id)"
          >
            <div v-if="dropIndex === getGroupIndex(group.id) && dragIndex !== null && dragIndex < getGroupIndex(group.id)" class="drop-indicator top"></div>
            <div class="group-item-content">
              <span
                class="group-drag-handle"
                draggable="true"
                :title="t('groups.dragSort')"
                :aria-label="t('groups.dragSort')"
                @dragstart.stop="onDragStart(getGroupIndex(group.id))"
                @click.stop
              >
                <AppIcon name="grip" size="xs" />
              </span>
              <button
                class="collapse-btn"
                :aria-expanded="!isGroupCollapsed(group.id)"
                :aria-label="t(isGroupCollapsed(group.id) ? 'groups.expand' : 'groups.collapse')"
                @click.stop="toggleGroupCollapsed(group.id)"
              >
                <AppIcon :name="isGroupCollapsed(group.id) ? 'chevron-right' : 'chevron-down'" size="xs" />
              </button>
              <span v-if="group.isDefault" class="default-star" :title="t('groups.defaultGroup')">
                <AppIcon name="star-fill" size="xs" />
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
                <span class="group-name" :title="group.name">{{ group.name }}</span>
                <span class="group-count">{{ connectionCounts[group.id] || 0 }}</span>
              </template>
            </div>
            <div v-if="editingId !== group.id" class="group-actions">
              <el-tooltip :content="t('groups.rename')" placement="right">
                <button class="icon-btn-tiny" @click.stop="startRename(group)">
                  <AppIcon name="edit" size="xs" />
                </button>
              </el-tooltip>
              <el-tooltip
                :content="group.isDefault ? t('groups.defaultGroup') : t('groups.setDefault')"
                placement="right"
              >
                <button
                  class="icon-btn-tiny"
                  :disabled="group.isDefault"
                  @click.stop="!group.isDefault && emit('setDefault', group.id)"
                >
                  <AppIcon :name="group.isDefault ? 'star-fill' : 'star'" size="xs" />
                </button>
              </el-tooltip>
              <el-tooltip :content="t('groups.delete')" placement="right">
                <button class="icon-btn-tiny danger" @click.stop="emit('delete', group.id)">
                  <AppIcon name="delete" size="xs" />
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
              :class="{ dragging: dragConnId === conn.id, connecting: connectingConnectionIds?.has(conn.id) }"
              :aria-busy="connectingConnectionIds?.has(conn.id)"
              @dblclick="requestConnection(conn.id)"
              @contextmenu="onConnContextMenu($event, conn)"
            >
              <span
                class="sidebar-conn-handle"
                draggable="true"
                :title="t('groups.dragToOther')"
                @dragstart.stop="onConnDragStart($event, conn.id)"
                @click.stop
                @dblclick.stop
              >
                <AppIcon name="grip" size="xs" />
              </span>
              <span
                class="sidebar-conn-dot"
                :class="{ 'has-tag': hasConnectionColorTag(conn.colorTag) }"
                :style="{ background: getConnectionTagColor(conn.colorTag) }"
                :title="
                  hasConnectionColorTag(conn.colorTag)
                    ? `${t('connections.colorTag')}: ${getConnectionTagLabel(conn.colorTag)}`
                    : t('connections.colorTagDefault')
                "
                :aria-label="
                  hasConnectionColorTag(conn.colorTag)
                    ? `${t('connections.colorTag')}: ${getConnectionTagLabel(conn.colorTag)}`
                    : t('connections.colorTagDefault')
                "
                role="img"
              ></span>
              <span class="sidebar-conn-name" :title="conn.note || conn.name">{{ conn.name }}</span>
              <span v-if="connectingConnectionIds?.has(conn.id)" class="sidebar-conn-spinner" :title="t('connections.connectingTitle')"></span>
            </div>
          </div>
        </div>
      </template>

      <div v-if="visibleGroups.length === 0" class="ui-empty ui-empty-compact empty-groups">
        <p class="ui-empty-desc">{{ t('groups.noMatch') }}</p>
      </div>
    </div>

    <div class="group-panel-footer">
      <button class="add-group-btn" @click="emit('add')">
        <AppIcon name="plus" size="sm" />
        <span>{{ t('groups.newGroup') }}</span>
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="ctxMenu"
        ref="ctxMenuRef"
        class="ui-menu"
        role="menu"
        :style="ctxMenuStyle"
        @click.stop
        @contextmenu.prevent
      >
        <!-- Group row -->
        <template v-if="ctxMenu.kind === 'group'">
          <button
            type="button"
            class="ui-menu-item"
            role="menuitem"
            @click="onGroupMenuAction('select', ctxMenu.group)"
          >
            <AppIcon name="folder" size="sm" class="group-ctx-icon" />
            {{ t('groups.openGroup') }}
          </button>
          <button
            type="button"
            class="ui-menu-item"
            role="menuitem"
            @click="onGroupMenuAction('rename', ctxMenu.group)"
          >
            <AppIcon name="edit" size="sm" class="group-ctx-icon" />
            {{ t('groups.rename') }}
          </button>
          <button
            type="button"
            class="ui-menu-item"
            role="menuitem"
            :disabled="ctxMenu.group.isDefault"
            @click="onGroupMenuAction('setDefault', ctxMenu.group)"
          >
            <AppIcon
              :name="ctxMenu.group.isDefault ? 'star-fill' : 'star'"
              size="sm"
              class="group-ctx-icon"
            />
            {{ ctxMenu.group.isDefault ? t('groups.defaultGroup') : t('groups.setDefault') }}
          </button>
          <button
            type="button"
            class="ui-menu-item"
            role="menuitem"
            @click="onGroupMenuAction('toggleCollapse', ctxMenu.group)"
          >
            <AppIcon
              :name="isGroupCollapsed(ctxMenu.group.id) ? 'chevron-right' : 'chevron-down'"
              size="sm"
              class="group-ctx-icon"
            />
            {{
              isGroupCollapsed(ctxMenu.group.id) ? t('groups.expand') : t('groups.collapse')
            }}
          </button>
          <div class="ui-menu-sep" role="separator"></div>
          <button
            type="button"
            class="ui-menu-item danger"
            role="menuitem"
            @click="onGroupMenuAction('delete', ctxMenu.group)"
          >
            <AppIcon name="delete" size="sm" class="group-ctx-icon" />
            {{ t('groups.delete') }}
          </button>
        </template>

        <!-- Sidebar connection -->
        <template v-else-if="ctxMenu.kind === 'conn'">
          <button
            type="button"
            class="ui-menu-item"
            role="menuitem"
            :disabled="connectingConnectionIds?.has(ctxMenu.conn.id)"
            @click="onConnMenuAction('connect', ctxMenu.conn)"
          >
            <AppIcon name="link" size="sm" class="group-ctx-icon" />
            {{ connectingConnectionIds?.has(ctxMenu.conn.id) ? t('connections.connecting') : t('connections.connect') }}
          </button>
          <button
            v-if="ctxMenu.conn.group"
            type="button"
            class="ui-menu-item"
            role="menuitem"
            @click="onConnMenuAction('selectGroup', ctxMenu.conn)"
          >
            <AppIcon name="folder" size="sm" class="group-ctx-icon" />
            {{ t('groups.viewInGroup') }}
          </button>
        </template>

        <!-- Empty panel area -->
        <template v-else-if="ctxMenu.kind === 'panel'">
          <button
            type="button"
            class="ui-menu-item"
            role="menuitem"
            @click="onPanelMenuAction('add')"
          >
            <AppIcon name="plus" size="sm" class="group-ctx-icon" />
            {{ t('groups.newGroup') }}
          </button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.group-panel {
  position: relative;
  min-width: 0;
  flex-shrink: 0;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  user-select: none;
}

.group-panel-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  right: -3px;
  width: 7px;
  z-index: 3;
  cursor: col-resize;
  touch-action: none;
  outline: none;
}
.group-panel-resizer::after {
  content: '';
  position: absolute;
  inset: 0 2px;
  background: transparent;
}
.group-panel-resizer:hover::after,
.group-panel-resizer:focus-visible::after,
.group-panel.resizing .group-panel-resizer::after { background: var(--accent); }
.group-panel-resizer:focus-visible { box-shadow: 0 0 0 2px var(--accent-bg); }
.group-panel.resizing { cursor: col-resize; }

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
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 8px;
}

.group-block {
  border-radius: 6px;
  margin-bottom: 2px;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}

.group-block.drop-target {
  background: var(--accent-bg);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
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
  /* Always visible — the handle already reserves layout space */
  opacity: 0.45;
  cursor: grab;
  transition: opacity 0.12s ease, background 0.12s ease;
}

.group-item:hover .group-drag-handle {
  opacity: 0.7;
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
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.group-count {
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 10px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.default-star {
  flex-shrink: 0;
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
}

.group-actions {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 4px;
  background: linear-gradient(var(--hover-bg), var(--hover-bg)), var(--bg-secondary);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
}

.group-item:hover .group-actions,
.group-item:focus-within .group-actions { opacity: 1; pointer-events: auto; }
.group-item.active .group-actions { background: linear-gradient(var(--accent-bg), var(--accent-bg)), var(--bg-secondary); }
.group-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
@media (hover: none) {
  .group-item:focus-within .group-actions { opacity: 1; }
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

.sidebar-conn.connecting {
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-secondary));
  cursor: wait;
}

.sidebar-conn-spinner {
  width: 11px;
  height: 11px;
  margin-left: auto;
  flex-shrink: 0;
  border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: sidebar-conn-spin 0.75s linear infinite;
}

@keyframes sidebar-conn-spin {
  to { transform: rotate(360deg); }
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
  /* Always visible — the handle already reserves layout space */
  opacity: 0.45;
  cursor: grab;
  transition: opacity 0.12s ease, background 0.12s ease;
}

.sidebar-conn:hover .sidebar-conn-handle {
  opacity: 0.7;
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
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-secondary);
  flex-shrink: 0;
  opacity: 0.55;
  box-shadow: 0 0 0 1px var(--border-color);
  transition: opacity 0.12s ease, box-shadow 0.12s ease;
}

.sidebar-conn-dot.has-tag {
  opacity: 1;
}

.sidebar-conn:hover .sidebar-conn-dot {
  opacity: 1;
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
