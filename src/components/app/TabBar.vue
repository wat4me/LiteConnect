<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'
import { useAiBackgroundJobs } from '@/composables/ai/useAiBackgroundJobs'
import type { Connection } from '@/env.d.ts'
import { CONNECTION_COLOR_TAGS } from '@/utils/connections/connectionTags'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'
import type { SplitDropPayload, SplitPreviewPayload } from '@/domain/session/types'
import { resolveSplitDropTarget, type SplitDropTarget } from '@/utils/terminal/splitDropTarget'
import { useSplitTabDrag } from '@/composables/terminal/useSplitTabDrag'
import { buildCombinedTabItems } from '@/utils/shared/combinedTabs'
import ScrollableTabs from '@/components/common/ScrollableTabs.vue'

const { t } = useI18n()
const { runningSessionIds: backgroundJobSessions } = useAiBackgroundJobs(() => null)

type HostGroup = {
  connectionId: string
  connectionName: string
  activeSessionId: string | null
  sessions: { id: string }[]
}

const props = defineProps<{
  groups: HostGroup[]
  activeGroupId: string | null
  recentConnections: Connection[]
  /** 全量连接，供快速连接搜索 */
  connections?: Connection[]
  latencyMap: Record<string, number> | null
  latencyEnabled: boolean
  unreadSessions?: Set<string>
  aiApprovalSessions?: Set<string>
  /** 当前是否在连接管理页（高亮「返回连接列表」） */
  homeActive?: boolean
  disconnectedSessionIds?: Set<string>
  terminalContainer?: HTMLElement | null
  splitPrimarySessionId?: string | null
  splitSecondarySessionId?: string | null
  splitMode?: 'none' | 'horizontal' | 'vertical'
  splitGroupActive?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', connectionId: string): void
  (e: 'close', connectionId: string): void
  (e: 'add-session', connectionId: string): void
  (e: 'select-home'): void
  (e: 'quick-connect', connectionId: string): void
  (e: 'split-preview', payload: SplitPreviewPayload | null): void
  (e: 'split-commit', payload: SplitDropPayload): void
  (e: 'select-split'): void
  (e: 'close-split'): void
}>()

const displayHostTabs = computed(() => {
  const primary = props.groups.find((group) =>
    group.sessions.some((session) => session.id === props.splitPrimarySessionId),
  )
  const secondary = props.groups.find((group) =>
    group.sessions.some((session) => session.id === props.splitSecondarySessionId),
  )
  return buildCombinedTabItems(
    props.groups,
    primary?.connectionId,
    secondary?.connectionId,
    (group) => group.connectionId,
  )
})

const activeHostTabKey = computed(() => {
  if (props.homeActive) return null
  if (props.splitGroupActive) return JSON.stringify([props.splitPrimarySessionId, props.splitSecondarySessionId])
  return props.groups.find((group) => group.connectionId === props.activeGroupId)?.activeSessionId ?? props.activeGroupId
})

function splitHostHasStatus(source: Set<string> | undefined, primary: HostGroup, secondary: HostGroup) {
  if (!source) return false
  return [...primary.sessions, ...secondary.sessions].some((session) => source.has(session.id))
}

const hoveredDropConnectionId = ref<string | null>(null)

function hostDropTarget(clientX: number, clientY: number): SplitDropTarget | null {
  hoveredDropConnectionId.value = null
  const sourceConnectionId = draggedConnectionId.value
  const hoveredElement = document.elementFromPoint(clientX, clientY)
  const hoveredTab = hoveredElement?.closest<HTMLElement>('[data-host-drop-id]')
  const targetConnectionId = hoveredTab?.dataset.hostDropId
  if (sourceConnectionId && targetConnectionId && targetConnectionId !== sourceConnectionId) {
    const sourceIndex = props.groups.findIndex((group) => group.connectionId === sourceConnectionId)
    const targetIndex = props.groups.findIndex((group) => group.connectionId === targetConnectionId)
    const targetGroup = props.groups[targetIndex]
    const primarySessionId = targetGroup?.activeSessionId || targetGroup?.sessions[0]?.id
    if (sourceIndex >= 0 && targetIndex >= 0 && primarySessionId) {
      hoveredDropConnectionId.value = targetConnectionId
      return {
        mode: 'vertical',
        side: sourceIndex < targetIndex ? 'left' : 'right',
        primarySessionId,
      }
    }
  }

  // Dropping an inactive host on the visible terminal keeps the precise
  // edge-based layout. An active host needs an explicit peer tab as target.
  if (sourceConnectionId === props.activeGroupId) return null
  const container = props.terminalContainer
  if (!container) return null
  return resolveSplitDropTarget(clientX, clientY, container.getBoundingClientRect())
}

const {
  draggingId: draggedConnectionId,
  startDrag: startHostDrag,
  consumeSuppressedClick: consumeSuppressedHostClick,
} = useSplitTabDrag({
  resolveTarget: hostDropTarget,
  onPreview: (payload) => {
    if (!payload) hoveredDropConnectionId.value = null
    emit('split-preview', payload)
  },
  onCommit: (payload) => emit('split-commit', payload),
})

function onHostTabDragStart(
  event: MouseEvent,
  group: HostGroup,
) {
  if (event.button !== 0 || props.groups.length < 2) return
  if (!props.terminalContainer) return
  const sessionId = group.activeSessionId || group.sessions[0]?.id
  if (!sessionId) return
  startHostDrag(event, { dragId: group.connectionId, sessionId })
}

function onHostTabClick(connectionId: string) {
  if (consumeSuppressedHostClick()) return
  emit('select', connectionId)
}

const showQuickConnect = ref(false)
const quickConnectWrapperRef = ref<HTMLElement | null>(null)
const quickConnectButtonRef = ref<HTMLButtonElement | null>(null)
const quickConnectDropdownRef = ref<HTMLElement | null>(null)
const quickConnectDropdownStyle = ref<Record<string, string>>({})
const quickSearchQuery = ref('')
const quickSearchInputRef = ref<HTMLInputElement | null>(null)
const quickActiveIndex = ref(0)

useOutsideDismiss(
  showQuickConnect,
  () => {
    showQuickConnect.value = false
  },
  () => [quickConnectButtonRef.value, quickConnectDropdownRef.value, quickConnectWrapperRef.value],
)

function formatLatency(ms: number): string {
  if (ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function latencyColor(ms: number): string {
  if (ms < 0) return 'var(--danger)'
  // Healthy latency stays quiet; only slow or failed links draw color.
  if (ms < 200) return 'var(--text-secondary)'
  if (ms < 500) return 'var(--warning)'
  return 'var(--danger)'
}

function hasGroupUnread(group: { sessions: { id: string }[] }): boolean {
  const set = props.unreadSessions
  if (!set) return false
  return group.sessions.some((s) => set.has(s.id))
}

function hasGroupAiApproval(group: { sessions: { id: string }[] }): boolean {
  const set = props.aiApprovalSessions
  if (!set) return false
  return group.sessions.some((s) => set.has(s.id))
}

function isGroupDisconnected(group: { sessions: { id: string }[] }): boolean {
  const set = props.disconnectedSessionIds
  if (!set || set.size === 0) return false
  return group.sessions.some((s) => set.has(s.id))
}

function tagSearchText(conn: Connection): string {
  const tag = conn.colorTag || ''
  if (!tag) return ''
  const found = CONNECTION_COLOR_TAGS.find((t) => t.id === tag)
  return `${tag} ${found?.label || ''}`.toLowerCase()
}

function matchesConnection(conn: Connection, q: string): boolean {
  if (!q) return true
  return (
    conn.name.toLowerCase().includes(q) ||
    conn.host.toLowerCase().includes(q) ||
    conn.username.toLowerCase().includes(q) ||
    (conn.note || '').toLowerCase().includes(q) ||
    tagSearchText(conn).includes(q)
  )
}

const allConnections = computed(() => props.connections || [])

/** 无关键词：最近连接；有关键词：全量 name/host/tag 等过滤 */
const quickConnectList = computed(() => {
  const q = quickSearchQuery.value.trim().toLowerCase()
  if (!q) return props.recentConnections
  const pool = allConnections.value.length > 0 ? allConnections.value : props.recentConnections
  return pool.filter((c) => matchesConnection(c, q))
})

const quickConnectTitle = computed(() => {
  const q = quickSearchQuery.value.trim()
  if (q) return t('connections.searchResults', { count: quickConnectList.value.length })
  return t('connections.recentConnections')
})

function pickQuickConnect(connectionId: string) {
  showQuickConnect.value = false
  emit('quick-connect', connectionId)
}

function onQuickSearchKeydown(e: KeyboardEvent) {
  const list = quickConnectList.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (list.length === 0) return
    quickActiveIndex.value = (quickActiveIndex.value + 1) % list.length
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (list.length === 0) return
    quickActiveIndex.value = (quickActiveIndex.value - 1 + list.length) % list.length
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const conn = list[quickActiveIndex.value]
    if (conn) pickQuickConnect(conn.id)
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    showQuickConnect.value = false
  }
}

async function updateQuickConnectDropdownPosition() {
  if (!showQuickConnect.value) return

  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

  const anchor = quickConnectButtonRef.value || quickConnectWrapperRef.value
  const dropdown = quickConnectDropdownRef.value
  if (!anchor || !dropdown) return

  const anchorRect = anchor.getBoundingClientRect()
  const dropdownWidth = dropdown.offsetWidth || 320
  const dropdownHeight = dropdown.offsetHeight || 0
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const margin = 8
  const gap = 4

  // Prefer align-start under the + button; clamp into viewport
  let left = anchorRect.left
  if (left + dropdownWidth > viewportWidth - margin) {
    left = Math.max(margin, anchorRect.right - dropdownWidth)
  }
  if (left < margin) left = margin

  const spaceAbove = anchorRect.top - margin
  const spaceBelow = viewportHeight - anchorRect.bottom - margin
  const openUpwards = dropdownHeight > spaceBelow && spaceAbove > spaceBelow
  const availableHeight = Math.max(0, Math.floor(openUpwards ? spaceAbove : spaceBelow))
  const top = openUpwards
    ? Math.max(margin, anchorRect.top - gap - Math.min(dropdownHeight || availableHeight, availableHeight))
    : anchorRect.bottom + gap

  quickConnectDropdownStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    maxHeight: `${availableHeight}px`,
  }
}

function handleViewportChange() {
  void updateQuickConnectDropdownPosition()
}

function toggleQuickConnect() {
  showQuickConnect.value = !showQuickConnect.value
}

watch(showQuickConnect, async (visible) => {
  if (visible) {
    quickSearchQuery.value = ''
    quickActiveIndex.value = 0
    void updateQuickConnectDropdownPosition()
    await nextTick()
    quickSearchInputRef.value?.focus()
    return
  }
  quickConnectDropdownStyle.value = {}
  quickSearchQuery.value = ''
  quickActiveIndex.value = 0
})

watch(quickConnectList, (list) => {
  if (quickActiveIndex.value >= list.length) {
    quickActiveIndex.value = Math.max(0, list.length - 1)
  }
  if (showQuickConnect.value) {
    void updateQuickConnectDropdownPosition()
  }
})

watch(
  () => props.recentConnections.length,
  () => {
    if (showQuickConnect.value) {
      void updateQuickConnectDropdownPosition()
    }
  },
)

onMounted(() => {
  window.addEventListener('resize', handleViewportChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleViewportChange)
})
</script>

<template>
  <div class="tab-bar">
    <!-- 连接管理入口：宽度与下方 LeftToolbar 对齐，共用右侧竖线 -->
    <div class="home-zone">
      <el-tooltip
        :content="t('connections.connectionManage')"
        placement="bottom"
        :show-after="300"
      >
        <button
          type="button"
          class="home-btn"
          :class="{ active: homeActive }"
          :aria-label="t('connections.connectionManage')"
          :aria-pressed="homeActive"
          @click="emit('select-home')"
        >
          <AppIcon name="home-grid" size="md" />
        </button>
      </el-tooltip>
    </div>

    <ScrollableTabs class="tabs-wrap" :active-key="activeHostTabKey">
      <template
        v-for="item in displayHostTabs"
        :key="item.kind === 'split'
          ? `split-${item.primary.connectionId}-${item.secondary.connectionId}`
          : item.item.connectionId"
      >
        <div
          v-if="item.kind === 'split'"
          class="tab host-split-tab"
          :class="{ active: !homeActive && splitGroupActive }"
          :data-active-tab="!homeActive && splitGroupActive"
          :title="t('terminal.restoreSplit')"
          @click="emit('select-split')"
        >
          <AppIcon :name="splitMode === 'horizontal' ? 'split-h' : 'split-v'" size="xs" class="host-split-icon" />
          <span class="tab-name">{{ item.primary.connectionName }}</span>
          <span class="host-split-divider">|</span>
          <span class="tab-name">{{ item.secondary.connectionName }}</span>
          <AppIcon v-if="splitHostHasStatus(backgroundJobSessions, item.primary, item.secondary)" name="background-tasks" size="sm" :title="t('ai.backgroundRunningHint')" style="color: var(--accent); flex-shrink: 0" />
          <span
            v-if="splitHostHasStatus(disconnectedSessionIds, item.primary, item.secondary)"
            class="tab-disconnected"
          >{{ t('terminal.tabDisconnected') }}</span>
          <span
            v-else-if="splitHostHasStatus(aiApprovalSessions, item.primary, item.secondary)"
            class="tab-approval-dot"
            :title="t('ai.approvalHintAction')"
          ></span>
          <span
            v-else-if="splitHostHasStatus(unreadSessions, item.primary, item.secondary)"
            class="tab-unread-dot"
          ></span>
          <button
            class="tab-close"
            :title="t('terminal.exitSplit')"
            :aria-label="t('terminal.exitSplit')"
            @click.stop="emit('close-split')"
          >
            <AppIcon name="close" size="xs" />
          </button>
        </div>
        <div
          v-else
          class="tab"
          :data-active-tab="!homeActive && item.item.connectionId === activeGroupId"
          :class="{
            active: !homeActive && item.item.connectionId === activeGroupId,
            dragging: draggedConnectionId === item.item.connectionId,
            'drop-target': hoveredDropConnectionId === item.item.connectionId,
          }"
          :data-host-drop-id="item.item.connectionId"
          :title="groups.length >= 2
            ? t('terminal.dragHostSplitTitle')
            : undefined"
          @mousedown="onHostTabDragStart($event, item.item)"
          @click="onHostTabClick(item.item.connectionId)"
        >
          <div class="tab-indicator" :class="{ down: isGroupDisconnected(item.item) }"></div>
          <span class="tab-name">{{ item.item.connectionName }}</span>
          <AppIcon v-if="item.item.sessions.some(session => backgroundJobSessions.has(session.id))" name="background-tasks" size="sm" :title="t('ai.backgroundRunningHint')" style="color: var(--accent); flex-shrink: 0" />
          <span
            v-if="aiApprovalSessions && item.item.connectionId !== activeGroupId && hasGroupAiApproval(item.item)"
            class="tab-approval-dot"
            :title="t('ai.approvalHintAction')"
          ></span>
          <span
            v-else-if="unreadSessions && item.item.connectionId !== activeGroupId && hasGroupUnread(item.item)"
            class="tab-unread-dot"
          ></span>
          <span v-if="item.item.sessions.length > 1" class="tab-count">{{ item.item.sessions.length }}</span>
          <!-- With one terminal the sub-tab row is hidden; adding a terminal lives on the host tab. -->
          <button
            v-else-if="!homeActive && item.item.connectionId === activeGroupId && item.item.sessions.length === 1"
            type="button"
            class="tab-add-session"
            :title="t('terminal.newWindow')"
            :aria-label="t('terminal.newWindow')"
            @mousedown.stop
            @click.stop="emit('add-session', item.item.connectionId)"
          >
            <AppIcon name="plus" size="xs" />
          </button>
          <span
            v-if="isGroupDisconnected(item.item)"
            class="tab-disconnected"
          >{{ t('terminal.tabDisconnected') }}</span>
          <span
            v-else-if="latencyEnabled && latencyMap && latencyMap[item.item.connectionId] !== undefined"
            class="tab-latency"
            :style="{ color: latencyColor(latencyMap[item.item.connectionId]) }"
          >{{ formatLatency(latencyMap[item.item.connectionId]) }}</span>
          <button class="tab-close" @mousedown.stop @click.stop="emit('close', item.item.connectionId)">
            <AppIcon name="close" size="xs" />
          </button>
        </div>
      </template>

    </ScrollableTabs>

    <!-- + 移出 tabs-scroll，避免 overflow-x:auto 裁切下拉框 -->
    <div
      v-if="groups.length > 0"
      ref="quickConnectWrapperRef"
      class="quick-connect-wrapper"
    >
      <button
        ref="quickConnectButtonRef"
        class="tab-add-btn"
        type="button"
        data-onboarding="quick-connect"
        :class="{ active: showQuickConnect }"
        :title="t('connections.connectAnother')"
        :aria-label="t('connections.connectAnother')"
        @click.stop="toggleQuickConnect"
      >
        <AppIcon name="plus" size="sm" />
      </button>
    </div>

    <div class="spacer"></div>

    <div class="tab-right-actions">
      <!-- 无会话时：+ 放右侧，避免顶栏左侧空荡荡只剩一个加号 -->
      <div
        v-if="groups.length === 0"
        ref="quickConnectWrapperRef"
        class="quick-connect-wrapper trailing"
      >
        <button
          ref="quickConnectButtonRef"
          class="toolbar-btn ui-icon-btn"
          type="button"
          data-onboarding="quick-connect"
          :class="{ active: showQuickConnect }"
          :title="t('connections.quickConnect')"
          :aria-label="t('connections.quickConnect')"
          @click.stop="toggleQuickConnect"
        >
          <AppIcon name="plus" size="md" />
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="showQuickConnect"
        ref="quickConnectDropdownRef"
        class="quick-connect-dropdown"
        :class="{ 'dropdown-end': groups.length === 0 }"
        :style="quickConnectDropdownStyle"
        @click.stop
      >
        <div class="quick-connect-search">
          <AppIcon name="search" size="sm" class="quick-connect-search-icon" />
          <input
            ref="quickSearchInputRef"
            v-model="quickSearchQuery"
            type="text"
            class="quick-connect-search-input"
            :placeholder="t('connections.searchNameHostTag')"
            :aria-label="t('connections.searchAria')"
            @keydown="onQuickSearchKeydown"
          />
        </div>
        <div class="quick-connect-title">{{ quickConnectTitle }}</div>
        <button
          v-for="(connection, index) in quickConnectList"
          :key="connection.id"
          type="button"
          class="recent-connection-item"
          :class="{ active: index === quickActiveIndex }"
          @mouseenter="quickActiveIndex = index"
          @click="pickQuickConnect(connection.id)"
        >
          <span class="recent-connection-name">{{ connection.name }}</span>
          <span class="recent-connection-meta">{{ connection.username }}@{{ connection.host }}:{{ connection.port }}</span>
        </button>
        <div v-if="quickConnectList.length === 0" class="quick-connect-empty">
          {{ quickSearchQuery.trim() ? t('connections.noMatch') : t('connections.noRecent') }}
        </div>
        <button
          type="button"
          class="quick-connect-manage ui-btn ui-btn-sm"
          @click="showQuickConnect = false; emit('select-home')"
        >
          {{ t('connections.openConnectionList') }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tab-bar {
  height: var(--tab-height);
  min-height: var(--tab-height);
  max-height: var(--tab-height);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  padding-right: 12px;
  overflow: hidden;
  transition: background-color 0.3s, border-color 0.3s;
  -webkit-app-region: no-drag;
}

/* Matches LeftToolbar width so the shared vertical border lines up */
.home-zone {
  width: var(--left-toolbar-width, 40px);
  min-width: var(--left-toolbar-width, 40px);
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
  box-sizing: border-box;
}

.home-btn {
  width: var(--icon-btn-sm);
  height: var(--icon-btn-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: var(--radius-tab);
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}

.home-btn:hover {
  background: var(--tab-hover-surface);
  color: var(--text-primary);
}

.home-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.home-btn.active {
  color: var(--text-primary);
  background: var(--tab-selected-surface);
}

.spacer {
  flex: 1;
  height: 100%;
  min-width: 0;
  -webkit-app-region: drag;
}

.tabs-wrap {
  flex: 0 1 auto;
  --tabs-track-padding: 4px;
  --tabs-track-gap: 3px;
}

.tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  height: calc(100% - 8px);
  border: 1px solid transparent;
  border-radius: var(--radius-tab);
  cursor: pointer;
  white-space: nowrap;
  font-size: var(--font-ui-sm);
  color: var(--text-secondary);
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  user-select: none;
  position: relative;
  flex-shrink: 0;
  background: transparent;
}

.tab:hover {
  background: var(--tab-hover-surface);
  color: var(--text-primary);
}

.tab.active {
  background: var(--tab-selected-surface);
  color: var(--text-primary);
  border-color: var(--tab-selected-edge);
  box-shadow: var(--tab-selected-shadow);
}

.tab.dragging {
  cursor: grabbing;
  opacity: 0.72;
}

.tab.drop-target {
  color: var(--accent);
  background: var(--accent-bg);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.host-split-tab {
  gap: 6px;
  border-color: color-mix(in srgb, var(--accent) 26%, transparent);
}

.host-split-tab.active {
  border-color: var(--tab-selected-edge);
}

.host-split-icon {
  flex-shrink: 0;
}

.host-split-divider {
  color: var(--border-color);
}

.tab-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
}

.tab-indicator.down {
  background: var(--danger);
}

.tab-disconnected {
  font-size: 10px;
  font-weight: 600;
  color: var(--danger);
  margin-left: 2px;
}

.tab-name {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}

.tab-count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary) 10%, transparent);
  color: var(--text-secondary);
  font-size: var(--font-caption);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tab-add-session {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.tab-add-session:hover {
  color: var(--text-primary);
  background: var(--tab-hover-surface);
}
.tab-unread-dot,
.tab-approval-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--danger);
  flex-shrink: 0;
  box-shadow: 0 0 0 2px var(--bg-secondary);
  animation: tab-unread-pulse 1.6s ease-in-out infinite;
}

.tab-approval-dot {
  background: var(--warning);
}

.tab.active .tab-unread-dot {
  box-shadow: 0 0 0 2px var(--bg-primary);
}

@keyframes tab-unread-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.tab-latency {
  font-size: var(--font-caption);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  opacity: 0.85;
  margin-left: 2px;
}

.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  transition: all 0.15s;
  opacity: 0.5;
}

.tab:hover .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: var(--tab-hover-surface);
  color: var(--text-primary);
}

.tab-add-btn {
  width: var(--icon-btn-sm);
  height: calc(100% - 8px);
  border-radius: var(--radius-tab);
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.tab-add-btn:hover {
  color: var(--text-primary);
  background: var(--tab-hover-surface);
}

.tab-add-btn.active {
  color: var(--text-primary);
  background: var(--tab-selected-surface);
}

.quick-connect-wrapper {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.quick-connect-wrapper.trailing {
  height: auto;
}

.tab-right-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  padding-left: 8px;
  padding-right: 4px;
  height: 100%;
  position: relative;
}

.tab-right-actions:not(:empty) {
  border-left: 1px solid var(--border-color);
}

.settings-wrapper {
  position: relative;
}

.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.settings-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 10001;
}

.quick-connect-dropdown {
  position: fixed;
  z-index: 10000;
  width: 320px;
  max-width: calc(100vw - 16px);
  padding: 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  box-shadow: var(--shadow-menu);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.quick-connect-search {
  position: relative;
  margin-bottom: 6px;
}

.quick-connect-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-secondary);
  font-size: 14px;
  pointer-events: none;
}

.quick-connect-search-input {
  width: 100%;
  padding: 8px 10px 8px 32px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
}

.quick-connect-search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-bg);
}

.quick-connect-search-input::placeholder {
  color: var(--text-secondary);
}

.quick-connect-title {
  padding: 4px 6px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.recent-connection-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}

.recent-connection-item:hover,
.recent-connection-item.active {
  background: var(--hover-bg);
}

.recent-connection-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.recent-connection-meta {
  font-size: 11px;
  color: var(--text-secondary);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
}

.quick-connect-empty {
  padding: 12px 10px;
  color: var(--text-secondary);
  font-size: 12px;
}

.quick-connect-manage {
  width: 100%;
  margin-top: 6px;
}
</style>
