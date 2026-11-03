import { ref, watch, type Ref, type ComputedRef } from 'vue'
import type { WorkspacePanel } from '@shared/workspaceLayout'
import type { ConnectionGroup, Session } from '@/domain/session/types'

export interface SessionDeps {
  canShowAlongside?: (a: WorkspacePanel, b: WorkspacePanel) => boolean
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
    if (sidebarVisible.value && !deps.canShowAlongside?.('files', 'ai')) aiSidebarVisible.value = false
  }

  function toggleAiSidebar() {
    aiSidebarVisible.value = !aiSidebarVisible.value
    if (aiSidebarVisible.value) {
      if (!deps.canShowAlongside?.('ai', 'files')) sidebarVisible.value = false
    }
  }

  function toggleMonitor() {
    monitorVisible.value = !monitorVisible.value
  }

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

  let aiSelectionId = 0

  function handleAiSelection(text: string, mode: 'send' | 'insert') {
    aiSelectionRequest.value = {
      id: ++aiSelectionId,
      sessionId: deps.activeSessionId.value || '',
      text,
      mode,
    }
    aiSidebarVisible.value = true
    if (!deps.canShowAlongside?.('ai', 'files')) sidebarVisible.value = false
  }

  function handleAiSelectionConsumed(_id: number) {
    aiSelectionRequest.value = null
  }

  function handleMonitorSettingsChange(e: Event) {
    const detail = (e as CustomEvent).detail
    if (detail && detail.enabled !== undefined) {
      monitorEnabled.value = detail.enabled
      if (!detail.enabled) monitorVisible.value = false
    }
  }

  return {
    sidebarVisible,
    aiSidebarVisible,
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
    handleAiSelection,
    handleAiSelectionConsumed,
    handleMonitorSettingsChange,
  }
}
