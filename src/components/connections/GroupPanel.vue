<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'
import VirtualList from '@/components/common/VirtualList.vue'
import type { Connection, Group } from '../../env.d.ts'
import {
  CONNECTION_COLOR_TAGS,
  getConnectionTagColor,
  getConnectionTagLabel,
  hasConnectionColorTag,
} from '@/utils/connections/connectionTags'
import type { ConnectionSmartView } from '@/composables/connections/useConnectionList'
import { createDragAutoScroll } from '@/utils/shared/dragAutoScroll'
import { createRowDragGuard } from '@/utils/shared/rowDrag'
import {
  dataTransferHasConn,
  getDataTransferConnId,
} from '@/utils/shared/legacyStorageMigrate'
import { clampPopupToViewport } from '@/utils/shared/popupPosition'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'
import { buildGroupTree } from '@shared/groupTree'

const { t } = useI18n()
const connectionKey = (connection: Connection) => connection.id

const props = defineProps<{
  groups: Group[]
  activeGroupId: string | null
  smartView?: ConnectionSmartView | null
  allConnectionsActive?: boolean
  connectionCounts: Record<string, number>
  smartViewCounts?: { pinned: number; recent: number; tags: Record<string, number> }
  usedColorTags?: { id: string; color: string; label: string }[]
  connections: Connection[]
  connectingConnectionIds?: Set<string>
  connectionErrors?: Record<string, string>
}>()

const emit = defineEmits<{
  (e: 'select', groupId: string): void
  (e: 'select-smart', view: ConnectionSmartView): void
  (e: 'select-all'): void
  (e: 'add', parentId?: string): void
  (e: 'rename', group: Group): void
  (e: 'delete', groupId: string): void
  (e: 'setDefault', groupId: string | null): void
  (e: 'reorder', orderedIds: string[]): void
  (e: 'moveGroup', groupId: string, parentId: string | null): void
  (e: 'connect', connectionId: string): void
  (e: 'cancel-connect', connectionId: string): void
  (e: 'pin', connectionId: string): void
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
const searchCollapsedGroupIds = ref<Set<string>>(new Set())
const groupListRef = ref<HTMLElement | null>(null)
const groupDragAutoScroll = createDragAutoScroll()
const dragGuard = createRowDragGuard()

/** Context menu target */
type CtxMenu =
  | { kind: 'group'; group: Group }
  | { kind: 'conn'; conn: Connection }
  | { kind: 'panel' }
  | null

const ctxMenu = ref<CtxMenu>(null)
const choosingGroupParent = ref(false)
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
  choosingGroupParent.value = false
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
    maxHeight: `${Math.min(360, window.innerHeight - 16)}px`,
    overflowY: 'auto',
  }
}

function openCtxMenu(e: MouseEvent, menu: NonNullable<CtxMenu>) {
  const el = e.target as HTMLElement | null
  if (el?.closest('input, textarea, [contenteditable="true"]')) return
  e.preventDefault()
  e.stopPropagation()
  ctxPoint = { x: e.clientX, y: e.clientY }
  choosingGroupParent.value = false
  ctxMenu.value = menu
  void positionCtxMenu()
}

function onGroupContextMenu(e: MouseEvent, group: Group) {
  openCtxMenu(e, { kind: 'group', group })
}

function onGroupActions(e: MouseEvent, group: Group) {
  const anchor = (e.currentTarget as HTMLElement).getBoundingClientRect()
  openCtxMenu(e, { kind: 'group', group })
  ctxPoint = { x: anchor.left, y: anchor.bottom + 4 }
  void positionCtxMenu()
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
  action: 'select' | 'add' | 'rename' | 'setDefault' | 'toggleCollapse' | 'delete',
  group: Group,
) {
  closeCtxMenu()
  if (action === 'select') selectGroup(group.id)
  else if (action === 'add') emit('add', group.id)
  else if (action === 'rename') startRename(group)
  else if (action === 'setDefault' && !group.isDefault) emit('setDefault', group.id)
  else if (action === 'toggleCollapse') toggleGroupCollapsed(group.id)
  else if (action === 'delete') emit('delete', group.id)
}

function onConnMenuAction(action: 'connect' | 'selectGroup' | 'pin', conn: Connection) {
  closeCtxMenu()
  if (action === 'connect') requestConnection(conn.id)
  else if (action === 'selectGroup' && conn.group) selectGroup(conn.group)
  else if (action === 'pin') emit('pin', conn.id)
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

watch(choosingGroupParent, () => { if (ctxMenu.value) void positionCtxMenu() })

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
const groupTree = computed(() => buildGroupTree(props.groups))
const moveTargets = computed(() => {
  const menu = ctxMenu.value
  if (menu?.kind !== 'group') return []
  const excluded = groupTree.value.getSubtreeIds(menu.group.id)
  return groupTree.value.rows.filter(({ group }) => !excluded.has(group.id))
})

function moveGroupTo(parentId: string | null) {
  if (ctxMenu.value?.kind !== 'group') return
  const groupId = ctxMenu.value.group.id
  closeCtxMenu()
  emit('moveGroup', groupId, parentId)
}

// Search reveals matches, but users can still collapse results for this query.
// Keep those overrides separate so clearing search restores the normal tree.
watch(normalizedGroupSearchQuery, () => {
  searchCollapsedGroupIds.value = new Set()
}, { flush: 'sync' })

const visibleGroups = computed(() => {
  const query = normalizedGroupSearchQuery.value
  const tree = groupTree.value
  const matching = new Set<string>()
  if (query) {
    for (const { group } of tree.rows) {
      if (!tree.getPath(group.id).toLowerCase().includes(query)
        && !getConnectionsForGroup(group.id).some(conn => matchesConnection(conn, query))) continue
      matching.add(group.id)
      for (const ancestor of tree.getAncestors(group.id)) matching.add(ancestor.id)
    }
  }
  return tree.rows.filter(({ group }) => {
    if (query && !matching.has(group.id)) return false
    return tree.getAncestors(group.id).every(ancestor => !isGroupCollapsed(ancestor.id))
  })
})

const connectionsByGroup = computed(() => {
  const grouped = new Map<string, Connection[]>()
  for (const connection of props.connections) {
    const id = connection.group || ''
    const entries = grouped.get(id)
    if (entries) entries.push(connection)
    else grouped.set(id, [connection])
  }
  return grouped
})

function getConnectionsForGroup(groupId: string): Connection[] {
  return connectionsByGroup.value.get(groupId) || []
}

function getGroupIndex(groupId: string): number {
  return props.groups.findIndex((g) => g.id === groupId)
}

function getVisibleConnectionsForGroup(groupId: string): Connection[] {
  const query = normalizedGroupSearchQuery.value
  const connections = getConnectionsForGroup(groupId)
  if (!query) return connections
  if (groupTree.value.getPath(groupId).toLowerCase().includes(query)) return connections
  return connections.filter((conn) => matchesConnection(conn, query))
}

function matchesConnection(conn: Connection, query: string): boolean {
  const tag = conn.colorTag || ''
  const tagLabel = CONNECTION_COLOR_TAGS.find((item) => item.id === tag)?.label || ''
  return (
    conn.name.toLowerCase().includes(query) ||
    conn.host.toLowerCase().includes(query) ||
    conn.username.toLowerCase().includes(query) ||
    (conn.note || '').toLowerCase().includes(query) ||
    tag.toLowerCase().includes(query) ||
    tagLabel.toLowerCase().includes(query)
  )
}

function isGroupCollapsed(groupId: string): boolean {
  return normalizedGroupSearchQuery.value
    ? searchCollapsedGroupIds.value.has(groupId)
    : !expandedGroupIds.value.has(groupId)
}

function expandGroup(groupId: string) {
  if (normalizedGroupSearchQuery.value) {
    if (searchCollapsedGroupIds.value.has(groupId)) {
      const next = new Set(searchCollapsedGroupIds.value)
      next.delete(groupId)
      searchCollapsedGroupIds.value = next
    }
    return
  }
  if (expandedGroupIds.value.has(groupId)) return
  const next = new Set(expandedGroupIds.value)
  next.add(groupId)
  expandedGroupIds.value = next
}

function toggleGroupCollapsed(groupId: string) {
  if (normalizedGroupSearchQuery.value) {
    const next = new Set(searchCollapsedGroupIds.value)
    if (next.has(groupId)) next.delete(groupId)
    else next.add(groupId)
    searchCollapsedGroupIds.value = next
    return
  }
  const next = new Set(expandedGroupIds.value)
  if (next.has(groupId)) {
    next.delete(groupId)
  } else {
    next.add(groupId)
  }
  expandedGroupIds.value = next
}

function selectGroup(groupId: string) {
  for (const ancestor of groupTree.value.getAncestors(groupId)) expandGroup(ancestor.id)
  expandGroup(groupId)
  emit('select', groupId)
}

function activateGroup(groupId: string) {
  if (groupId === props.activeGroupId && !props.smartView && !props.allConnectionsActive) {
    toggleGroupCollapsed(groupId)
  } else {
    selectGroup(groupId)
  }
}

function tagSmartView(tagId: string): ConnectionSmartView {
  return `tag:${tagId}`
}

function isTagSmartView(tagId: string) {
  return props.smartView === tagSmartView(tagId)
}

watch(
  [() => props.activeGroupId, () => props.smartView, () => props.allConnectionsActive,
    () => groupTree.value.getAncestors(props.activeGroupId || '').map(group => group.id).join('/')],
  ([groupId, smartView, allConnections]) => {
    if (groupId && !smartView && !allConnections) {
      for (const ancestor of groupTree.value.getAncestors(groupId)) expandGroup(ancestor.id)
      expandGroup(groupId)
    }
  },
  { immediate: true },
)

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

function onDragStart(e: DragEvent, index: number) {
  if (!dragGuard.canStart(e)) return
  if (dragConnId.value || index < 0 || editingId.value || normalizedGroupSearchQuery.value) {
    e.preventDefault()
    return
  }
  closeCtxMenu()
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-lite-connect-group', props.groups[index].id)
  }
  dragIndex.value = index
  groupDragAutoScroll.start(() => groupListRef.value)
}

function onDragOver(e: DragEvent, index: number) {
  if (dragConnId.value || index < 0) return
  // Connection drags (sidebar or main list) are not group reorder
  if (dataTransferHasConn(e.dataTransfer)) return
  if (!canReorderTo(index)) return
  e.preventDefault()
  dropIndex.value = index
}

function canReorderTo(index: number) {
  if (dragIndex.value === null || index < 0) return false
  const source = props.groups[dragIndex.value]
  const target = props.groups[index]
  return !!source && !!target
    && groupTree.value.getParentId(source.id) === groupTree.value.getParentId(target.id)
}

function onDrop(e: DragEvent, index: number) {
  e.preventDefault()
  // Connection drop is handled by onGroupDropConn; don't treat as group reorder
  if (dragConnId.value || dataTransferHasConn(e.dataTransfer) || index < 0) {
    return
  }
  if (!canReorderTo(index)) {
    clearDragUiState()
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
  if (!dragGuard.canStart(e)) return
  closeCtxMenu()
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
    <div class="group-panel-title">{{ t('groups.navigation') }}</div>
    <div class="group-search">
      <input
        v-model="groupSearchQuery"
        class="group-search-input"
        :placeholder="t('groups.searchPlaceholder')"
        :aria-label="t('groups.searchAria')"
        :title="t('groups.searchHint')"
      />
    </div>
    <div ref="groupListRef" class="group-list">
      <section v-if="!normalizedGroupSearchQuery" class="smart-section">
        <h4 class="smart-section-title">{{ t('groups.smartViews') }}</h4>
        <button type="button" class="smart-item" data-view="all" :class="{ active: allConnectionsActive }" :aria-current="allConnectionsActive ? 'page' : undefined" @click="emit('select-all')">
          <AppIcon name="home-grid" size="xs" />
          <span class="smart-item-name">{{ t('connections.allConnections') }}</span>
          <span class="group-count">{{ connections.length }}</span>
        </button>
        <button
          type="button"
          class="smart-item"
          :class="{ active: smartView === 'pinned' }"
          data-view="pinned"
          @click="emit('select-smart', 'pinned')"
        >
          <AppIcon name="pin" size="xs" />
          <span class="smart-item-name">{{ t('connections.smartPinned') }}</span>
          <span class="group-count">{{ smartViewCounts?.pinned || 0 }}</span>
        </button>
        <button
          type="button"
          class="smart-item"
          :class="{ active: smartView === 'recent' }"
          data-view="recent"
          @click="emit('select-smart', 'recent')"
        >
          <AppIcon name="history" size="xs" />
          <span class="smart-item-name">{{ t('connections.smartRecent') }}</span>
          <span class="group-count">{{ smartViewCounts?.recent || 0 }}</span>
        </button>
      </section>

      <section v-if="!normalizedGroupSearchQuery && usedColorTags?.length" class="smart-section">
        <h4 class="smart-section-title">{{ t('groups.tags') }}</h4>
        <button
          v-for="tag in usedColorTags"
          :key="tag.id"
          type="button"
          class="smart-item"
          :class="{ active: isTagSmartView(tag.id) }"
          @click="emit('select-smart', tagSmartView(tag.id))"
        >
          <span class="smart-tag-swatch" :style="{ background: tag.color }"></span>
          <span class="smart-item-name">{{ tag.label }}</span>
          <span class="group-count">{{ smartViewCounts?.tags[tag.id] || 0 }}</span>
        </button>
      </section>

      <h4 v-if="!normalizedGroupSearchQuery" class="smart-section-title groups-section-title">{{ t('groups.title') }}</h4>
      <template v-for="{ group, depth } in visibleGroups" :key="group.id">
        <!-- Whole block accepts connection drops (not only the thin title row) -->
        <div
          class="group-block"
          :data-group-id="group.id"
          :data-depth="depth"
          :style="{ marginLeft: `${depth * 12}px` }"
          :class="{ 'drop-target': dropTargetGroupId === group.id }"
          @dragover="onGroupDragOverConn($event, group.id)"
          @dragleave="onGroupBlockDragLeave"
          @drop="onGroupDropConn($event, group.id)"
        >
          <div
            class="group-item"
            :draggable="editingId !== group.id && !normalizedGroupSearchQuery"
            :title="t('groups.dragSort')"
            tabindex="0"
            @pointerdown="dragGuard.pointerDown"
            @dragstart.stop="onDragStart($event, getGroupIndex(group.id))"
            @keydown.enter.self="activateGroup(group.id)"
            @keydown.space.self.prevent="activateGroup(group.id)"
            @keydown.right.self.prevent="expandGroup(group.id)"
            @keydown.left.self.prevent="!isGroupCollapsed(group.id) && toggleGroupCollapsed(group.id)"
            :class="{
              active: !smartView && !allConnectionsActive && group.id === activeGroupId,
              dragging: dragIndex === getGroupIndex(group.id),
              'drop-above': dropIndex === getGroupIndex(group.id) && dragIndex !== null && dragIndex < getGroupIndex(group.id),
              'drop-below': dropIndex === getGroupIndex(group.id) && dragIndex !== null && dragIndex > getGroupIndex(group.id),
            }"
            @click="activateGroup(group.id)"
            @contextmenu="onGroupContextMenu($event, group)"
            @dragover="onGroupItemDragOver($event, group.id)"
            @dragleave="onGroupItemDragLeave"
            @drop="onGroupItemDrop($event, group.id)"
          >
            <div v-if="dropIndex === getGroupIndex(group.id) && dragIndex !== null && dragIndex < getGroupIndex(group.id)" class="drop-indicator top"></div>
            <div class="group-item-content">
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
                <span class="group-name" :title="groupTree.getPath(group.id)">{{ group.name }}</span>
                <span class="group-count">{{ connectionCounts[group.id] || 0 }}</span>
              </template>
            </div>
            <div v-if="editingId !== group.id" class="group-actions">
              <el-tooltip :content="t('groups.newSubgroup')" placement="right">
                <button class="icon-btn-tiny" :aria-label="t('groups.newSubgroup')" @click.stop="emit('add', group.id)">
                  <AppIcon name="plus" size="xs" />
                </button>
              </el-tooltip>
              <el-tooltip :content="t('groups.moreActions')" placement="right">
                <button class="icon-btn-tiny" :aria-label="t('groups.moreActions')" @click.stop="onGroupActions($event, group)">
                  <AppIcon name="more" size="xs" />
                </button>
              </el-tooltip>
            </div>
            <div v-if="dropIndex === getGroupIndex(group.id) && dragIndex !== null && dragIndex > getGroupIndex(group.id)" class="drop-indicator bottom"></div>
          </div>
          <div v-if="!isGroupCollapsed(group.id)" class="group-connections">
            <VirtualList
              :items="getVisibleConnectionsForGroup(group.id)"
              :item-key="connectionKey"
              :estimated-size="30"
              :scroll-container="groupListRef"
              :pinned-key="dragConnId"
              v-slot="{ item: conn }"
            >
            <div
              class="sidebar-conn"
              draggable="true"
              :title="t('groups.dragToOther')"
              @pointerdown="dragGuard.pointerDown"
              @dragstart.stop="onConnDragStart($event, conn.id)"
              :class="{
                dragging: dragConnId === conn.id,
                connecting: connectingConnectionIds?.has(conn.id),
                pinned: !!conn.pinned,
              }"
              :aria-busy="connectingConnectionIds?.has(conn.id)"
              @dblclick="requestConnection(conn.id)"
              @contextmenu="onConnContextMenu($event, conn)"
            >
              <span class="sidebar-conn-mark">
                <span
                  v-if="hasConnectionColorTag(conn.colorTag)"
                  class="sidebar-conn-dot"
                  :style="{ background: getConnectionTagColor(conn.colorTag) }"
                  :title="`${t('connections.colorTag')}: ${getConnectionTagLabel(conn.colorTag)}`"
                  :aria-label="`${t('connections.colorTag')}: ${getConnectionTagLabel(conn.colorTag)}`"
                  role="img"
                ></span>
              </span>
              <span class="sidebar-conn-name" :title="conn.note || conn.name">{{ conn.name }}</span>
              <span v-if="connectingConnectionIds?.has(conn.id)" class="sidebar-conn-spinner" :title="t('connections.connectingTitle')"></span>
              <button v-else-if="connectionErrors?.[conn.id]" type="button" class="ui-icon-btn ui-icon-btn-ghost sidebar-conn-action" :title="connectionErrors[conn.id]" :aria-label="`${t('terminal.retryConnection')}：${connectionErrors[conn.id]}`" @click.stop="requestConnection(conn.id)" @dblclick.stop><AppIcon name="alert-circle" size="xs" :style="{ color: 'var(--danger)' }" /></button>
              <button
                v-if="connectingConnectionIds?.has(conn.id)"
                type="button"
                class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-close sidebar-conn-action"
                :title="t('common.cancel')"
                :aria-label="t('common.cancel')"
                @click.stop="emit('cancel-connect', conn.id)"
                @dblclick.stop
              >
                <AppIcon name="close" size="xs" />
              </button>
              <button
                v-else
                type="button"
                class="sidebar-conn-pin"
                :class="{ active: !!conn.pinned }"
                :title="conn.pinned ? t('connections.unpin') : t('connections.pin')"
                :aria-label="conn.pinned ? t('connections.unpin') : t('connections.pin')"
                :aria-pressed="conn.pinned === true"
                @click.stop="emit('pin', conn.id)"
                @dblclick.stop
              >
                <AppIcon :name="conn.pinned ? 'pin-fill' : 'pin'" size="xs" />
              </button>
            </div>
            </VirtualList>
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
        <template v-if="ctxMenu.kind === 'group' && choosingGroupParent">
          <button type="button" class="ui-menu-item" role="menuitem" @click="choosingGroupParent = false">
            <AppIcon name="chevron-left" size="sm" class="group-ctx-icon" />
            {{ t('groups.moveTo') }}
          </button>
          <div class="ui-menu-sep" role="separator"></div>
          <button type="button" class="ui-menu-item" role="menuitem"
            :disabled="!groupTree.getParentId(ctxMenu.group.id)" @click="moveGroupTo(null)">
            {{ t('groups.topLevel') }}
          </button>
          <button v-for="{ group } in moveTargets" :key="group.id" type="button"
            class="ui-menu-item group-move-target" role="menuitem" :title="groupTree.getPath(group.id)"
            :disabled="groupTree.getParentId(ctxMenu.group.id) === group.id" @click="moveGroupTo(group.id)">
            {{ groupTree.getPath(group.id) }}
          </button>
        </template>
        <template v-else-if="ctxMenu.kind === 'group'">
          <button
            type="button"
            class="ui-menu-item"
            role="menuitem"
            @click="onGroupMenuAction('select', ctxMenu.group)"
          >
            <AppIcon name="folder" size="sm" class="group-ctx-icon" />
            {{ t('groups.openGroup') }}
          </button>
          <button type="button" class="ui-menu-item" role="menuitem" @click="onGroupMenuAction('add', ctxMenu.group)">
            <AppIcon name="plus" size="sm" class="group-ctx-icon" />
            {{ t('groups.newSubgroup') }}
          </button>
          <button type="button" class="ui-menu-item" role="menuitem" @click="choosingGroupParent = true">
            <AppIcon name="folder" size="sm" class="group-ctx-icon" />
            {{ t('groups.moveTo') }}
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
            <AppIcon name="plug" size="sm" class="group-ctx-icon" />
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
          <button
            type="button"
            class="ui-menu-item"
            role="menuitem"
            @click="onConnMenuAction('pin', ctxMenu.conn)"
          >
            <AppIcon :name="ctxMenu.conn.pinned ? 'pin-fill' : 'pin'" size="sm" class="group-ctx-icon" />
            {{ ctxMenu.conn.pinned ? t('connections.unpin') : t('connections.pin') }}
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

.smart-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
}

.smart-section-title,
.groups-section-title {
  margin: 0 2px 4px;
  padding: 0 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.groups-section-title {
  margin-top: 4px;
}

.smart-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.smart-item:hover {
  background: var(--hover-bg);
}

.smart-item.active {
  background: var(--accent-bg);
  color: var(--accent);
}

.smart-item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.smart-tag-swatch {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  flex-shrink: 0;
}

.group-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-anchor: none;
  padding: 0 8px 8px;
}

.group-block {
  min-width: 168px;
  border-radius: 6px;
  margin-bottom: 2px;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}

.group-move-target {
  max-width: min(360px, calc(100vw - 32px));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.group-item[draggable="true"] { cursor: grab; }
.group-item.dragging { cursor: grabbing; }

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
  width: 24px;
  height: 24px;
  margin-block: -2px;
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
  cursor: grabbing;
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
  cursor: grab;
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

.sidebar-conn-action {
  --icon-btn-md: calc(24px * var(--ui-scale));
  border-radius: var(--radius-sm);
}

@keyframes sidebar-conn-spin {
  to { transform: rotate(360deg); }
}

.sidebar-conn-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-secondary);
  flex-shrink: 0;
  opacity: 1;
  box-shadow: 0 0 0 1px var(--border-color);
  transition: opacity 0.12s ease, box-shadow 0.12s ease;
}
.sidebar-conn-mark { display: inline-flex; align-items: center; width: 8px; height: 8px; flex-shrink: 0; }

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

.sidebar-conn-pin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-left: auto;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  opacity: 0;
  cursor: pointer;
}

.sidebar-conn:hover .sidebar-conn-pin,
.sidebar-conn-pin.active,
.sidebar-conn.pinned .sidebar-conn-pin {
  opacity: 1;
}

.sidebar-conn-pin:hover,
.sidebar-conn-pin.active {
  color: var(--accent);
  background: var(--accent-bg);
}

.sidebar-conn.connecting .sidebar-conn-pin {
  display: none;
}
</style>
