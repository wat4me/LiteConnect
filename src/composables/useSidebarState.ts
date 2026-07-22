import { ref, watch, onBeforeUnmount, type Ref, type ComputedRef } from 'vue'
import type { ConnectionGroup, Session } from './useSessionManager'

const SIDEBAR_WIDTH_KEY = 'liteconnect-sftp-sidebar-width'
const SIDEBAR_MIN_WIDTH = 280
const SIDEBAR_MAX_WIDTH = 600
const SIDEBAR_DEFAULT_WIDTH = 330

function getInitialSidebarWidth(): number {
  try {
    const stored = Number(globalThis.localStorage?.getItem(SIDEBAR_WIDTH_KEY))
    if (Number.isFinite(stored) && stored > 0) {
      return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, stored))
    }
  } catch {
    // Storage can be unavailable in restricted renderer contexts.
  }
  return SIDEBAR_DEFAULT_WIDTH
}

export interface SessionDeps {
  groups: Ref<ConnectionGroup[]>
  activeGroupId: Ref<string>
  activeSessionId: ComputedRef<string | null>
  HOME_ID: string
  getGroupByConnectionId: (connectionId: string | null) => ConnectionGroup | null
  getLastSessionId: (group: ConnectionGroup | null) => string | null
}

export function useSidebarState(deps: SessionDeps) {
  const sidebarVisible = ref(false)
  const aiSidebarVisible = ref(false)
  const sidebarWidth = ref(getInitialSidebarWidth())
  const monitorWidth = ref(280)
  const monitorVisible = ref(false)
  const monitorEnabled = ref(true)
  const sidebarSessionId = ref<string | null>(null)
  const sidebarGroupId = ref<string | null>(null)
  const aiSelectionRequest = ref<{
    id: number
    sessionId: string
    text: string
    mode: 'send' | 'insert'
  } | null>(null)

  const connectionsViewRef = ref<any>(null)
  const fileSidebarRef = ref<any>(null)

  let resizing = false
  let resizeStartX = 0
  let resizeStartWidth = 0
  let resizingRight = false
  let resizeStartXRight = 0
  let resizeStartWidthRight = 0

  function setSidebarTarget(groupId: string | null, sessionId: string | null) {
    sidebarGroupId.value = groupId
    sidebarSessionId.value = sessionId
  }

  function syncSidebarState() {
    if (deps.groups.value.length === 0) {
      setSidebarTarget(null, null)
      sidebarVisible.value = false
      aiSidebarVisible.value = false
      return
    }

    const sidebarGroup = deps.getGroupByConnectionId(sidebarGroupId.value)
    if (sidebarGroup) {
      const sessionExists = sidebarSessionId.value
        ? sidebarGroup.sessions.some((session: Session) => session.id === sidebarSessionId.value)
        : false

      if (!sessionExists) {
        sidebarSessionId.value =
          sidebarGroup.activeSessionId || deps.getLastSessionId(sidebarGroup)
      }
      return
    }

    if (deps.activeGroupId.value !== deps.HOME_ID) {
      const group = deps.getGroupByConnectionId(deps.activeGroupId.value)
      if (group) {
        setSidebarTarget(
          group.connectionId,
          group.activeSessionId || deps.getLastSessionId(group),
        )
        return
      }
    }

    setSidebarTarget(null, null)
  }

  function toggleSidebar() {
    sidebarVisible.value = !sidebarVisible.value
    if (sidebarVisible.value) aiSidebarVisible.value = false
  }

  function toggleAiSidebar() {
    aiSidebarVisible.value = !aiSidebarVisible.value
    if (aiSidebarVisible.value) sidebarVisible.value = false
  }

  function toggleMonitor() {
    monitorVisible.value = !monitorVisible.value
  }

  function onResizeMove(e: MouseEvent) {
    if (resizing) {
      const diff = e.clientX - resizeStartX
      const newWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, resizeStartWidth + diff))
      sidebarWidth.value = newWidth
    }
    if (resizingRight) {
      const diff = resizeStartXRight - e.clientX
      const newWidth = Math.max(200, Math.min(500, resizeStartWidthRight + diff))
      monitorWidth.value = newWidth
    }
  }

  function onResizeUp() {
    resizing = false
    resizingRight = false
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  function startResize(e: MouseEvent) {
    resizing = true
    resizeStartX = e.clientX
    resizeStartWidth = sidebarWidth.value
    document.addEventListener('mousemove', onResizeMove)
    document.addEventListener('mouseup', onResizeUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function startResizeRight(e: MouseEvent) {
    resizingRight = true
    resizeStartXRight = e.clientX
    resizeStartWidthRight = monitorWidth.value
    document.addEventListener('mousemove', onResizeMove)
    document.addEventListener('mouseup', onResizeUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  onBeforeUnmount(() => {
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeUp)
  })

  watch(
    [deps.activeGroupId, deps.activeSessionId],
    ([newGroupId, newSessionId]) => {
      if (newGroupId === deps.HOME_ID) {
        connectionsViewRef.value?.loadData()
        return
      }

      if (!newGroupId) return

      const group = deps.getGroupByConnectionId(newGroupId)
      if (!group) return

      const targetSessionId =
        newSessionId || group.activeSessionId || deps.getLastSessionId(group)
      if (!targetSessionId) return

      setSidebarTarget(newGroupId as string, targetSessionId)
    },
    { immediate: true },
  )

  watch(sidebarWidth, (width) => {
    try {
      globalThis.localStorage?.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(width)))
    } catch {
      // Keep resizing functional even when storage is unavailable.
    }
  })

  let aiSelectionId = 0

  function handleAiSelection(text: string, mode: 'send' | 'insert') {
    aiSelectionRequest.value = {
      id: ++aiSelectionId,
      sessionId: deps.activeSessionId.value || '',
      text,
      mode,
    }
    aiSidebarVisible.value = true
    sidebarVisible.value = false
  }

  function handleAiSelectionConsumed(_id: number) {
    aiSelectionRequest.value = null
  }

  function handleMonitorSettingsChange(e: Event) {
    const detail = (e as CustomEvent).detail
    if (detail && detail.enabled !== undefined) {
      monitorEnabled.value = detail.enabled
    }
  }

  return {
    sidebarVisible,
    aiSidebarVisible,
    sidebarWidth,
    monitorWidth,
    monitorVisible,
    monitorEnabled,
    sidebarSessionId,
    sidebarGroupId,
    aiSelectionRequest,
    connectionsViewRef,
    fileSidebarRef,
    toggleSidebar,
    toggleAiSidebar,
    toggleMonitor,
    setSidebarTarget,
    syncSidebarState,
    startResize,
    startResizeRight,
    onResizeMove,
    onResizeUp,
    handleAiSelection,
    handleAiSelectionConsumed,
    handleMonitorSettingsChange,
  }
}
