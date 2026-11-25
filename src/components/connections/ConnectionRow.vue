<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'
import type { Connection } from '../../env.d.ts'
import {
  getConnectionTagColor,
  getConnectionTagLabel,
  hasConnectionColorTag,
} from '@/utils/connections/connectionTags'
import { clampPopupToViewport, placePopupNearAnchor } from '@/utils/shared/popupPosition'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'
import { createRowDragGuard } from '@/utils/shared/rowDrag'

const { t } = useI18n()

interface TestStatus {
  state: 'idle' | 'testing' | 'success' | 'error'
  latency?: number
  error?: string
}

const props = withDefaults(defineProps<{
  connection: Connection
  testStatus: TestStatus
  /** Only group moves are available; the parent list disables reorder drops. */
  reorderDisabled?: boolean
  /** Keyboard focus highlight from parent list */
  keyboardActive?: boolean
  /** Selection highlight from parent list (click, or Ctrl/Shift-click for several) */
  selected?: boolean
  /** Show secondary usage stats (settings). Default on. */
  showUsageStats?: boolean
  connecting?: boolean
  connectionStage?: import('@shared/sshConnectionProgress').SshConnectionStage
  connectionError?: string
  groupName?: string
  compact?: boolean
  /** At least one host is checked: plain row clicks toggle selection instead of opening a connection. */
  multiSelecting?: boolean
  /** Size of the multi-selection this row belongs to (0 when not part of one); the AI action then covers all of them. */
  aiSelectionCount?: number
}>(), {
  reorderDisabled: false,
  keyboardActive: false,
  showUsageStats: true,
  connecting: false,
  multiSelecting: false,
  aiSelectionCount: 0,
})

const emit = defineEmits<{
  (e: 'select', connectionId: string, modifiers: { ctrl: boolean; shift: boolean }): void
  (e: 'connect', connectionId: string): void
  (e: 'ai', connectionId: string): void
  (e: 'cancel-connect', connectionId: string): void
  (e: 'test', connectionId: string): void
  (e: 'edit', connection: Connection): void
  (e: 'delete', connectionId: string): void
  (e: 'copy', connection: Connection): void
  (e: 'pin', connectionId: string): void
  (e: 'open-window', connectionId: string): void
  (e: 'drag-start', connectionId: string, event: DragEvent): void
  (e: 'drag-end'): void
}>()

function usageStats(fullTime: boolean) {
  if (!props.showUsageStats) return ''
  const c = props.connection
  const parts: string[] = []
  if (c.useCount && c.useCount > 0) {
    parts.push(
      c.useCount === 1
        ? t('connections.useCountOnce')
        : t('connections.useCount', { count: c.useCount }),
    )
  }
  if (c.lastConnectedAt) {
    const time = new Date(c.lastConnectedAt).toLocaleString(undefined, fullTime ? {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    } : { month: 'numeric', day: 'numeric' })
    parts.push(t('connections.lastConnected', { time }))
  }
  return parts.join(' · ')
}
const statsInline = computed(() => usageStats(false))
const statsTitle = computed(() => usageStats(true))
const connectingLabel = computed(() => {
  const labels: Partial<Record<import('@shared/sshConnectionProgress').SshConnectionStage, string>> = {
    jump: t('connections.stageJump'), authenticating: t('connections.stageAuthenticating'),
    keyboard: t('connections.stageKeyboard'), 'host-key': t('connections.stageHostKey'),
    x11: t('connections.stageX11'), shell: t('connections.stageShell'),
  }
  return (props.connectionStage && labels[props.connectionStage]) || t('connections.connecting')
})

const metaTitle = computed(() => {
  const base = `${props.connection.username}@${props.connection.host}:${props.connection.port}`
  return [base, props.groupName ? t('connections.resultGroup', { name: props.groupName }) : '', props.connection.note, statsTitle.value].filter(Boolean).join(' · ')
})

const menuOpen = ref(false)
/** 'more' = under ··· button; 'context' = right-click at cursor */
const menuMode = ref<'more' | 'context'>('more')
const menuRef = ref<HTMLElement | null>(null)
const moreBtnRef = ref<HTMLElement | null>(null)
const rowRef = ref<HTMLElement | null>(null)
const isDragging = ref(false)
const dragGuard = createRowDragGuard()
/** Temporary full-row clone used as HTML5 drag image; removed on dragend. */
let dragGhostEl: HTMLElement | null = null
/** Cursor point when opened via contextmenu */
let contextPoint: { x: number; y: number } | null = null
const menuStyle = ref<Record<string, string>>({
  left: '0px',
  top: '0px',
})

const tagColor = computed(() => getConnectionTagColor(props.connection.colorTag))
const hasColorTag = computed(() => hasConnectionColorTag(props.connection.colorTag))
/** Hover tip: color name first; append note when present so the dot stays informative in long lists. */
const tagTitle = computed(() => {
  const label = getConnectionTagLabel(props.connection.colorTag)
  const tagText = hasColorTag.value
    ? `${t('connections.colorTag')}: ${label}`
    : t('connections.colorTagDefault')
  const note = props.connection.note?.trim()
  return note ? `${tagText} · ${note}` : tagText
})

const hasSelectModifier = (e: MouseEvent) => e.ctrlKey || e.metaKey || e.shiftKey

const aiForSelection = computed(() => props.aiSelectionCount > 1)
const aiLabel = computed(() => aiForSelection.value ? t('connections.aiChatSelected', { count: props.aiSelectionCount }) : t('connections.aiChat'))
const aiTitle = computed(() => aiForSelection.value ? t('connections.aiChatSelectedTooltip', { count: props.aiSelectionCount }) : t('connections.aiChatRowTooltip'))

/** Checkbox toggles membership like Ctrl+click; Shift still extends a range. */
function onSelectToggle(e: MouseEvent) {
  emit('select', props.connection.id, { ctrl: !e.shiftKey, shift: e.shiftKey })
}

function onRowClick(e: MouseEvent) {
  // Ignore the second click of a double-click so it doesn't undo the first toggle.
  if (e.detail > 1) return
  const el = e.target as HTMLElement | null
  if (el?.closest('button, a, input, [role="menuitem"]')) return
  if (!props.multiSelecting && !hasSelectModifier(e)) return
  emit('select', props.connection.id, {
    ctrl: e.ctrlKey || e.metaKey || (props.multiSelecting && !e.shiftKey),
    shift: e.shiftKey,
  })
}

function onDoubleClick(e: MouseEvent) {
  if (!props.multiSelecting && !hasSelectModifier(e)) requestConnect()
}

function requestConnect() {
  if (props.connecting) return
  emit('connect', props.connection.id)
}

function clearDragGhost() {
  if (dragGhostEl) {
    dragGhostEl.remove()
    dragGhostEl = null
  }
}

/**
 * Build a floating full-row drag image (like VS Code / Notion list reorder)
 * instead of the browser default tiny grip-icon ghost.
 */
function setRowDragImage(e: DragEvent) {
  const row = rowRef.value
  const dt = e.dataTransfer
  if (!row || !dt) return

  clearDragGhost()
  const rect = row.getBoundingClientRect()
  const ghost = row.cloneNode(true) as HTMLElement
  ghost.classList.add('connection-row-drag-ghost')
  ghost.style.cssText = [
    'position: fixed',
    `top: ${rect.top}px`,
    `left: ${rect.left}px`,
    `width: ${rect.width}px`,
    `height: ${rect.height}px`,
    'margin: 0',
    'z-index: 100000',
    'pointer-events: none',
    'box-sizing: border-box',
    'opacity: 0.92',
    'transform: scale(1.02)',
    'transform-origin: left center',
    'box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28), 0 2px 8px rgba(0, 0, 0, 0.12)',
  ].join(';')
  // Keep in document for browsers that snapshot only after layout
  document.body.appendChild(ghost)
  dragGhostEl = ghost

  const offsetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
  const offsetY = Math.max(0, Math.min(rect.height, e.clientY - rect.top))
  dt.setDragImage(ghost, offsetX, offsetY)

  // Hide the live clone after the browser has captured the drag bitmap
  requestAnimationFrame(() => {
    if (dragGhostEl === ghost) {
      ghost.style.opacity = '0'
      ghost.style.pointerEvents = 'none'
    }
  })
}

function onDragStart(e: DragEvent) {
  if (!dragGuard.canStart(e)) return
  isDragging.value = true
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-lite-connect-conn', props.connection.id)
    // Also store plain text for broader drop-target compatibility
    e.dataTransfer.setData('text/plain', props.connection.id)
    setRowDragImage(e)
  }
  emit('drag-start', props.connection.id, e)
}

function onDragEnd() {
  isDragging.value = false
  clearDragGhost()
  emit('drag-end')
}

onBeforeUnmount(() => {
  clearDragGhost()
})

async function positionMenu() {
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  const menu = menuRef.value
  if (!menu) return
  const size = {
    width: menu.offsetWidth || 160,
    height: menu.offsetHeight || 220,
  }

  if (menuMode.value === 'context' && contextPoint) {
    const pos = clampPopupToViewport(contextPoint, size)
    menuStyle.value = {
      left: `${pos.left}px`,
      top: `${pos.top}px`,
      maxHeight: 'none',
    }
    return
  }

  const btn = moreBtnRef.value
  if (!btn) return
  const anchor = btn.getBoundingClientRect()
  const pos = placePopupNearAnchor(anchor, size, { align: 'end', gap: 4 })
  menuStyle.value = {
    left: `${pos.left}px`,
    top: `${pos.top}px`,
    maxHeight: pos.maxHeight > 0 ? `${pos.maxHeight}px` : 'none',
  }
}

function toggleMoreMenu(e: MouseEvent) {
  e.stopPropagation()
  if (menuOpen.value && menuMode.value === 'more') {
    closeMenu()
    return
  }
  menuMode.value = 'more'
  contextPoint = null
  menuOpen.value = true
}

function onContextMenu(e: MouseEvent) {
  // Keep browser menu on form-like targets if any appear later
  const el = e.target as HTMLElement | null
  if (el?.closest('input, textarea, [contenteditable="true"]')) return
  e.preventDefault()
  e.stopPropagation()
  menuMode.value = 'context'
  contextPoint = { x: e.clientX, y: e.clientY }
  // Force re-position even if already open
  if (menuOpen.value) {
    void positionMenu()
  } else {
    menuOpen.value = true
  }
}

function closeMenu() {
  menuOpen.value = false
  contextPoint = null
}

watch(menuOpen, (open) => {
  if (open) void positionMenu()
})

useOutsideDismiss(
  menuOpen,
  closeMenu,
  () => [menuRef.value, moreBtnRef.value],
)

type MenuAction = 'connect' | 'ai' | 'window' | 'test' | 'copy' | 'edit' | 'pin' | 'delete'

function onMenuAction(action: MenuAction) {
  closeMenu()
  const c = props.connection
  switch (action) {
    case 'connect':
      requestConnect()
      break
    case 'ai':
      emit('ai', c.id)
      break
    case 'window':
      emit('open-window', c.id)
      break
    case 'test':
      emit('test', c.id)
      break
    case 'copy':
      emit('copy', c)
      break
    case 'edit':
      emit('edit', c)
      break
    case 'pin':
      emit('pin', c.id)
      break
    case 'delete':
      emit('delete', c.id)
      break
  }
}
</script>

<template>
  <div
    ref="rowRef"
    class="connection-row"
    draggable="true"
    :title="reorderDisabled ? t('connections.dragDisabledTitle') : t('connections.dragTitle')"
    :class="{
      dragging: isDragging,
      'menu-open': menuOpen,
      'keyboard-active': keyboardActive,
      selected,
      pinned: connection.pinned,
      'has-color-tag': hasColorTag,
      connecting,
      compact,
      'multi-selecting': multiSelecting,
    }"
    @pointerdown="dragGuard.pointerDown"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @click="onRowClick"
    @dblclick="onDoubleClick"
    @contextmenu="onContextMenu"
  >
    <div class="row-main">
      <button
        type="button"
        class="select-check"
        role="checkbox"
        :aria-checked="selected"
        :aria-label="t('connections.selectToggle', { name: connection.name })"
        :title="t('connections.selectToggleHint')"
        @click.stop="onSelectToggle"
        @dblclick.stop
      >
        <span class="select-check-box" aria-hidden="true">
          <AppIcon v-if="selected" name="check" size="xs" />
        </span>
      </button>
      <div class="row-info">
        <div class="row-heading">
          <span class="conn-name">
            <AppIcon
              v-if="connection.pinned"
              name="pin-fill"
              size="xs"
              class="pin-icon"
              :title="t('connections.pinned')"
            />
            <span class="conn-name-text" :title="connection.name">{{ connection.name }}</span>
            <span
              v-if="hasColorTag"
              class="color-tag"
              :style="{ background: tagColor }"
              :title="tagTitle"
              :aria-label="tagTitle"
              role="img"
            ></span>
          </span>
        </div>
        <span class="conn-meta" :title="metaTitle">
          <span class="conn-addr">{{ connection.username }}@{{ connection.host }}:{{ connection.port }}</span>
          <template v-if="groupName">
            <span class="meta-sep" aria-hidden="true">·</span>
            <span class="conn-group" :title="groupName">{{ t('connections.resultGroup', { name: groupName }) }}</span>
          </template>
        </span>
        <span v-if="connection.note && !compact" class="conn-note" :title="connection.note">{{ connection.note }}</span>
        <span v-if="statsInline && !compact" class="conn-stats" :title="statsTitle" :aria-label="statsTitle">{{ statsInline }}</span>
        <span v-if="connectionError && !connecting" class="conn-error" role="alert"><AppIcon name="alert-circle" size="xs" />{{ connectionError }}</span>
      </div>
    </div>

    <div class="row-actions">
      <span
        v-if="connecting"
        class="test-badge testing"
        :title="t('connections.connectingTitle')"
      >
        <span class="spinner" aria-hidden="true"></span>
        {{ connectingLabel }}
      </span>
      <span v-else-if="connectionError" class="test-badge error">{{ t('connections.failed') }}</span>
      <span
        v-else-if="testStatus.state === 'testing'"
        class="test-badge testing"
        :title="t('connections.testingTitle')"
      >
        <span class="spinner" aria-hidden="true"></span>
        {{ t('connections.testing') }}
      </span>
      <el-tooltip
        v-else-if="testStatus.state === 'success'"
        :content="t('connections.connectOk', { latency: testStatus.latency })"
        placement="bottom"
      >
        <span class="test-badge success">{{ testStatus.latency }}ms</span>
      </el-tooltip>
      <el-tooltip
        v-else-if="testStatus.state === 'error'"
        :content="testStatus.error || t('connections.connectFailed')"
        placement="bottom"
      >
        <span class="test-badge error">{{ t('connections.failed') }}</span>
      </el-tooltip>

      <el-tooltip :content="connecting ? t('common.cancel') : connectionError ? t('terminal.retryConnection') : t('connections.connectTooltip')" placement="bottom">
        <button
          class="action-btn connect ui-btn ui-btn-ghost ui-btn-xs"
          type="button"
          :aria-label="connecting ? t('common.cancel') : connectionError ? t('terminal.retryConnection') : t('connections.connect')"
          @click.stop="connecting ? emit('cancel-connect', connection.id) : requestConnect()"
          @dblclick.stop
        >
          <AppIcon :name="connecting ? 'close' : connectionError ? 'refresh' : 'link'" size="sm" />
          <span class="connect-label">{{ connecting ? t('common.cancel') : connectionError ? t('terminal.retryConnection') : t('connections.connect') }}</span>
        </button>
      </el-tooltip>

      <!-- Always visible; inside a multi-selection it starts one chat for all selected hosts. -->
      <button
        class="action-btn ai ui-btn ui-btn-ghost ui-btn-xs"
        type="button"
        :title="aiTitle"
        :aria-label="aiForSelection ? aiTitle : t('connections.aiChatNamed', { name: connection.name })"
        @click.stop="emit('ai', connection.id)"
        @dblclick.stop
      >
        <AppIcon name="ai-chat" size="sm" />
        <span class="ai-label">{{ aiLabel }}</span>
      </button>

      <div class="more-wrap secondary-action">
        <el-tooltip :content="t('connections.more')" placement="bottom" :disabled="menuOpen">
          <button
            ref="moreBtnRef"
            class="action-btn more ui-icon-btn ui-icon-btn-sm"
            type="button"
            :aria-label="t('connections.moreAria')"
            :aria-expanded="menuOpen"
            aria-haspopup="menu"
            @click="toggleMoreMenu"
            @contextmenu.stop.prevent="onContextMenu"
          >
            <AppIcon name="more" size="sm" />
          </button>
        </el-tooltip>
        <Teleport to="body">
          <div
            v-if="menuOpen"
            ref="menuRef"
            class="ui-menu"
            role="menu"
            :style="menuStyle"
            @click.stop
            @contextmenu.prevent
          >
            <button
              v-if="menuMode === 'context'"
              type="button"
              class="ui-menu-item"
              role="menuitem"
              :disabled="connecting"
              @click="onMenuAction('connect')"
            >
              <AppIcon name="plug" size="sm" class="more-item-icon" />
              {{ connecting ? t('connections.connecting') : t('connections.connect') }}
            </button>
            <button type="button" class="ui-menu-item" role="menuitem" data-action="ai" @click="onMenuAction('ai')">
              <AppIcon name="ai-chat" size="sm" class="more-item-icon" />
              {{ aiLabel }}
            </button>
            <button type="button" class="ui-menu-item" role="menuitem" @click="onMenuAction('window')">
              <AppIcon name="external-link" size="sm" class="more-item-icon" />
              {{ t('connections.openInNewWindow') }}
            </button>
            <button
              type="button"
              class="ui-menu-item"
              role="menuitem"
              :disabled="testStatus.state === 'testing'"
              @click="onMenuAction('test')"
            >
              <AppIcon name="connection-test" size="sm" class="more-item-icon" />
              {{ t('connections.testConnection') }}
            </button>
            <div class="ui-menu-sep" role="separator"></div>
            <button type="button" class="ui-menu-item" role="menuitem" @click="onMenuAction('copy')">
              <AppIcon name="copy" size="sm" class="more-item-icon" />
              {{ t('connections.copyConnection') }}
            </button>
            <button type="button" class="ui-menu-item" role="menuitem" @click="onMenuAction('edit')">
              <AppIcon name="edit" size="sm" class="more-item-icon" />
              {{ t('connections.edit') }}
            </button>
            <button
              type="button"
              class="ui-menu-item"
              role="menuitem"
              @click="onMenuAction('pin')"
            >
              <AppIcon :name="connection.pinned ? 'pin-fill' : 'pin'" size="sm" class="more-item-icon" />
              {{ connection.pinned ? t('connections.unpin') : t('connections.pin') }}
            </button>
            <div class="ui-menu-sep" role="separator"></div>
            <button type="button" class="ui-menu-item danger" role="menuitem" @click="onMenuAction('delete')">
              <AppIcon name="delete" size="sm" class="more-item-icon" />
              {{ t('common.delete') }}
            </button>
          </div>
        </Teleport>
      </div>
    </div>
  </div>
</template>

<style scoped>
.connection-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px 7px 6px;
  border-radius: var(--radius-sm, 4px);
  cursor: default;
  border: 1px solid transparent;
  background: transparent;
  user-select: none;
  transition: background 0.1s ease;
}

.connection-row::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: -2px;
  height: 1px;
  background: color-mix(in srgb, var(--border-color) 42%, transparent);
  pointer-events: none;
  transition: opacity 0.1s ease;
}

.connection-row:hover::after,
.connection-row.selected::after,
.connection-row.keyboard-active::after,
.connection-row.menu-open::after,
.connection-row.connecting::after {
  opacity: 0;
}

.connection-row.connecting {
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  background: color-mix(in srgb, var(--accent) 6%, transparent);
  cursor: wait;
}

.pin-icon {
  color: var(--warning);
  flex-shrink: 0;
}

.connection-row:hover,
.connection-row.menu-open,
.connection-row:focus-within {
  background: color-mix(in srgb, var(--text-primary) 8%, var(--bg-primary));
}

/* Keyboard navigation keeps the neutral selection surface (docs/UI_STYLES.md). */
.connection-row.keyboard-active,
.connection-row.keyboard-active:hover {
  background: var(--tab-selected-surface);
  box-shadow: inset 0 0 0 1px var(--tab-selected-edge);
}

.connection-row.selected,
.connection-row.selected.keyboard-active {
  background: color-mix(in srgb, var(--accent) 15%, var(--bg-primary));
}

.connection-row.selected:hover {
  background: color-mix(in srgb, var(--accent) 19%, var(--bg-primary));
}

.connection-row.selected::before {
  content: '';
  position: absolute;
  inset-block: 5px;
  left: 0;
  width: 3px;
  border-radius: 2px;
  background: var(--accent);
  pointer-events: none;
}

.connection-row.selected .conn-name-text {
  color: color-mix(in srgb, var(--accent) 76%, var(--text-primary));
}

.connection-row:has(:focus-visible) {
  border-color: var(--accent);
}

/* Source row becomes a placeholder slot while the full-row ghost follows the cursor */
.connection-row.dragging {
  cursor: grabbing;
  opacity: 0.4;
  background: color-mix(in srgb, var(--bg-tertiary) 50%, transparent);
  border-style: dashed;
  box-shadow: none;
}

.row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.row-info {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.85fr);
  grid-template-areas: "name note" "address stats";
  align-items: baseline;
  gap: 2px 16px;
  min-width: 0;
}

.conn-error {
  grid-column: 1 / -1;
  display: flex;
  align-items: flex-start;
  gap: var(--space-1);
  color: var(--danger);
  font-size: var(--font-caption);
  line-height: var(--line-ui);
  overflow-wrap: anywhere;
}
.conn-error :deep(svg) { flex-shrink: 0; }

.conn-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  font-size: var(--font-ui);
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conn-name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-heading { grid-area: name; display: flex; align-items: baseline; min-width: 0; }

.conn-meta {
  grid-area: address;
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-size: var(--font-ui-sm);
  color: var(--text-secondary);
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conn-addr {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
}

.meta-sep {
  flex-shrink: 0;
  opacity: 0.45;
}

.conn-note,
.conn-stats,
.conn-group {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: var(--font-caption);
}
.conn-note { grid-area: note; font-size: var(--font-ui-sm); }
.conn-stats { grid-area: stats; font-variant-numeric: tabular-nums; }
.row-info:not(:has(.conn-note)):not(:has(.conn-error)) .conn-stats {
  grid-row: 1 / -1;
  align-self: center;
}
.conn-group { max-width: 40%; }

/* Generous hit target around the 15px visual checkbox so users don't have to aim precisely. */
.select-check {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  margin: -4px -2px -4px -2px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  cursor: pointer;
}
.select-check-box {
  width: 15px;
  height: 15px;
  display: grid;
  place-items: center;
  border: 1.5px solid color-mix(in srgb, var(--text-secondary) 38%, transparent);
  border-radius: 4px;
  background: var(--bg-primary);
  color: #fff;
  transition: background 0.1s ease, border-color 0.1s ease;
}
.connection-row:hover .select-check-box {
  border-color: var(--text-secondary);
}
.select-check:hover .select-check-box {
  border-color: var(--accent);
}
.select-check[aria-checked="true"] .select-check-box {
  border-color: var(--accent);
  background: var(--accent);
}
.select-check:focus-visible {
  outline: none;
}
.select-check:focus-visible .select-check-box {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.color-tag {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
/* 测试结果在非 hover 时也保留可见，避免状态闪失 */
.test-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 120px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: var(--font-caption);
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border: 1px solid transparent;
  cursor: default;
  opacity: 1;
}

.test-badge.testing {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  background: var(--accent-bg);
}

.test-badge.success {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 28%, transparent);
  background: color-mix(in srgb, var(--success) 10%, transparent);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
}

.test-badge.error {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 28%, transparent);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.action-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* Repeated on every row, so it stays quiet at rest and lights up on the pointed row. */
.action-btn.connect {
  color: color-mix(in srgb, var(--text-primary) 72%, transparent);
}
.connection-row:hover .action-btn.connect:not(:disabled),
.connection-row.keyboard-active .action-btn.connect:not(:disabled),
.connection-row.selected .action-btn.connect:not(:disabled) {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.action-btn.connect:hover:not(:disabled) {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

/* Secondary row actions stay softer at rest to reduce right-side visual noise. */
.action-btn.ai,
.action-btn.more {
  color: var(--text-secondary);
  opacity: 0.68;
}
.connection-row:hover .action-btn.ai,
.connection-row:hover .action-btn.more,
.connection-row.keyboard-active .action-btn.ai,
.connection-row.keyboard-active .action-btn.more,
.connection-row.menu-open .action-btn.ai,
.connection-row.menu-open .action-btn.more,
.connection-row.selected .action-btn.ai,
.connection-row.selected .action-btn.more,
.action-btn.ai:focus-visible,
.action-btn.more:focus-visible {
  opacity: 1;
}
.connection-row.selected .action-btn.ai,
.action-btn.ai:hover:not(:disabled) {
  color: var(--accent);
}

.more-wrap {
  position: relative;
}

.spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid var(--border-color);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 900px) {
  .connect-label,
  .ai-label {
    display: none;
  }

  .action-btn.connect,
  .action-btn.ai {
    width: 28px;
    padding-inline: 0;
  }

}

.connection-row.compact { min-height: 32px; padding: 1px 10px 1px 6px; }
.connection-row.compact::after { bottom: -1px; }
.connection-row.compact.selected::before { top: 5px; bottom: 5px; }
.connection-row.compact .row-main { gap: 8px; }
.connection-row.compact .select-check { height: 26px; margin-block: -2px; }
.connection-row.compact .row-info { display: flex; align-items: center; gap: 12px; }
.connection-row.compact .row-heading { flex: 0 1 34%; min-width: 0; }
.connection-row.compact .conn-meta { flex: 1; }
.connection-row.compact .row-info:has(.conn-error) { flex-wrap: wrap; row-gap: 2px; }
.connection-row.compact .conn-error { flex: 1 0 100%; }
.connection-row.compact .row-actions { gap: 2px; }
.connection-row.compact :is(.connect-label, .ai-label) { display: none; }
.connection-row.compact .action-btn:is(.connect, .ai) { width: 28px; padding-inline: 0; }
</style>
