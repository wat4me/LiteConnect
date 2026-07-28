<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from './icons/AppIcon.vue'

const { t } = useI18n()

type DropSide = 'left' | 'right' | 'top' | 'bottom'
interface DropPayload {
  mode: 'horizontal' | 'vertical'
  side: DropSide
  sessionId: string
}

const SPLIT_TIP_KEY = 'LiteConnect.splitDragTipSeen'

const props = defineProps<{
  sessions: { id: string; connectionName: string; tabNumber: number }[]
  activeSessionId: string | null
  connectionId: string
  unreadSessions?: Set<string>
  /** Terminal container element used to compute the drop side during tab drag */
  terminalContainer?: HTMLElement | null
}>()

const emit = defineEmits<{
  (e: 'select', sessionId: string): void
  (e: 'close', sessionId: string): void
  (e: 'add', connectionId: string): void
  (e: 'split-preview', payload: DropPayload | null): void
  (e: 'split-commit', payload: DropPayload): void
}>()

const DRAG_THRESHOLD = 18

const dragging = ref(false)
const showSplitTip = ref(false)

function dismissSplitTip() {
  showSplitTip.value = false
  try {
    localStorage.setItem(SPLIT_TIP_KEY, '1')
  } catch {
    // ignore
  }
}

function maybeShowSplitTip() {
  if (props.sessions.length < 2) return
  try {
    if (localStorage.getItem(SPLIT_TIP_KEY) === '1') return
  } catch {
    return
  }
  showSplitTip.value = true
}

onMounted(maybeShowSplitTip)
watch(
  () => props.sessions.length,
  (n, prev) => {
    if (n >= 2 && (prev === undefined || prev < 2)) maybeShowSplitTip()
  },
)


let dragStartX = 0
let dragStartY = 0
let dragStarted = false
let suppressClick = false
let dragSessionId = ''

function computeDrop(clientX: number, clientY: number): { mode: 'horizontal' | 'vertical'; side: DropSide } | null {
  const dx = clientX - dragStartX
  const dy = clientY - dragStartY
  if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return null

  const container = props.terminalContainer
  if (!container) {
    // Fallback to old behavior: direction-only
    const mode: 'horizontal' | 'vertical' = Math.abs(dx) > Math.abs(dy) ? 'vertical' : 'horizontal'
    return { mode, side: mode === 'horizontal' ? 'bottom' : 'right' }
  }

  const rect = container.getBoundingClientRect()
  // Only consider drops inside the terminal area
  const insideX = clientX >= rect.left && clientX <= rect.right
  const insideY = clientY >= rect.top && clientY <= rect.bottom
  const mode: 'horizontal' | 'vertical' = Math.abs(dx) > Math.abs(dy) ? 'vertical' : 'horizontal'

  if (mode === 'vertical') {
    if (insideY) {
      const relX = (clientX - rect.left) / rect.width
      const side: DropSide = relX < 0.5 ? 'left' : 'right'
      return { mode, side }
    }
    // Outside vertically: default by drag direction
    const side: DropSide = dx > 0 ? 'right' : 'left'
    return { mode, side }
  } else {
    if (insideX) {
      const relY = (clientY - rect.top) / rect.height
      const side: DropSide = relY < 0.5 ? 'top' : 'bottom'
      return { mode, side }
    }
    const side: DropSide = dy > 0 ? 'bottom' : 'top'
    return { mode, side }
  }
}

function onTabDragStart(e: MouseEvent, sessionId: string) {
  if (e.button !== 0) return
  if (props.sessions.length < 2) return
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStarted = false
  dragging.value = true
  dragSessionId = sessionId

  const onMove = (ev: MouseEvent) => {
    if (!dragging.value) return
    const dx = ev.clientX - dragStartX
    const dy = ev.clientY - dragStartY
    if (!dragStarted && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragStarted = true
      suppressClick = true
    }
    if (dragStarted) {
      const drop = computeDrop(ev.clientX, ev.clientY)
      if (drop) {
        emit('split-preview', { ...drop, sessionId: dragSessionId })
      } else {
        emit('split-preview', null)
      }
    }
  }

  const onUp = (ev: MouseEvent) => {
    dragging.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)

    if (!dragStarted) return
    const drop = computeDrop(ev.clientX, ev.clientY)
    emit('split-preview', null)
    if (drop) emit('split-commit', { ...drop, sessionId: dragSessionId })
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function onTabClick(sessionId: string) {
  if (suppressClick) {
    suppressClick = false
    return
  }
  emit('select', sessionId)
}
</script>

<template>
  <div class="sub-tab-bar-wrap">
    <div class="sub-tab-bar">
      <div class="sub-tabs-scroll">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="sub-tab"
          :class="{ active: session.id === activeSessionId, dragging }"
          :title="sessions.length >= 2 ? t('terminal.dragSplitTitle') : undefined"
          @mousedown="onTabDragStart($event, session.id)"
          @click="onTabClick(session.id)"
        >
          <span class="sub-tab-label">{{ t('terminal.tabLabel', { n: session.tabNumber }) }}</span>
          <span
            v-if="unreadSessions && session.id !== activeSessionId && unreadSessions.has(session.id)"
            class="sub-tab-unread-dot"
          ></span>
          <button class="sub-tab-close" @click.stop="emit('close', session.id)">
            <AppIcon name="close" size="xs" />
          </button>
        </div>
        <button class="sub-tab-add" @click="emit('add', connectionId)" :title="t('terminal.newWindow')">
          <AppIcon name="plus" size="xs" />
        </button>
      </div>
      <div v-if="$slots.actions" class="sub-tab-actions">
        <slot name="actions"></slot>
      </div>
    </div>
    <div v-if="showSplitTip" class="split-tip" role="status">
      <span>{{ t('terminal.splitTip') }}</span>
      <button type="button" class="split-tip-dismiss" @click="dismissSplitTip">{{ t('terminal.gotIt') }}</button>
    </div>
  </div>
</template>

<style scoped>
.sub-tab-bar-wrap {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sub-tab-bar {
  height: 30px;
  min-height: 30px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  padding-left: 8px;
}

.split-tip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.split-tip-dismiss {
  border: none;
  background: transparent;
  color: var(--accent, #58a6ff);
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
  padding: 2px 4px;
}

.sub-tabs-scroll {
  display: flex;
  height: 100%;
  flex: 1;
  align-items: center;
  gap: 2px;
  overflow: hidden;
  min-width: 0;
}

.sub-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  height: 22px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-secondary);
  transition: all 0.15s;
  user-select: none;
  background: transparent;
  flex-shrink: 0;
}

.sub-tab.dragging {
  cursor: grabbing;
}

.sub-tab:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.sub-tab.active {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.sub-tab-label {
  font-weight: 500;
  min-width: 8px;
  text-align: center;
}

.sub-tab-unread-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger, #f85149);
  flex-shrink: 0;
  animation: sub-tab-unread-pulse 1.6s ease-in-out infinite;
}

@keyframes sub-tab-unread-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.sub-tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 1px;
  border-radius: 3px;
  transition: all 0.15s;
  opacity: 0.5;
}

.sub-tab:hover .sub-tab-close {
  opacity: 1;
}

.sub-tab-close:hover {
  opacity: 1;
  background: rgba(248, 81, 73, 0.15);
  color: var(--danger);
}

.sub-tab-add {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px dashed var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}

.sub-tab-add:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-bg);
}

.sub-tab-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 12px;
  flex-shrink: 0;
}
</style>
