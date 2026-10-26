import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, type Ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { Connection, Group } from '@/env.d.ts'
import { CONNECTION_COLOR_TAGS } from '@/utils/connections/connectionTags'
import { appConfirm, appPrompt } from '@/composables/app/useAppDialog'
import { createDragAutoScroll } from '@/utils/shared/dragAutoScroll'
import {
  dataTransferHasConn,
  getDataTransferConnId,
} from '@/utils/shared/legacyStorageMigrate'
import { t } from '@/i18n'
import type { ConnectionSortMode } from '@shared/connectionSort'
import { buildGroupTree } from '@shared/groupTree'

/** Virtual sidebar layers (not persisted groups). */
export type ConnectionSmartView = 'pinned' | 'recent' | `tag:${string}`

export const CONNECTION_RECENT_VIEW_LIMIT = 24

export function useConnectionList(options: {
  initialData?: Ref<{
    connections: Connection[]
    groups: Group[]
  } | null | undefined>
  initialDataPending?: Ref<boolean | undefined>
  pageRootRef: Ref<HTMLElement | null>
  /** Scrollable main connection list (for drag auto-scroll) */
  connectionsListRef?: Ref<HTMLElement | null>
  getSearchInput: () => HTMLInputElement | null
  isModalOpen: () => boolean
  onConnect: (connectionId: string) => void
}) {
  const connections = ref<Connection[]>([])
  const groups = ref<Group[]>([])
  const groupTree = computed(() => buildGroupTree(groups.value))
  const activeGroupId = ref<string | null>(null)
  /** Smart/virtual view; when set, list ignores current-group scope. */
  const smartView = ref<ConnectionSmartView | null>(null)
  const searchQuery = ref('')
  const searchScope = ref<'group' | 'all'>('group')
  /** Filter by color tag id; empty = all */
  const colorTagFilter = ref('')
  /** List sort: manual (order field), recent (lastConnectedAt), frequent (useCount) */
  const sortMode = ref<ConnectionSortMode>('manual')
  const importing = ref(false)
  const initialized = ref(false)
  const listKeyboardIndex = ref(-1)

  const dragConnId = ref<string | null>(null)
  const dropInsertIndex = ref<number | null>(null)
  const listDragAutoScroll = createDragAutoScroll()

  const connectionCounts = computed(() => {
    const counts: Record<string, number> = {}
    for (const g of groups.value) {
      counts[g.id] = 0
    }
    const fallback = groups.value.find((g) => g.isDefault)?.id || groups.value[0]?.id
    for (const conn of connections.value) {
      const groupId = conn.group && counts[conn.group] !== undefined ? conn.group : fallback
      if (groupId) {
        counts[groupId]++
        for (const ancestor of groupTree.value.getAncestors(groupId)) counts[ancestor.id]++
      }
    }
    return counts
  })

  const inSmartView = computed(() => smartView.value != null)

  const activeGroupName = computed(() => {
    const view = smartView.value
    if (view === 'pinned') return t('connections.smartPinned')
    if (view === 'recent') return t('connections.smartRecent')
    if (view?.startsWith('tag:')) {
      const tagId = view.slice(4)
      return CONNECTION_COLOR_TAGS.find((tag) => tag.id === tagId)?.label || t('connections.colorTag')
    }
    if (searchScope.value === 'all') return t('connections.allConnections')
    return groupTree.value.getPath(activeGroupId.value || '') || t('connections.allConnections')
  })

  function connectionMatchesQuery(c: Connection, q: string): boolean {
    const tag = c.colorTag || ''
    const tagLabel = CONNECTION_COLOR_TAGS.find((item) => item.id === tag)?.label || ''
    const groupName = groupTree.value.getPath(c.group || '')
    return (
      c.name.toLowerCase().includes(q) ||
      c.host.toLowerCase().includes(q) ||
      c.username.toLowerCase().includes(q) ||
      (c.note || '').toLowerCase().includes(q) ||
      tag.toLowerCase().includes(q) ||
      tagLabel.toLowerCase().includes(q) ||
      groupName.toLowerCase().includes(q)
    )
  }

  const smartViewCounts = computed(() => {
    const pinned = connections.value.filter((c) => c.pinned === true).length
    const recent = connections.value
      .filter((c) => (c.lastConnectedAt || 0) > 0)
      .length
    const tags: Record<string, number> = {}
    for (const tag of CONNECTION_COLOR_TAGS) {
      if (!tag.id) continue
      tags[tag.id] = connections.value.filter((c) => (c.colorTag || '') === tag.id).length
    }
    return {
      pinned,
      recent: Math.min(recent, CONNECTION_RECENT_VIEW_LIMIT),
      tags,
    }
  })

  const usedColorTags = computed(() =>
    CONNECTION_COLOR_TAGS.filter((tag) => tag.id && (smartViewCounts.value.tags[tag.id] || 0) > 0),
  )

  const filteredConnections = computed(() => {
    let list = connections.value
    const view = smartView.value

    if (view === 'pinned') {
      list = list.filter((c) => c.pinned === true)
    } else if (view === 'recent') {
      list = [...list]
        .filter((c) => (c.lastConnectedAt || 0) > 0)
        .sort((a, b) => (b.lastConnectedAt || 0) - (a.lastConnectedAt || 0))
        .slice(0, CONNECTION_RECENT_VIEW_LIMIT)
    } else if (view?.startsWith('tag:')) {
      const tagId = view.slice(4)
      list = list.filter((c) => (c.colorTag || '') === tagId)
    } else if (searchScope.value === 'group' && activeGroupId.value) {
      const groupIds = groupTree.value.getSubtreeIds(activeGroupId.value)
      list = list.filter((c) => groupIds.has(c.group || ''))
    }

    if (searchQuery.value.trim()) {
      const q = searchQuery.value.trim().toLowerCase()
      list = list.filter((c) => connectionMatchesQuery(c, q))
    }

    if (colorTagFilter.value && !view?.startsWith('tag:')) {
      list = list.filter((c) => (c.colorTag || '') === colorTagFilter.value)
    }

    // Recent smart view already ordered by lastConnectedAt; keep that order.
    if (view === 'recent') return list

    // Always keep pinned on top; secondary order by sortMode
    const sorted = [...list].sort((a, b) => {
      const ap = a.pinned === true ? 1 : 0
      const bp = b.pinned === true ? 1 : 0
      if (ap !== bp) return bp - ap
      if (sortMode.value === 'recent') {
        return (b.lastConnectedAt || 0) - (a.lastConnectedAt || 0)
      }
      if (sortMode.value === 'frequent') {
        const bu = b.useCount || 0
        const au = a.useCount || 0
        if (bu !== au) return bu - au
        return (b.lastConnectedAt || 0) - (a.lastConnectedAt || 0)
      }
      // manual: preserve store order (already sorted by order field from getConnections)
      const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER
      const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER
      if (ao !== bo) return ao - bo
      return (a.createdAt || 0) - (b.createdAt || 0)
    })
    return sorted
  })

  /** Matches in other groups when current group search is empty (for expand hint). */
  const crossGroupSearchHits = computed(() => {
    if (smartView.value) return 0
    if (searchScope.value !== 'group' || !activeGroupId.value) return 0
    const q = searchQuery.value.trim().toLowerCase()
    if (!q) return 0
    const groupIds = groupTree.value.getSubtreeIds(activeGroupId.value)
    return connections.value.filter(
      (c) => !groupIds.has(c.group || '') && connectionMatchesQuery(c, q),
    ).length
  })

  const groupConnectionTotal = computed(() => {
    if (smartView.value === 'pinned') return smartViewCounts.value.pinned
    if (smartView.value === 'recent') return smartViewCounts.value.recent
    if (smartView.value?.startsWith('tag:')) {
      return smartViewCounts.value.tags[smartView.value.slice(4)] || 0
    }
    if (searchScope.value === 'all') return connections.value.length
    if (!activeGroupId.value) return connections.value.length
    return connectionCounts.value[activeGroupId.value] || 0
  })

  /** Drag-reorder only when manual sort and no filters that reshuffle the list */
  const isSearching = computed(
    () => searchQuery.value.trim().length > 0 || sortMode.value !== 'manual',
  )

  const reorderDisabled = computed(
    () =>
      isSearching.value ||
      !!colorTagFilter.value ||
      searchScope.value === 'all' ||
      !!smartView.value ||
      !!groupTree.value.children.get(activeGroupId.value)?.length ||
      !activeGroupId.value,
  )

  function getConnectionGroupName(connection: Connection): string {
    const groupId = resolveTargetGroupId(connection.group)
    return groupTree.value.getPath(groupId || '') || t('connections.ungrouped')
  }

  async function togglePin(connectionId: string) {
    const conn = connections.value.find((c) => c.id === connectionId)
    if (!conn) return
    try {
      const updated = await window.LiteConnect.setConnectionPinned(connectionId, !conn.pinned)
      connections.value = connections.value.map((c) =>
        c.id === connectionId ? { ...c, ...updated } : c,
      )
    } catch (err: any) {
      ElMessage.error(err?.message || t('connections.pin'))
    }
  }

  watch(
    () => [options.initialData?.value, options.initialDataPending?.value] as const,
    async ([initialData, initialDataPending]) => {
      if (initialized.value) return

      if (initialData) {
        connections.value = [...initialData.connections]
        groups.value = [...initialData.groups]
        selectInitialGroup()
        initialized.value = true
        return
      }

      if (initialDataPending) return

      await loadData()
      selectInitialGroup()
      initialized.value = true
    },
    { immediate: true },
  )

  async function loadData() {
    const [nextConnections, nextGroups] = await Promise.all([
      window.LiteConnect.getConnections(),
      window.LiteConnect.getGroups(),
    ])
    connections.value = nextConnections
    groups.value = nextGroups
  }

  function selectInitialGroup() {
    const defaultGroup = groups.value.find((g) => g.isDefault)
    if (defaultGroup) {
      activeGroupId.value = defaultGroup.id
    } else if (groups.value.length > 0) {
      activeGroupId.value = groups.value[0].id
    } else {
      activeGroupId.value = null
    }
  }

  function onSelectGroup(groupId: string) {
    activeGroupId.value = groupId
    smartView.value = null
    searchScope.value = 'group'
  }

  function onSelectSmartView(view: ConnectionSmartView) {
    smartView.value = view
    searchScope.value = 'all'
    if (view.startsWith('tag:')) colorTagFilter.value = ''
  }

  function expandSearchToAllGroups() {
    searchScope.value = 'all'
    smartView.value = null
  }

  async function onAddGroup(parentId?: string) {
    try {
      const value = await appPrompt({
        title: t(parentId ? 'groups.newSubgroup' : 'connections.newGroup'),
        message: t('connections.newGroupMessage'),
        detail: parentId ? groupTree.value.getPath(parentId) : undefined,
        confirmText: t('connections.create'),
        inputPlaceholder: t('connections.groupNamePlaceholder'),
        requiredMessage: t('connections.groupNameRequired'),
      })
      const saved = await window.LiteConnect.saveGroup({ name: value, parentId: parentId || null })
      await loadData()
      onSelectGroup(saved.id)
    } catch (err: any) {
      if (err instanceof Error) ElMessage.error(err.message || t('groups.saveFailed'))
    }
  }

  async function onRenameGroup(group: Group) {
    try {
      const value = await appPrompt({
        title: t('connections.renameGroup'),
        message: t('connections.renameGroupMessage'),
        confirmText: t('common.save'),
        inputValue: group.name,
        requiredMessage: t('connections.groupNameRequired'),
      })
      await window.LiteConnect.saveGroup({ id: group.id, name: value })
      await loadData()
    } catch {}
  }

  async function onMoveGroup(groupId: string, parentId: string | null) {
    const group = groups.value.find(item => item.id === groupId)
    if (!group || (group.parentId ?? null) === parentId) return
    if (parentId && groupTree.value.getSubtreeIds(groupId).has(parentId)) return
    try {
      await window.LiteConnect.saveGroup({ id: groupId, name: group.name, parentId })
      await loadData()
    } catch (err: any) {
      ElMessage.error(err?.message || t('groups.moveFailed'))
    }
  }

  async function onDeleteGroup(groupId: string) {
    try {
      await appConfirm({
        title: t('connections.deleteGroupTitle'),
        message: t('connections.deleteGroupMessage'),
        confirmText: t('common.delete'),
        danger: true,
        tone: 'danger',
      })
      await window.LiteConnect.deleteGroup(groupId)
      await loadData()
      if (!groups.value.some(group => group.id === activeGroupId.value)) {
        selectInitialGroup()
      }
    } catch {}
  }

  async function onSetDefault(groupId: string | null) {
    // Always keep one default group; ignore clear-all.
    if (!groupId) return
    await window.LiteConnect.setDefaultGroup(groupId)
    await loadData()
  }

  async function onReorderGroups(orderedIds: string[]) {
    await window.LiteConnect.reorderGroups(orderedIds)
    await loadData()
  }

  function resolveTargetGroupId(groupId: string | null | undefined): string | null {
    if (groupId && groups.value.some((g) => g.id === groupId)) return groupId
    return groups.value.find((g) => g.isDefault)?.id || groups.value[0]?.id || null
  }

  async function onMoveConnection(connectionId: string, groupId: string | null) {
    const conn = connections.value.find((c) => c.id === connectionId)
    if (!conn) return

    // Store maps empty / unknown → real default group (no virtual ungrouped)
    const targetGroupId = resolveTargetGroupId(groupId)
    if (!targetGroupId) return

    // Same group: no-op (avoid false "已移动" when drop lands on current group)
    if (conn.group === targetGroupId) return

    const prevGroup = conn.group
    // Optimistic UI so sidebar + main list update immediately
    connections.value = connections.value.map((c) =>
      c.id === connectionId ? { ...c, group: targetGroupId, updatedAt: Date.now() } : c,
    )

    try {
      await window.LiteConnect.updateConnectionGroup(connectionId, targetGroupId)
      ElMessage.success(t('connections.moved'))
      // Refresh from store (order / other fields); optimistic group already applied
      await loadData()
    } catch (err: any) {
      connections.value = connections.value.map((c) =>
        c.id === connectionId ? { ...c, group: prevGroup } : c,
      )
      ElMessage.error(err?.message || t('connections.reorderFailed'))
    }
  }

  function onConnDragStart(connectionId: string) {
    dragConnId.value = connectionId
    listDragAutoScroll.start(() => options.connectionsListRef?.value ?? null)
  }

  function onConnDragEnd() {
    dragConnId.value = null
    dropInsertIndex.value = null
    listDragAutoScroll.stop()
  }

  function onConnRowDragOver(e: DragEvent, index: number) {
    // dragConnId: main-list drag; dataTransfer types: cross-panel (getData empty in dragover)
    if (reorderDisabled.value) return
    if (!dragConnId.value && !dataTransferHasConn(e.dataTransfer)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    // Keep auto-scroll alive when re-entering the list mid-drag
    listDragAutoScroll.start(() => options.connectionsListRef?.value ?? null)

    // Insert marker only for in-list reorder (sidebar → list is a group move, not reorder)
    if (!dragConnId.value) return

    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    const before = e.clientY < rect.top + rect.height / 2
    dropInsertIndex.value = before ? index : index + 1
  }

  function onConnListDragLeave(e: DragEvent) {
    const related = e.relatedTarget as Node | null
    const list = e.currentTarget as HTMLElement
    if (related && list.contains(related)) return
    dropInsertIndex.value = null
  }

  async function onConnRowDrop(e: DragEvent) {
    e.preventDefault()
    const connId = dragConnId.value || getDataTransferConnId(e.dataTransfer)
    const insertAt = dropInsertIndex.value
    dragConnId.value = null
    dropInsertIndex.value = null
    listDragAutoScroll.stop()
    if (!connId || insertAt === null) return

    // Filtered views would only reshuffle the subset — keep order edits scoped & clear
    if (reorderDisabled.value) {
      ElMessage.info(t('connections.reorderDisabled'))
      return
    }

    const ids = filteredConnections.value.map((c) => c.id)
    const from = ids.indexOf(connId)
    if (from < 0) return

    // Adjust target when removing item shifts later indices
    let to = insertAt
    if (from < to) to -= 1
    if (from === to) return

    ids.splice(from, 1)
    ids.splice(to, 0, connId)

    try {
      // Partial list: store only reorders these ids within their existing global slots
      await window.LiteConnect.reorderConnections(ids)
      await loadData()
    } catch (err: any) {
      ElMessage.error(err.message || t('connections.reorderFailed'))
    }
  }

  function clearFilters() {
    searchQuery.value = ''
    colorTagFilter.value = ''
  }

  async function handleExport() {
    try {
      const action = await appConfirm({
        title: t('connections.exportIncludeSecretsTitle'),
        message: t('connections.exportIncludeSecretsMessage'),
        detail: t('connections.exportIncludeSecretsDetail'),
        confirmText: t('connections.exportWithSecrets'),
        tertiaryText: t('connections.exportWithoutSecrets'),
        cancelText: t('common.cancel'),
        tone: 'warning',
      })
      const includeSecrets = action === 'confirm'
      const ok = await window.LiteConnect.exportConnections(includeSecrets)
      if (ok) ElMessage.success(t('connections.exported'))
    } catch (err: any) {
      if (err === 'cancel') return
      ElMessage.error(err.message || t('connections.exportFailed'))
    }
  }

  async function importSshConfig() {
    importing.value = true
    try {
      const result = await window.LiteConnect.importSshConfig()
      if (result) {
        ElMessage.success(
          t('connections.importedSshConfig', {
            imported: result.imported,
            skipped: result.skipped,
            hosts: result.knownHostsImported,
          }),
        )
        await loadData()
      }
    } catch (err: any) {
      ElMessage.error(err.message || t('connections.importFailed'))
    } finally {
      importing.value = false
    }
  }

  async function importLiteConnectJson() {
    importing.value = true
    try {
      const result = await window.LiteConnect.importConnections()
      if (result) {
        ElMessage.success(t('connections.imported', { imported: result.imported, skipped: result.skipped ?? 0, total: result.total }))
        await loadData()
        if (activeGroupId.value && !groups.value.some((group) => group.id === activeGroupId.value)) {
          selectInitialGroup()
        }
      }
    } catch (err: any) {
      ElMessage.error(err.message || t('connections.importFailed'))
    } finally {
      importing.value = false
    }
  }

  async function handleImport() {
    try {
      const action = await appConfirm({
        title: t('connections.importTitle'),
        message: t('connections.importMessage'),
        detail: t('connections.importDetail'),
        confirmText: t('connections.importJson'),
        tertiaryText: t('connections.importSshConfig'),
        cancelText: t('common.cancel'),
        tone: 'info',
      })
      if (action === 'tertiary') await importSshConfig()
      else await importLiteConnectJson()
    } catch (err: any) {
      if (err === 'cancel') return
      ElMessage.error(err.message || t('connections.importFailed'))
    }
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (target.isContentEditable) return true
    return false
  }

  function focusSearchInput() {
    const el = options.getSearchInput()
    el?.focus()
    el?.select()
  }

  function scrollKeyboardRowIntoView(index: number) {
    void nextTick(() => {
      const el = options.pageRootRef.value?.querySelector(`[data-conn-index="${index}"]`) as HTMLElement | null
      el?.scrollIntoView({ block: 'nearest' })
    })
  }

  function moveListKeyboard(delta: number) {
    const len = filteredConnections.value.length
    if (len === 0) {
      listKeyboardIndex.value = -1
      return
    }
    let next = listKeyboardIndex.value
    if (next < 0) next = delta > 0 ? 0 : len - 1
    else next = (next + delta + len) % len
    listKeyboardIndex.value = next
    scrollKeyboardRowIntoView(next)
  }

  function isPageVisible(): boolean {
    const el = options.pageRootRef.value
    if (!el) return false
    return el.offsetParent !== null && el.getClientRects().length > 0
  }

  function onListKeydown(e: KeyboardEvent) {
    if (!isPageVisible()) return
    if (options.isModalOpen() || e.defaultPrevented || e.isComposing || e.keyCode === 229) return
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    const hasVisibleOverlay = Array.from(document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="menu"]',
    )).some((element) => element.getClientRects().length > 0)
    if (hasVisibleOverlay) return

    const searchInput = options.getSearchInput()

    // `/` 聚焦搜索（非输入框时）
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      focusSearchInput()
      return
    }

    const inSearch = e.target === searchInput
    const target = e.target as HTMLElement | null
    if (!inSearch && target !== document.body && (!target || !options.pageRootRef.value?.contains(target))) return
    if (!inSearch && target?.closest('button, a, [role="button"]')) return
    if (!inSearch && isTypingTarget(e.target)) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveListKeyboard(1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveListKeyboard(-1)
      return
    }
    if (e.key === 'Enter') {
      if (e.repeat) return
      const index = listKeyboardIndex.value < 0 && inSearch && searchQuery.value.trim()
        ? 0
        : listKeyboardIndex.value
      if (index < 0) return
      const conn = filteredConnections.value[index]
      if (!conn) return
      e.preventDefault()
      options.onConnect(conn.id)
      return
    }
    if (e.key === 'Escape' && inSearch) {
      if (searchQuery.value) {
        e.preventDefault()
        searchQuery.value = ''
      } else {
        searchInput?.blur()
      }
    }
  }

  watch(filteredConnections, (list) => {
    if (listKeyboardIndex.value >= list.length) {
      listKeyboardIndex.value = list.length > 0 ? list.length - 1 : -1
    }
  })

  watch([activeGroupId, smartView, searchQuery, searchScope, colorTagFilter, sortMode], () => {
    listKeyboardIndex.value = -1
  })

  function onConnectionsStoreChange() {
    if (!initialized.value) return
    void loadData()
  }

  onMounted(() => {
    document.addEventListener('keydown', onListKeydown)
    window.addEventListener('connections-store-change', onConnectionsStoreChange)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onListKeydown)
    window.removeEventListener('connections-store-change', onConnectionsStoreChange)
    listDragAutoScroll.stop()
  })

  return {
    connections,
    groups,
    activeGroupId,
    smartView,
    inSmartView,
    searchQuery,
    searchScope,
    reorderDisabled,
    getConnectionGroupName,
    colorTagFilter,
    sortMode,
    importing,
    listKeyboardIndex,
    dragConnId,
    dropInsertIndex,
    connectionCounts,
    smartViewCounts,
    usedColorTags,
    activeGroupName,
    filteredConnections,
    crossGroupSearchHits,
    groupConnectionTotal,
    isSearching,
    loadData,
    selectInitialGroup,
    onSelectGroup,
    onSelectSmartView,
    expandSearchToAllGroups,
    onAddGroup,
    onRenameGroup,
    onMoveGroup,
    onDeleteGroup,
    onSetDefault,
    onReorderGroups,
    onMoveConnection,
    onConnDragStart,
    onConnDragEnd,
    onConnRowDragOver,
    onConnListDragLeave,
    onConnRowDrop,
    togglePin,
    clearFilters,
    handleExport,
    handleImport,
  }
}
