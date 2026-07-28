import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, type Ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { Connection, Group } from '../env.d.ts'
import { CONNECTION_COLOR_TAGS } from '../utils/connectionTags'
import { appConfirm, appPrompt } from './useAppDialog'
import { t } from '../i18n'

export const UNGROUPED_ID = '__ungrouped__'

export function useConnectionList(options: {
  initialData?: Ref<{
    connections: Connection[]
    groups: Group[]
  } | null | undefined>
  initialDataPending?: Ref<boolean | undefined>
  pageRootRef: Ref<HTMLElement | null>
  getSearchInput: () => HTMLInputElement | null
  isModalOpen: () => boolean
  onConnect: (connectionId: string) => void
}) {
  const connections = ref<Connection[]>([])
  const groups = ref<Group[]>([])
  const activeGroupId = ref<string | null>(null)
  const searchQuery = ref('')
  /** Filter by color tag id; empty = all */
  const colorTagFilter = ref('')
  /** List sort: manual (order field), recent (lastConnectedAt), frequent (useCount) */
  const sortMode = ref<'manual' | 'recent' | 'frequent'>('manual')
  const importing = ref(false)
  const initialized = ref(false)
  const listKeyboardIndex = ref(-1)

  const dragConnId = ref<string | null>(null)
  const dropInsertIndex = ref<number | null>(null)

  const connectionCounts = computed(() => {
    const counts: Record<string, number> = {}
    counts[UNGROUPED_ID] = 0
    for (const g of groups.value) {
      counts[g.id] = 0
    }
    for (const conn of connections.value) {
      if (conn.group && counts[conn.group] !== undefined) {
        counts[conn.group]++
      } else if (!conn.group) {
        counts[UNGROUPED_ID]++
      } else {
        counts[UNGROUPED_ID]++
      }
    }
    return counts
  })

  const activeGroupName = computed(() => {
    if (activeGroupId.value === UNGROUPED_ID) return t('connections.ungrouped')
    const g = groups.value.find((item) => item.id === activeGroupId.value)
    return g?.name || t('connections.allConnections')
  })

  const filteredConnections = computed(() => {
    let list = connections.value

    if (activeGroupId.value === UNGROUPED_ID) {
      list = list.filter((c) => !c.group)
    } else if (activeGroupId.value) {
      list = list.filter((c) => c.group === activeGroupId.value)
    }

    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter((c) => {
        const tag = c.colorTag || ''
        const tagLabel = CONNECTION_COLOR_TAGS.find((t) => t.id === tag)?.label || ''
        return (
          c.name.toLowerCase().includes(q) ||
          c.host.toLowerCase().includes(q) ||
          c.username.toLowerCase().includes(q) ||
          (c.note || '').toLowerCase().includes(q) ||
          tag.toLowerCase().includes(q) ||
          tagLabel.toLowerCase().includes(q)
        )
      })
    }

    if (colorTagFilter.value) {
      list = list.filter((c) => (c.colorTag || '') === colorTagFilter.value)
    }

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

  /** Drag-reorder only when manual sort and no filters that reshuffle the list */
  const isSearching = computed(
    () => searchQuery.value.trim().length > 0 || sortMode.value !== 'manual',
  )

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
      activeGroupId.value = UNGROUPED_ID
    }
  }

  function onSelectGroup(groupId: string) {
    activeGroupId.value = groupId
  }

  async function onAddGroup() {
    try {
      const value = await appPrompt({
        title: t('connections.newGroup'),
        message: t('connections.newGroupMessage'),
        confirmText: t('connections.create'),
        inputPlaceholder: t('connections.groupNamePlaceholder'),
        requiredMessage: t('connections.groupNameRequired'),
      })
      const saved = await window.LiteConnect.saveGroup({ name: value })
      await loadData()
      activeGroupId.value = saved.id
    } catch {}
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
      if (activeGroupId.value === groupId) {
        selectInitialGroup()
      }
    } catch {}
  }

  async function onSetDefault(groupId: string | null) {
    await window.LiteConnect.setDefaultGroup(groupId)
    await loadData()
  }

  async function onReorderGroups(orderedIds: string[]) {
    await window.LiteConnect.reorderGroups(orderedIds)
    await loadData()
  }

  async function onMoveConnection(connectionId: string, groupId: string | null) {
    await window.LiteConnect.updateConnectionGroup(connectionId, groupId || undefined)
    ElMessage.success(t('connections.moved'))
    await loadData()
  }

  function onConnDragStart(connectionId: string) {
    dragConnId.value = connectionId
  }

  function onConnDragEnd() {
    dragConnId.value = null
    dropInsertIndex.value = null
  }

  function onConnRowDragOver(e: DragEvent, index: number) {
    if (!dragConnId.value) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'

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
    const connId =
      dragConnId.value ||
      e.dataTransfer?.getData('application/x-lite-connect-conn') ||
      e.dataTransfer?.getData('application/x-lite-ssh-conn') ||
      ''
    const insertAt = dropInsertIndex.value
    dragConnId.value = null
    dropInsertIndex.value = null
    if (!connId || insertAt === null) return

    // Filtered views would only reshuffle the subset — keep order edits scoped & clear
    if (isSearching.value || colorTagFilter.value) {
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
      const ok = await window.LiteConnect.exportConnections()
      if (ok) ElMessage.success(t('connections.exported'))
    } catch (err: any) {
      ElMessage.error(err.message || t('connections.exportFailed'))
    }
  }

  async function handleImport() {
    importing.value = true
    try {
      const result = await window.LiteConnect.importConnections()
      if (result) {
        ElMessage.success(t('connections.imported', { imported: result.imported, total: result.total }))
        await loadData()
        if (activeGroupId.value && !groups.value.some((group) => group.id === activeGroupId.value) && activeGroupId.value !== UNGROUPED_ID) {
          selectInitialGroup()
        }
      }
    } catch (err: any) {
      ElMessage.error(err.message || t('connections.importFailed'))
    } finally {
      importing.value = false
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
      const el = document.querySelector(`[data-conn-index="${index}"]`) as HTMLElement | null
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
    if (options.isModalOpen()) return

    const searchInput = options.getSearchInput()

    // `/` 聚焦搜索（非输入框时）
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      focusSearchInput()
      return
    }

    const inSearch = e.target === searchInput
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
      if (listKeyboardIndex.value < 0) return
      const conn = filteredConnections.value[listKeyboardIndex.value]
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

  watch(activeGroupId, () => {
    listKeyboardIndex.value = -1
  })

  onMounted(() => {
    document.addEventListener('keydown', onListKeydown)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onListKeydown)
  })

  return {
    connections,
    groups,
    activeGroupId,
    searchQuery,
    colorTagFilter,
    sortMode,
    importing,
    listKeyboardIndex,
    dragConnId,
    dropInsertIndex,
    connectionCounts,
    activeGroupName,
    filteredConnections,
    isSearching,
    loadData,
    selectInitialGroup,
    onSelectGroup,
    onAddGroup,
    onRenameGroup,
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
