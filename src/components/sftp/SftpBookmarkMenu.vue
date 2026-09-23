<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SftpPathBookmark } from '@shared/types/sftp'
import { eventIsInsideRoots } from '@/composables/shared/useOutsideDismiss'
import { placePopupNearAnchor } from '@/utils/shared/popupPosition'
import { normalizeBookmarkPath } from '@/utils/sftp/pathBookmarks'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{
  open: boolean
  anchor: HTMLElement | null
  currentPath: string
  connectionBookmarks?: SftpPathBookmark[]
  globalBookmarks?: SftpPathBookmark[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'add-bookmark', scope: 'connection' | 'global'): void
  (e: 'open-bookmark', bookmark: SftpPathBookmark): void
  (e: 'rename-bookmark', bookmark: SftpPathBookmark): void
  (e: 'edit-bookmark-path', bookmark: SftpPathBookmark): void
  (e: 'remove-bookmark', bookmark: SftpPathBookmark): void
  (e: 'move-bookmark', bookmark: SftpPathBookmark, direction: -1 | 1): void
  (e: 'reorder-bookmark', draggedId: string, targetId: string, place: 'before' | 'after'): void
}>()

const { t } = useI18n()
const menuRef = ref<HTMLElement | null>(null)
const rowMenuRef = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})
const menuReady = ref(false)
const revealedId = ref<string | null>(null)
const draggingId = ref<string | null>(null)
const dropState = ref<{ id: string; place: 'before' | 'after' } | null>(null)
const rowMenu = ref<{
  bookmark: SftpPathBookmark
  index: number
  total: number
  left: number
  top: number
} | null>(null)

let revealTimer = 0
let attached = false
let attachRaf = 0
let sidebarObserver: ResizeObserver | null = null

const hasCurrentPath = computed(() => (props.currentPath || '').trim().length > 0)

function samePath(path: string): boolean {
  if (!hasCurrentPath.value) return false
  return normalizeBookmarkPath(path) === normalizeBookmarkPath(props.currentPath)
}

const currentConnectionSaved = computed(() =>
  (props.connectionBookmarks ?? []).some((item) => samePath(item.path)),
)
const matchingGlobal = computed(() =>
  (props.globalBookmarks ?? []).find((item) => samePath(item.path)) ?? null,
)
const hasBookmarks = computed(() =>
  !!props.connectionBookmarks?.length || !!props.globalBookmarks?.length,
)

const sections = computed(() => [
  { id: 'connection', title: t('sftp.connectionBookmarks'), global: false, items: props.connectionBookmarks ?? [] },
  { id: 'global', title: t('sftp.globalBookmarks'), global: true, items: props.globalBookmarks ?? [] },
])

function bookmarkById(id: string): SftpPathBookmark | null {
  return (props.connectionBookmarks ?? []).find((item) => item.id === id)
    ?? (props.globalBookmarks ?? []).find((item) => item.id === id)
    ?? null
}

async function reposition() {
  const anchor = props.anchor
  const el = menuRef.value
  if (!props.open || !anchor || !el) return false
  const buttonRect = anchor.getBoundingClientRect()
  const sidebar = anchor.closest('.file-sidebar')
  const sidebarRect = sidebar?.getBoundingClientRect()
  const width = sidebarRect
    ? Math.max(200, Math.min(320, Math.floor(sidebarRect.width - 12)))
    : 300
  await nextTick()
  const placed = placePopupNearAnchor(
    buttonRect,
    { width, height: el.scrollHeight || el.getBoundingClientRect().height },
    { align: 'end', gap: 4 },
  )
  let left = placed.left
  if (sidebarRect) {
    const minLeft = Math.round(sidebarRect.left + 6)
    const maxLeft = Math.round(sidebarRect.right - 6 - width)
    left = maxLeft >= minLeft ? Math.min(Math.max(left, minLeft), maxLeft) : minLeft
  }
  menuStyle.value = {
    left: `${left}px`,
    top: `${placed.top}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(140, placed.maxHeight)}px`,
  }
  menuReady.value = true
  return true
}

function observeSidebar() {
  sidebarObserver?.disconnect()
  sidebarObserver = null
  const sidebar = props.anchor?.closest('.file-sidebar')
  if (!sidebar || typeof ResizeObserver === 'undefined') return
  sidebarObserver = new ResizeObserver(() => { void reposition() })
  sidebarObserver.observe(sidebar)
}

function reveal(id: string) {
  revealedId.value = id
  window.clearTimeout(revealTimer)
  revealTimer = window.setTimeout(() => {
    if (revealedId.value === id) revealedId.value = null
  }, 1600)
  void nextTick(() => {
    menuRef.value?.querySelector(`[data-bookmark-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' })
  })
}

function requestAddConnection() {
  if (!hasCurrentPath.value || currentConnectionSaved.value) return
  emit('add-bookmark', 'connection')
}

function requestAddGlobal() {
  if (!hasCurrentPath.value) return
  if (matchingGlobal.value) {
    reveal(matchingGlobal.value.id)
    return
  }
  emit('close')
  emit('add-bookmark', 'global')
}

function openBookmark(bookmark: SftpPathBookmark) {
  rowMenu.value = null
  emit('close')
  emit('open-bookmark', bookmark)
}

function toggleRowMenu(item: SftpPathBookmark, index: number, total: number, event: MouseEvent) {
  if (rowMenu.value?.bookmark.id === item.id) {
    rowMenu.value = null
    return
  }
  const btn = event.currentTarget as HTMLElement
  const rect = btn.getBoundingClientRect()
  const placed = placePopupNearAnchor(rect, { width: 168, height: 176 }, { align: 'end', gap: 4 })
  rowMenu.value = { bookmark: item, index, total, left: placed.left, top: placed.top }
}

function closeRowAction(kind: 'rename' | 'edit-path' | 'remove') {
  const item = rowMenu.value?.bookmark
  if (!item) return
  rowMenu.value = null
  emit('close')
  if (kind === 'rename') emit('rename-bookmark', item)
  else if (kind === 'edit-path') emit('edit-bookmark-path', item)
  else emit('remove-bookmark', item)
}

function moveRow(direction: -1 | 1) {
  const current = rowMenu.value
  if (!current) return
  if (direction < 0 && current.index === 0) return
  if (direction > 0 && current.index >= current.total - 1) return
  rowMenu.value = null
  emit('move-bookmark', current.bookmark, direction)
}

function onDragStart(event: DragEvent, item: SftpPathBookmark) {
  draggingId.value = item.id
  dropState.value = null
  event.dataTransfer?.setData('text/plain', item.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragEnd() {
  draggingId.value = null
  dropState.value = null
}

function onDragOver(event: DragEvent, item: SftpPathBookmark) {
  const dragged = draggingId.value ? bookmarkById(draggingId.value) : null
  if (!dragged || dragged.id === item.id || dragged.scope !== item.scope) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const place = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  dropState.value = { id: item.id, place }
}

function onDrop(event: DragEvent, item: SftpPathBookmark) {
  event.preventDefault()
  const draggedId = draggingId.value
  const place = dropState.value?.id === item.id ? dropState.value.place : 'before'
  draggingId.value = null
  dropState.value = null
  if (!draggedId || draggedId === item.id) return
  emit('reorder-bookmark', draggedId, item.id, place)
}

function isMoreButton(event: Event): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  return path.some((node) => node instanceof HTMLElement && node.dataset.bookmarkMore != null)
}

function onPointer(event: Event) {
  if (isMoreButton(event)) return
  if (rowMenuRef.value && eventIsInsideRoots(event, [rowMenuRef.value])) return
  if (rowMenu.value) {
    rowMenu.value = null
    if (eventIsInsideRoots(event, [menuRef.value, props.anchor])) return
  }
  if (eventIsInsideRoots(event, [menuRef.value, props.anchor])) return
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  if (rowMenu.value) rowMenu.value = null
  else emit('close')
}

function detach() {
  if (attachRaf) {
    cancelAnimationFrame(attachRaf)
    attachRaf = 0
  }
  if (!attached) return
  attached = false
  window.removeEventListener('pointerdown', onPointer, true)
  window.removeEventListener('mousedown', onPointer, true)
  document.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('resize', reposition)
  window.removeEventListener('scroll', reposition, true)
  sidebarObserver?.disconnect()
  sidebarObserver = null
}

function attach() {
  detach()
  attachRaf = requestAnimationFrame(() => {
    attachRaf = 0
    attached = true
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('mousedown', onPointer, true)
    document.addEventListener('keydown', onKeydown, true)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
  })
}

watch(() => props.open, async (open) => {
  if (!open) {
    detach()
    menuReady.value = false
    rowMenu.value = null
    draggingId.value = null
    dropState.value = null
    return
  }
  menuReady.value = false
  attach()
  await nextTick()
  observeSidebar()
  await reposition()
  const currentId = (props.connectionBookmarks ?? []).find((item) => samePath(item.path))?.id
    ?? matchingGlobal.value?.id
    ?? null
  if (currentId) {
    menuRef.value?.querySelector(`[data-bookmark-id="${CSS.escape(currentId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }
})

watch(
  () => (props.connectionBookmarks ?? []).find((item) => samePath(item.path))?.id ?? null,
  async (id, previous) => {
    if (!props.open || !id || id === previous) return
    await nextTick()
    reveal(id)
  },
)

onBeforeUnmount(() => {
  detach()
  window.clearTimeout(revealTimer)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menuRef"
      class="ui-menu bookmark-menu"
      :class="{ ready: menuReady }"
      :style="menuStyle"
      role="menu"
      @click.stop
    >
      <div class="ui-menu-title">{{ t('sftp.pathBookmarks') }}</div>
      <button
        v-if="hasCurrentPath && !currentConnectionSaved"
        type="button"
        class="ui-menu-item primary"
        @click="requestAddConnection"
      >
        <AppIcon name="star" size="xs" />
        <span>{{ t('sftp.addConnectionBookmark') }}</span>
      </button>
      <button
        v-if="hasCurrentPath"
        type="button"
        class="ui-menu-item"
        @click="requestAddGlobal"
      >
        <AppIcon name="star" size="xs" />
        <span>{{ matchingGlobal ? t('sftp.showGlobalBookmark') : t('sftp.addGlobalBookmark') }}</span>
      </button>

      <template v-for="section in sections" :key="section.id">
        <template v-if="section.items.length">
          <div class="ui-menu-sep" role="separator"></div>
          <div class="bookmark-section-title">{{ section.title }}</div>
          <div
            v-for="(item, index) in section.items"
            :key="item.id"
            class="bookmark-row"
            :class="{
              current: samePath(item.path),
              reveal: revealedId === item.id,
              'drop-before': dropState?.id === item.id && dropState.place === 'before',
              'drop-after': dropState?.id === item.id && dropState.place === 'after',
              dragging: draggingId === item.id,
            }"
            :data-bookmark-id="item.id"
            @dragover="onDragOver($event, item)"
            @drop="onDrop($event, item)"
          >
            <span
              class="bookmark-grip"
              draggable="true"
              :title="t('sftp.dragBookmark')"
              @dragstart="onDragStart($event, item)"
              @dragend="onDragEnd"
            >
              <AppIcon name="grip" size="xs" />
            </span>
            <button type="button" class="bookmark-open" :title="item.path" @click="openBookmark(item)">
              <span class="bookmark-name-line">
                <span class="bookmark-name">{{ item.name }}</span>
                <span v-if="section.global" class="bookmark-tag">{{ t('sftp.globalBookmarkTag') }}</span>
              </span>
              <span class="bookmark-path">{{ item.path }}</span>
            </button>
            <button
              type="button"
              class="bookmark-more"
              data-bookmark-more=""
              :title="t('sftp.bookmarkActions')"
              :aria-expanded="rowMenu?.bookmark.id === item.id"
              @click.stop="toggleRowMenu(item, index, section.items.length, $event)"
            >
              <AppIcon name="more" size="xs" />
            </button>
          </div>
        </template>
      </template>

      <div v-if="!hasBookmarks" class="bookmark-empty">{{ t('sftp.noPathBookmarks') }}</div>
    </div>
    <div
      v-if="open && rowMenu"
      ref="rowMenuRef"
      class="ui-menu bookmark-row-menu"
      :style="{ left: rowMenu.left + 'px', top: rowMenu.top + 'px' }"
      role="menu"
      @click.stop
    >
      <button type="button" class="ui-menu-item" @click="closeRowAction('rename')">
        <AppIcon name="edit" size="xs" />
        <span>{{ t('sftp.renameBookmark') }}</span>
      </button>
      <button type="button" class="ui-menu-item" @click="closeRowAction('edit-path')">
        <AppIcon name="edit" size="xs" />
        <span>{{ t('sftp.editBookmarkPath') }}</span>
      </button>
      <button type="button" class="ui-menu-item" :disabled="rowMenu.index === 0" @click="moveRow(-1)">
        <AppIcon name="chevron-up" size="xs" />
        <span>{{ t('sftp.moveBookmarkUp') }}</span>
      </button>
      <button type="button" class="ui-menu-item" :disabled="rowMenu.index === rowMenu.total - 1" @click="moveRow(1)">
        <AppIcon name="chevron-down" size="xs" />
        <span>{{ t('sftp.moveBookmarkDown') }}</span>
      </button>
      <div class="ui-menu-sep" role="separator"></div>
      <button type="button" class="ui-menu-item danger" @click="closeRowAction('remove')">
        <AppIcon name="trash" size="xs" />
        <span>{{ t('sftp.deleteBookmark') }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.bookmark-menu {
  position: fixed;
  z-index: 10000;
  padding: 6px;
}

.bookmark-menu:not(.ready) {
  visibility: hidden;
}

.bookmark-row-menu {
  position: fixed;
  z-index: 10001;
  width: 168px;
  padding: 4px;
}

.bookmark-section-title {
  padding: 3px 8px;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
}

.bookmark-row {
  display: flex;
  align-items: center;
  min-width: 0;
  border-radius: 4px;
}

.bookmark-row.current,
.bookmark-row.reveal,
.bookmark-row:hover {
  background: var(--bg-hover);
}

.bookmark-row.current,
.bookmark-row.reveal {
  background: var(--accent-bg);
}

.bookmark-row.drop-before {
  box-shadow: inset 0 2px 0 var(--accent);
}

.bookmark-row.drop-after {
  box-shadow: inset 0 -2px 0 var(--accent);
}

.bookmark-row.dragging {
  opacity: 0.45;
}

.bookmark-grip {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 18px;
  height: 28px;
  margin-left: 2px;
  color: var(--text-secondary);
  cursor: grab;
  opacity: 0.55;
}

.bookmark-row:hover .bookmark-grip,
.bookmark-grip:focus {
  opacity: 1;
}

.bookmark-open {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  padding: 5px 4px 5px 2px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.bookmark-name-line {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: 6px;
  max-width: 46%;
  min-width: 0;
}

.bookmark-name,
.bookmark-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bookmark-name {
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
}

.bookmark-tag {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--bg-tertiary, var(--bg-hover));
  color: var(--text-secondary);
  font-size: 9px;
  font-weight: 700;
  line-height: 16px;
}

.bookmark-row.current .bookmark-tag {
  color: var(--accent);
}

.bookmark-path {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.bookmark-more {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-right: 4px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.bookmark-more:hover,
.bookmark-more[aria-expanded='true'] {
  color: var(--accent);
  background: var(--accent-bg);
}

.bookmark-empty {
  padding: 12px 10px 8px;
  color: var(--text-secondary);
  font-size: 11px;
  text-align: center;
}
</style>
