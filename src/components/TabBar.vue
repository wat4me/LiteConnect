<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from './icons/AppIcon.vue'
import type { Connection } from '../env.d.ts'
import { CONNECTION_COLOR_TAGS } from '../utils/connectionTags'
import { useOutsideDismiss } from '../composables/useOutsideDismiss'

const { t } = useI18n()

const props = defineProps<{
  groups: { connectionId: string; connectionName: string; sessions: { id: string }[] }[]
  activeGroupId: string | null
  recentConnections: Connection[]
  /** 全量连接，供快速连接搜索 */
  connections?: Connection[]
  latencyMap: Record<string, number> | null
  latencyEnabled: boolean
  unreadSessions?: Set<string>
  /** 当前是否在连接管理页（高亮「返回连接列表」） */
  homeActive?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', connectionId: string): void
  (e: 'close', connectionId: string): void
  (e: 'select-home'): void
  (e: 'quick-connect', connectionId: string): void
}>()

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
  if (ms < 0) return '✕'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function latencyColor(ms: number): string {
  if (ms < 0) return 'var(--danger)'
  if (ms < 200) return 'var(--success)'
  if (ms < 500) return 'var(--warning)'
  return 'var(--danger)'
}

function hasGroupUnread(group: { sessions: { id: string }[] }): boolean {
  const set = props.unreadSessions
  if (!set) return false
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
    <!-- 连接管理入口常驻：连接管理页高亮，有会话时可一键返回列表 -->
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
    <div class="tab-separator" aria-hidden="true"></div>

    <div class="tabs-scroll">
      <div
        v-for="group in groups"
        :key="group.connectionId"
        class="tab"
        :class="{ active: !homeActive && group.connectionId === activeGroupId }"
        @click="emit('select', group.connectionId)"
      >
        <div class="tab-indicator"></div>
        <span class="tab-name">{{ group.connectionName }}</span>
        <span
          v-if="unreadSessions && group.connectionId !== activeGroupId && hasGroupUnread(group)"
          class="tab-unread-dot"
        ></span>
        <span v-if="group.sessions.length > 1" class="tab-count">{{ group.sessions.length }}</span>
        <span
          v-if="latencyEnabled && latencyMap && latencyMap[group.connectionId] !== undefined"
          class="tab-latency"
          :style="{ color: latencyColor(latencyMap[group.connectionId]) }"
        >{{ formatLatency(latencyMap[group.connectionId]) }}</span>
        <button class="tab-close" @click.stop="emit('close', group.connectionId)">
          <AppIcon name="close" size="xs" />
        </button>
      </div>

      <!-- 有会话时：+ 跟在标签后，表示「再开一个连接」 -->
    </div>

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
          class="toolbar-btn"
          type="button"
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
          class="quick-connect-manage"
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
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  padding-right: 12px;
  transition: background-color 0.3s, border-color 0.3s;
  -webkit-app-region: no-drag;
}

.home-btn {
  width: 34px;
  height: 28px;
  margin-left: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}

.home-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.home-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.home-btn.active {
  color: var(--accent);
  background: var(--accent-bg);
}

.spacer {
  flex: 1;
  height: 100%;
  -webkit-app-region: drag;
}

.tabs-scroll {
  display: flex;
  height: 100%;
  flex: 0 1 auto;
  overflow-x: auto;
  align-items: center;
  min-width: 0;
  padding-left: 2px;
}

.tabs-scroll::-webkit-scrollbar {
  height: 0;
}

.tab-separator {
  width: 1px;
  height: 18px;
  background: var(--border-color);
  margin: 0 4px;
  flex-shrink: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  height: 100%;
  cursor: pointer;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-secondary);
  transition: all 0.15s;
  user-select: none;
  position: relative;
  flex-shrink: 0;
}

.tab::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: transparent;
  transition: background 0.2s;
}

.tab:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.tab.active {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.tab.active::after {
  background: var(--accent);
}

.home-tab {
  gap: 6px;
  padding: 0 12px;
}

.home-tab svg {
  flex-shrink: 0;
}

.tab-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
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
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tab-unread-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--danger, #f85149);
  flex-shrink: 0;
  box-shadow: 0 0 0 2px var(--bg-secondary);
  animation: tab-unread-pulse 1.6s ease-in-out infinite;
}

@keyframes tab-unread-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.tab-latency {
  font-size: 10px;
  font-weight: 600;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
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
  background: rgba(248, 81, 73, 0.15);
  color: var(--danger);
}

.tab-add-btn {
  width: 28px;
  height: 100%;
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
  background: var(--bg-tertiary);
}

.tab-add-btn.active {
  color: var(--accent);
  background: var(--accent-bg);
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

.toolbar-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
}

.toolbar-btn:hover {
  color: var(--text-primary);
  background: var(--hover-bg);
}

.toolbar-btn.active {
  color: var(--accent);
  background: var(--accent-bg);
}

.quick-connect-wrapper {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
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
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
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
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

.quick-connect-empty {
  padding: 12px 10px;
  color: var(--text-secondary);
  font-size: 12px;
}

.quick-connect-manage {
  width: 100%;
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.quick-connect-manage:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
