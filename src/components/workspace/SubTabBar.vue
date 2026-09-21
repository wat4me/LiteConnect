<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'
import { resolveSplitDropTarget } from '@/utils/terminal/splitDropTarget'
import type { SplitDropTarget } from '@/utils/terminal/splitDropTarget'
import { useSplitTabDrag } from '@/composables/terminal/useSplitTabDrag'
import type { SplitDropPayload, SplitPreviewPayload } from '@/domain/session/types'
import { buildCombinedTabItems } from '@/utils/shared/combinedTabs'

const { t } = useI18n()

type SessionItem = { id: string; tabNumber: number }

const SPLIT_TIP_KEY = 'LiteConnect.splitDragTipSeen'

const props = defineProps<{
  sessions: SessionItem[]
  activeSessionId: string | null
  connectionId: string
  unreadSessions?: Set<string>
  aiApprovalSessions?: Set<string>
  disconnectedSessionIds?: Set<string>
  /** Terminal container element used to compute the drop side during tab drag */
  terminalContainer?: HTMLElement | null
  dockerTabOpen?: boolean
  dockerTabActive?: boolean
  splitMode?: 'none' | 'horizontal' | 'vertical'
  splitPrimarySessionId?: string | null
  splitSecondarySessionId?: string | null
  splitGroupActive?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', sessionId: string): void
  (e: 'close', sessionId: string): void
  (e: 'add', connectionId: string): void
  (e: 'select-docker'): void
  (e: 'close-docker'): void
  (e: 'split-preview', payload: SplitPreviewPayload | null): void
  (e: 'split-commit', payload: SplitDropPayload): void
  (e: 'select-split'): void
  (e: 'close-split'): void
}>()

const showSplitTip = ref(false)

const displayTabs = computed(() => buildCombinedTabItems(
  props.sessions,
  props.splitPrimarySessionId,
  props.splitSecondarySessionId,
  (session) => session.id,
))

function hasSplitStatus(sessionIds: string[], source?: Set<string>) {
  return !!source && sessionIds.some((id) => source.has(id))
}

function splitSessionLabel(session: SessionItem) {
  return t('terminal.tabLabel', { n: session.tabNumber })
}

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


function computeDrop(
  clientX: number,
  clientY: number,
  startX: number,
  startY: number,
): SplitDropTarget | null {
  const container = props.terminalContainer
  if (!container) {
    // Fallback to old behavior: direction-only
    const dx = clientX - startX
    const dy = clientY - startY
    const mode: 'horizontal' | 'vertical' = Math.abs(dx) > Math.abs(dy) ? 'vertical' : 'horizontal'
    return { mode, side: mode === 'horizontal' ? 'bottom' : 'right' }
  }

  return resolveSplitDropTarget(clientX, clientY, container.getBoundingClientRect())
}

const {
  draggingId: draggingSessionId,
  startDrag,
  consumeSuppressedClick,
} = useSplitTabDrag({
  resolveTarget: computeDrop,
  onPreview: (payload) => emit('split-preview', payload),
  onCommit: (payload) => emit('split-commit', payload),
})

function onTabDragStart(e: MouseEvent, sessionId: string) {
  if (e.button !== 0) return
  if (props.sessions.length < 2) return
  startDrag(e, { dragId: sessionId, sessionId })
}

function onTabClick(sessionId: string) {
  if (consumeSuppressedClick()) return
  emit('select', sessionId)
}
</script>

<template>
  <div class="sub-tab-bar-wrap">
    <div class="sub-tab-bar">
      <div class="sub-tabs-scroll">
        <template v-for="item in displayTabs" :key="item.kind === 'split' ? 'split-group' : item.item.id">
          <div
            v-if="item.kind === 'split'"
            class="sub-tab split-group-tab"
            :class="{ active: !dockerTabActive && splitGroupActive }"
            :title="t('terminal.restoreSplit')"
            @click="emit('select-split')"
          >
            <AppIcon :name="splitMode === 'horizontal' ? 'split-h' : 'split-v'" size="xs" class="split-group-icon" />
            <span class="sub-tab-label">{{ splitSessionLabel(item.primary) }}</span>
            <span class="split-group-divider">|</span>
            <span class="sub-tab-label">{{ splitSessionLabel(item.secondary) }}</span>
            <span
              v-if="hasSplitStatus([item.primary.id, item.secondary.id], disconnectedSessionIds)"
              class="sub-tab-disconnected-dot"
              :title="t('terminal.disconnected')"
            ></span>
            <span
              v-else-if="hasSplitStatus([item.primary.id, item.secondary.id], aiApprovalSessions)"
              class="sub-tab-approval-dot"
              :title="t('ai.approvalHintAction')"
            ></span>
            <span
              v-else-if="hasSplitStatus([item.primary.id, item.secondary.id], unreadSessions)"
              class="sub-tab-unread-dot"
            ></span>
            <button
              class="sub-tab-close"
              :title="t('terminal.exitSplit')"
              :aria-label="t('terminal.exitSplit')"
              @click.stop="emit('close-split')"
            >
              <AppIcon name="close" size="xs" />
            </button>
          </div>
          <div
            v-else
            :key="item.item.id"
            class="sub-tab"
            :class="{
              active: !dockerTabActive && !splitGroupActive && item.item.id === activeSessionId,
              dragging: draggingSessionId === item.item.id,
              disconnected: disconnectedSessionIds?.has(item.item.id),
            }"
            :title="sessions.length >= 2 ? t('terminal.dragSplitTitle') : undefined"
            @mousedown="onTabDragStart($event, item.item.id)"
            @click="onTabClick(item.item.id)"
          >
            <span class="sub-tab-label">{{ t('terminal.tabLabel', { n: item.item.tabNumber }) }}</span>
            <span
              v-if="disconnectedSessionIds?.has(item.item.id)"
              class="sub-tab-disconnected-dot"
              :title="t('terminal.disconnected')"
            ></span>
            <span
              v-else-if="aiApprovalSessions && item.item.id !== activeSessionId && aiApprovalSessions.has(item.item.id)"
              class="sub-tab-approval-dot"
              :title="t('ai.approvalHintAction')"
            ></span>
            <span
              v-else-if="unreadSessions && item.item.id !== activeSessionId && unreadSessions.has(item.item.id)"
              class="sub-tab-unread-dot"
            ></span>
            <button class="sub-tab-close" @click.stop="emit('close', item.item.id)">
              <AppIcon name="close" size="xs" />
            </button>
          </div>
        </template>
        <div
          v-if="dockerTabOpen"
          class="sub-tab"
          :class="{ active: dockerTabActive }"
          :title="t('docker.title')"
          @click="emit('select-docker')"
        >
          <AppIcon name="docker" size="xs" class="sub-tab-docker-icon" />
          <span class="sub-tab-label">{{ t('docker.tabLabel') }}</span>
          <button
            class="sub-tab-close"
            :title="t('docker.closeTab')"
            :aria-label="t('docker.closeTab')"
            @click.stop="emit('close-docker')"
          >
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
  height: 28px;
  min-height: 28px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  padding-left: 6px;
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
  color: var(--accent);
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
  height: 20px;
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

.split-group-tab {
  border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
  padding-left: 6px;
}

.split-group-tab.active {
  background: var(--accent-bg);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  color: var(--accent);
}

.split-group-icon {
  flex-shrink: 0;
  opacity: 0.85;
}

.split-group-divider {
  color: var(--border-color);
  font-weight: 400;
}

.sub-tab-label {
  font-weight: 500;
  min-width: 8px;
  text-align: center;
}

.sub-tab-docker-icon {
  flex-shrink: 0;
  opacity: 0.85;
}

.sub-tab-unread-dot,
.sub-tab-approval-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger);
  flex-shrink: 0;
  animation: sub-tab-unread-pulse 1.6s ease-in-out infinite;
}

.sub-tab-approval-dot {
  background: var(--warning);
}

.sub-tab-disconnected-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger);
  flex-shrink: 0;
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
