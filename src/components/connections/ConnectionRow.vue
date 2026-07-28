<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'
import type { Connection } from '../../env.d.ts'
import { getConnectionTagColor } from '../../utils/connectionTags'
import { placePopupNearAnchor } from '../../utils/popupPosition'
import { useOutsideDismiss } from '../../composables/useOutsideDismiss'

const { t } = useI18n()

interface TestStatus {
  state: 'idle' | 'testing' | 'success' | 'error'
  latency?: number
  error?: string
}

const props = withDefaults(defineProps<{
  connection: Connection
  testStatus: TestStatus
  /** When true, hide/disable the drag handle (e.g. while searching) */
  reorderDisabled?: boolean
  /** Keyboard focus highlight from parent list */
  keyboardActive?: boolean
}>(), {
  reorderDisabled: false,
  keyboardActive: false,
})

const emit = defineEmits<{
  (e: 'connect', connectionId: string): void
  (e: 'test', connectionId: string): void
  (e: 'edit', connection: Connection): void
  (e: 'delete', connectionId: string): void
  (e: 'copy', connection: Connection): void
  (e: 'drag-start', connectionId: string, event: DragEvent): void
  (e: 'drag-end'): void
}>()

const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)
const moreBtnRef = ref<HTMLElement | null>(null)
const isDragging = ref(false)
const menuStyle = ref<Record<string, string>>({
  left: '0px',
  top: '0px',
})

const tagColor = computed(() => getConnectionTagColor(props.connection.colorTag))
const tagTitle = computed(() => props.connection.note || (props.connection.colorTag ? t('connections.colorTagLabel') : t('connections.colorTagDefault')))

function onDoubleClick() {
  emit('connect', props.connection.id)
}

function onDragStart(e: DragEvent) {
  if (props.reorderDisabled) {
    e.preventDefault()
    return
  }
  isDragging.value = true
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-lite-connect-conn', props.connection.id)
    // Also store plain text for broader drop-target compatibility
    e.dataTransfer.setData('text/plain', props.connection.id)
  }
  emit('drag-start', props.connection.id, e)
}

function onDragEnd() {
  isDragging.value = false
  emit('drag-end')
}

async function positionMoreMenu() {
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  const btn = moreBtnRef.value
  const menu = menuRef.value
  if (!btn || !menu) return
  const anchor = btn.getBoundingClientRect()
  const size = { width: menu.offsetWidth || 140, height: menu.offsetHeight || 80 }
  const pos = placePopupNearAnchor(anchor, size, { align: 'end', gap: 4 })
  menuStyle.value = {
    left: `${pos.left}px`,
    top: `${pos.top}px`,
    maxHeight: pos.maxHeight > 0 ? `${pos.maxHeight}px` : 'none',
  }
}

function toggleMenu(e: MouseEvent) {
  e.stopPropagation()
  menuOpen.value = !menuOpen.value
}

function closeMenu() {
  menuOpen.value = false
}

watch(menuOpen, (open) => {
  if (open) void positionMoreMenu()
})

useOutsideDismiss(
  menuOpen,
  closeMenu,
  () => [menuRef.value, moreBtnRef.value],
)

function onMenuAction(action: 'test' | 'delete') {
  closeMenu()
  if (action === 'test') emit('test', props.connection.id)
  else if (action === 'delete') emit('delete', props.connection.id)
}
</script>

<template>
  <div
    class="connection-row"
    :class="{ dragging: isDragging, 'menu-open': menuOpen, 'keyboard-active': keyboardActive }"
    @dblclick="onDoubleClick"
  >
    <div
      class="drag-handle"
      :class="{ disabled: reorderDisabled }"
      :draggable="!reorderDisabled"
      :title="reorderDisabled ? t('connections.dragDisabledTitle') : t('connections.dragTitle')"
      :aria-label="reorderDisabled ? t('connections.dragDisabledAria') : t('connections.dragAria')"
      @dragstart="onDragStart"
      @dragend="onDragEnd"
      @click.stop
      @dblclick.stop
    >
      <AppIcon name="grip" :size="12" />
    </div>

    <div class="row-main">
      <span
        class="color-tag"
        :style="{ background: tagColor }"
        :title="tagTitle"
        :aria-label="tagTitle"
        role="img"
      ></span>
      <div class="row-info">
        <span class="conn-name">{{ connection.name }}</span>
        <span class="conn-meta">{{ connection.username }}@{{ connection.host }}:{{ connection.port }}</span>
        <span v-if="connection.note" class="conn-note" :title="connection.note">{{ connection.note }}</span>
      </div>
    </div>

    <div class="row-actions">
      <span
        v-if="testStatus.state === 'testing'"
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

      <el-tooltip :content="t('connections.connectTooltip')" placement="bottom">
        <button
          class="action-btn connect"
          type="button"
          :aria-label="t('connections.connect')"
          @click.stop="emit('connect', connection.id)"
        >
          <AppIcon name="link" :size="14" />
          <span class="connect-label">{{ t('connections.connect') }}</span>
        </button>
      </el-tooltip>

      <el-tooltip :content="t('connections.copyConnection')" placement="bottom">
        <button
          class="action-btn"
          type="button"
          :aria-label="t('connections.copyConnection')"
          @click.stop="emit('copy', connection)"
        >
          <AppIcon name="copy" :size="14" />
        </button>
      </el-tooltip>

      <el-tooltip :content="t('connections.edit')" placement="bottom">
        <button
          class="action-btn"
          type="button"
          :aria-label="t('connections.edit')"
          @click.stop="emit('edit', connection)"
        >
          <AppIcon name="edit" :size="14" />
        </button>
      </el-tooltip>

      <div class="more-wrap">
        <el-tooltip :content="t('connections.more')" placement="bottom" :disabled="menuOpen">
          <button
            ref="moreBtnRef"
            class="action-btn more"
            type="button"
            :aria-label="t('connections.moreAria')"
            :aria-expanded="menuOpen"
            aria-haspopup="menu"
            @click="toggleMenu"
          >
            <AppIcon name="more" :size="14" />
          </button>
        </el-tooltip>
        <Teleport to="body">
          <div
            v-if="menuOpen"
            ref="menuRef"
            class="more-menu"
            role="menu"
            :style="menuStyle"
            @click.stop
          >
            <button
              type="button"
              class="more-item"
              role="menuitem"
              :disabled="testStatus.state === 'testing'"
              @click="onMenuAction('test')"
            >
              {{ t('connections.testConnection') }}
            </button>
            <div class="more-divider" role="separator"></div>
            <button type="button" class="more-item danger" role="menuitem" @click="onMenuAction('delete')">
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 10px 6px;
  border-radius: 8px;
  cursor: default;
  transition: background 0.12s ease;
  border: 1px solid transparent;
  margin-bottom: 4px;
  background: transparent;
  user-select: none;
}

/* 轻量 hover：仅微弱背景，不改边框、不改手型 */
.connection-row:hover {
  background: var(--hover-bg);
}

.connection-row.menu-open,
.connection-row:focus-within,
.connection-row.keyboard-active {
  background: var(--hover-bg);
}

.connection-row.keyboard-active {
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
}

.connection-row.dragging {
  opacity: 0.55;
  background: var(--accent-bg);
}

.drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 4px;
  color: var(--text-secondary);
  opacity: 0;
  cursor: grab;
  transition: opacity 0.12s ease, color 0.12s ease, background 0.12s ease;
}

.connection-row:hover .drag-handle,
.connection-row.menu-open .drag-handle,
.connection-row:focus-within .drag-handle {
  opacity: 0.55;
}

.drag-handle:hover {
  opacity: 1 !important;
  color: var(--text-primary);
  background: var(--hover-bg);
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-handle.disabled {
  cursor: not-allowed;
  opacity: 0 !important;
  pointer-events: none;
}

.row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.conn-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conn-meta {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

.color-tag {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--border-color) 80%, transparent);
}

.conn-note {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.85;
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
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
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

.action-btn.more {
  width: 28px;
  padding-inline: 0;
}

.connect-label {
  font-size: 12px;
}

.more-wrap {
  position: relative;
}

.more-menu {
  position: fixed;
  z-index: 10000;
  min-width: 140px;
  padding: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.more-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.more-item:hover:not(:disabled) {
  background: var(--hover-bg);
}

.more-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.more-item.danger {
  color: var(--danger);
}

.more-item.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.more-divider {
  height: 1px;
  margin: 2px 6px;
  background: var(--border-color);
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

  .drag-handle {
    opacity: 0.4;
  }
}
</style>
