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
  /** Show secondary usage stats (settings). Default on. */
  showUsageStats?: boolean
  connecting?: boolean
  connectionStage?: import('@shared/sshConnectionProgress').SshConnectionStage
  connectionError?: string
  groupName?: string
  compact?: boolean
}>(), {
  reorderDisabled: false,
  keyboardActive: false,
  showUsageStats: true,
  connecting: false,
})

const emit = defineEmits<{
  (e: 'connect', connectionId: string): void
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
    keyboard: t('connections.stageKeyboard'), 'host-key': t('connections.stageHostKey'), shell: t('connections.stageShell'),
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

function onDoubleClick() {
  requestConnect()
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

type MenuAction = 'connect' | 'window' | 'test' | 'copy' | 'edit' | 'pin' | 'delete'

function onMenuAction(action: MenuAction) {
  closeMenu()
  const c = props.connection
  switch (action) {
    case 'connect':
      requestConnect()
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
      pinned: connection.pinned,
      'has-color-tag': hasColorTag,
      connecting,
      compact,
    }"
    :style="{ '--tag-color': tagColor }"
    @pointerdown="dragGuard.pointerDown"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @dblclick="onDoubleClick"
    @contextmenu="onContextMenu"
  >
    <div class="row-main">
      <span class="color-tag-slot">
        <span
          v-if="hasColorTag"
          class="color-tag"
          :style="{ background: tagColor }"
          :title="tagTitle"
          :aria-label="tagTitle"
          role="img"
        ></span>
      </span>
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
          </span>
          <span v-if="statsInline && !compact" class="conn-stats" :title="statsTitle" :aria-label="statsTitle">{{ statsInline }}</span>
        </div>
        <span class="conn-meta" :title="metaTitle">
          <span class="conn-addr">{{ connection.username }}@{{ connection.host }}:{{ connection.port }}</span>
          <template v-if="groupName">
            <span class="meta-sep" aria-hidden="true">·</span>
            <span class="conn-group" :title="groupName">{{ t('connections.resultGroup', { name: groupName }) }}</span>
          </template>
          <template v-if="connection.note && !compact">
            <span class="meta-sep" aria-hidden="true">·</span>
            <span class="conn-note" :title="connection.note">{{ connection.note }}</span>
          </template>
        </span>
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
          class="action-btn connect"
          type="button"
          :aria-label="connecting ? t('common.cancel') : connectionError ? t('terminal.retryConnection') : t('connections.connect')"
          @click.stop="connecting ? emit('cancel-connect', connection.id) : requestConnect()"
          @dblclick.stop
        >
          <AppIcon :name="connecting ? 'close' : connectionError ? 'refresh' : 'link'" size="sm" />
          <span class="connect-label">{{ connecting ? t('common.cancel') : connectionError ? t('terminal.retryConnection') : t('connections.connect') }}</span>
        </button>
      </el-tooltip>

      <el-tooltip :content="t('connections.copyConnection')" placement="bottom">
        <button
          class="action-btn secondary-action"
          type="button"
          :aria-label="t('connections.copyConnection')"
          @click.stop="emit('copy', connection)"
        >
          <AppIcon name="copy" size="sm" />
        </button>
      </el-tooltip>

      <el-tooltip :content="t('connections.edit')" placement="bottom">
        <button
          class="action-btn secondary-action"
          type="button"
          :aria-label="t('connections.edit')"
          @click.stop="emit('edit', connection)"
        >
          <AppIcon name="edit" size="sm" />
        </button>
      </el-tooltip>

      <el-tooltip :content="connection.pinned ? t('connections.unpin') : t('connections.pin')" placement="bottom">
        <button
          class="action-btn secondary-action pin-action"
          type="button"
          :class="{ active: connection.pinned }"
          :aria-label="connection.pinned ? t('connections.unpin') : t('connections.pin')"
          :aria-pressed="connection.pinned === true"
          @click.stop="emit('pin', connection.id)"
        >
          <AppIcon :name="connection.pinned ? 'pin-fill' : 'pin'" size="sm" />
        </button>
      </el-tooltip>

      <div class="more-wrap secondary-action">
        <el-tooltip :content="t('connections.more')" placement="bottom" :disabled="menuOpen">
          <button
            ref="moreBtnRef"
            class="action-btn more"
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
            <div v-if="menuMode === 'context' || compact" class="ui-menu-sep" role="separator"></div>
            <button v-if="menuMode === 'context' || compact" type="button" class="ui-menu-item" role="menuitem" @click="onMenuAction('copy')">
              <AppIcon name="copy" size="sm" class="more-item-icon" />
              {{ t('connections.copyConnection') }}
            </button>
            <button v-if="menuMode === 'context' || compact" type="button" class="ui-menu-item" role="menuitem" @click="onMenuAction('edit')">
              <AppIcon name="edit" size="sm" class="more-item-icon" />
              {{ t('connections.edit') }}
            </button>
            <button
              v-if="menuMode === 'context' || compact"
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
  --tag-color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 12px 9px 8px;
  border-radius: 8px;
  cursor: grab;
  transition: background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
  /*
   * Each row is its own rounded card.
   * Left accent + outer border; dividers on the wrap still meet the left strip.
   */
  border: 1px solid color-mix(in srgb, var(--border-color) 55%, transparent);
  border-left: 3px solid color-mix(in srgb, var(--border-color) 55%, transparent);
  margin-bottom: 0;
  background: color-mix(in srgb, var(--bg-secondary) 55%, transparent);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text-primary) 4%, transparent);
  user-select: none;
}

.connection-row.has-color-tag {
  border-left-color: var(--tag-color);
}

.connection-row.connecting {
  border-top-color: color-mix(in srgb, var(--accent) 40%, var(--border-color));
  border-right-color: color-mix(in srgb, var(--accent) 40%, var(--border-color));
  border-bottom-color: color-mix(in srgb, var(--accent) 40%, var(--border-color));
  cursor: wait;
}

.connection-row.pinned {
  background: color-mix(in srgb, var(--warning) 8%, var(--bg-secondary));
}

.pin-icon {
  color: var(--warning);
  flex-shrink: 0;
}

/* 轻量 hover：抬升一层背景，保留边框骨架 */
.connection-row:hover {
  background: color-mix(in srgb, var(--hover-bg) 80%, var(--bg-secondary));
  border-right-color: color-mix(in srgb, var(--border-color) 75%, transparent);
}

.connection-row.pinned:hover {
  background: color-mix(in srgb, var(--warning) 12%, var(--hover-bg));
}

.connection-row.menu-open,
.connection-row:focus-within {
  background: color-mix(in srgb, var(--hover-bg) 80%, var(--bg-secondary));
}

/* Selection is a quiet fill; keyboard focus has its own crisp boundary. */
.connection-row.keyboard-active,
.connection-row.keyboard-active:hover {
  background: var(--accent-bg);
}

.connection-row:has(:focus-visible) {
  /* Keep the left edge reserved for the connection's color tag. */
  border-top-color: var(--accent);
  border-right-color: var(--accent);
  border-bottom-color: var(--accent);
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
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.conn-error {
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
  font-size: 13px;
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
.row-heading { display: flex; align-items: baseline; gap: 12px; min-width: 0; }

.conn-meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
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

.conn-stats {
  flex: 0 2 auto;
  max-width: 45%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.color-tag-slot { display: inline-flex; align-items: center; width: 10px; height: 10px; flex-shrink: 0; }

.color-tag {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  /* Single crisp outline — avoid multi soft rings + scale() blur */
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--tag-color) 35%, var(--border-color));
  transition: box-shadow 0.12s ease;
}

.connection-row:hover .color-tag,
.connection-row.keyboard-active .color-tag,
.connection-row.menu-open .color-tag {
  box-shadow: 0 0 0 1px var(--tag-color);
}

.connection-row.has-color-tag .color-tag {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--tag-color) 55%, var(--border-color));
}

.connection-row.has-color-tag:hover .color-tag,
.connection-row.has-color-tag.keyboard-active .color-tag,
.connection-row.has-color-tag.menu-open .color-tag {
  box-shadow: 0 0 0 1px var(--tag-color);
}

.conn-group,
.conn-note {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 28%;
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.85;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.conn-note { flex: 1 1 0%; max-width: none; color: var(--text-primary); opacity: 1; font-size: 12px; }
.conn-meta:has(.conn-note) .conn-addr { max-width: 60%; }

/* 测试结果在非 hover 时也保留可见，避免状态闪失 */
.test-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 120px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
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

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 5px 8px;
  min-height: 28px;
  background: none;
  border: 1px solid transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  font-size: 12px;
  transition: color 0.12s, background 0.12s, border-color 0.12s;
  white-space: nowrap;
}

.action-btn:hover {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

.action-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.action-btn.connect {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  font-weight: 600;
  padding-inline: 10px;
}

.action-btn.connect:hover {
  background: var(--accent-bg);
  border-color: var(--accent);
}

.action-btn.more,
.action-btn.pin-action {
  width: 28px;
  padding-inline: 0;
}

.action-btn.pin-action.active {
  color: var(--accent);
  background: var(--accent-bg);
}

.connect-label {
  font-size: 12px;
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
  .connect-label {
    display: none;
  }

  .action-btn.connect {
    width: 28px;
    padding-inline: 0;
  }

}

.connection-row.compact { min-height: 36px; padding: 3px 8px 3px 4px; border-radius: 4px; box-shadow: none; }
.connection-row.compact .row-main { gap: 8px; }
.connection-row.compact .row-info { flex-direction: row; align-items: center; gap: 12px; }
.connection-row.compact .row-heading { flex: 0 1 34%; min-width: 0; }
.connection-row.compact .conn-meta { flex: 1; }
.connection-row.compact .row-info:has(.conn-error) { flex-wrap: wrap; row-gap: 2px; }
.connection-row.compact .conn-error { flex: 1 0 100%; }
.connection-row.compact .secondary-action:not(.more-wrap) { display: none; }
.connection-row.compact .row-actions { gap: 2px; }
.connection-row.compact .connect-label { display: none; }
.connection-row.compact .action-btn.connect { width: 28px; padding-inline: 0; }
</style>
