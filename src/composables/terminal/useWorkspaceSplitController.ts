import { computed, watch, type ComputedRef, type Ref } from 'vue'
import type { ConnectionGroup } from '@/domain/session/types'
import type { SplitPaneAddPayload, SplitPaneSessionPayload } from '@/domain/session/types'

type CreateSession = (
  connectionId: string,
  options?: { activateWorkspace?: boolean },
) => Promise<string | null>

/** Coordinates pane-local session lifecycle on top of the shared split layout state. */
export function useWorkspaceSplitController(deps: {
  isSplit: ComputedRef<boolean>
  activeSessionId: ComputedRef<string | null>
  primarySessionId: Ref<string | null>
  secondarySessionId: Ref<string | null>
  sidebarVisible: Ref<boolean>
  aiSidebarVisible: Ref<boolean>
  getGroupBySessionId: (sessionId: string) => ConnectionGroup | null
  createSession: CreateSession
  closeSession: (sessionId: string) => Promise<void>
  setSidebarTarget: (groupId: string | null, sessionId: string | null) => void
  setPrimarySessionId: (sessionId: string | null) => void
  setSecondarySessionId: (sessionId: string | null) => void
  closeSplit: () => void
  suspendSplit: () => void
  restoreSplit: () => void
}) {
  const isCrossHostSplit = computed(() => {
    if (!deps.isSplit.value) return false
    const primaryGroup = deps.primarySessionId.value
      ? deps.getGroupBySessionId(deps.primarySessionId.value)
      : null
    const secondaryGroup = deps.secondarySessionId.value
      ? deps.getGroupBySessionId(deps.secondarySessionId.value)
      : null
    return !!primaryGroup && !!secondaryGroup && primaryGroup.connectionId !== secondaryGroup.connectionId
  })

  let sftpVisibleBeforeCrossHostSplit: boolean | null = null
  let aiVisibleBeforeSplit: boolean | null = null
  watch(deps.isSplit, (split, wasSplit) => {
    if (split && !wasSplit) {
      aiVisibleBeforeSplit = deps.aiSidebarVisible.value
      deps.aiSidebarVisible.value = false
      return
    }
    if (!split && wasSplit && aiVisibleBeforeSplit !== null) {
      deps.aiSidebarVisible.value = aiVisibleBeforeSplit
      aiVisibleBeforeSplit = null
    }
  }, { flush: 'sync' })
  watch(isCrossHostSplit, (crossHost, wasCrossHost) => {
    if (crossHost) {
      if (!wasCrossHost) sftpVisibleBeforeCrossHostSplit = deps.sidebarVisible.value
      deps.sidebarVisible.value = false
      return
    }
    if (wasCrossHost && sftpVisibleBeforeCrossHostSplit !== null) {
      deps.sidebarVisible.value = sftpVisibleBeforeCrossHostSplit
      sftpVisibleBeforeCrossHostSplit = null
    }
  }, { flush: 'sync' })

  // A counter is safe when both SSH panes create/close sessions concurrently.
  let paneMutationDepth = 0

  function currentPaneGroup(side: 'primary' | 'secondary') {
    const id = side === 'primary'
      ? deps.primarySessionId.value
      : deps.secondarySessionId.value
    return id ? deps.getGroupBySessionId(id) : null
  }

  function selectSplitPaneSession(payload: SplitPaneSessionPayload) {
    const currentGroup = currentPaneGroup(payload.side)
    const nextGroup = deps.getGroupBySessionId(payload.sessionId)
    if (!currentGroup || !nextGroup || currentGroup.connectionId !== nextGroup.connectionId) return

    if (payload.side === 'primary') {
      deps.setPrimarySessionId(payload.sessionId)
      currentGroup.activeSessionId = payload.sessionId
      deps.setSidebarTarget(currentGroup.connectionId, payload.sessionId)
    } else {
      deps.setSecondarySessionId(payload.sessionId)
      currentGroup.activeSessionId = payload.sessionId
    }
  }

  async function createSplitPaneSession(payload: SplitPaneAddPayload) {
    const group = currentPaneGroup(payload.side)
    if (!isCrossHostSplit.value || !group || group.connectionId !== payload.connectionId) return

    paneMutationDepth += 1
    try {
      const sessionId = await deps.createSession(payload.connectionId, { activateWorkspace: false })
      if (!sessionId) return
      if (payload.side === 'primary') {
        deps.setPrimarySessionId(sessionId)
        deps.setSidebarTarget(group.connectionId, sessionId)
      } else {
        deps.setSecondarySessionId(sessionId)
      }
      deps.sidebarVisible.value = false
      deps.restoreSplit()
    } finally {
      paneMutationDepth -= 1
    }
  }

  async function closeSplitPaneSession(payload: SplitPaneSessionPayload) {
    const currentId = payload.side === 'primary'
      ? deps.primarySessionId.value
      : deps.secondarySessionId.value
    if (currentId !== payload.sessionId) return
    const group = deps.getGroupBySessionId(payload.sessionId)
    if (!group) return
    const currentIndex = group.sessions.findIndex((session) => session.id === payload.sessionId)
    const replacement = group.sessions[currentIndex + 1] ?? group.sessions[currentIndex - 1] ?? null

    if (!replacement) {
      deps.closeSplit()
      await deps.closeSession(payload.sessionId)
      return
    }

    paneMutationDepth += 1
    try {
      if (payload.side === 'primary') {
        deps.setPrimarySessionId(replacement.id)
        group.activeSessionId = replacement.id
        deps.setSidebarTarget(group.connectionId, replacement.id)
      } else {
        deps.setSecondarySessionId(replacement.id)
        group.activeSessionId = replacement.id
      }
      await deps.closeSession(payload.sessionId)
    } finally {
      paneMutationDepth -= 1
    }
  }

  watch(deps.activeSessionId, (sessionId) => {
    if (paneMutationDepth > 0) return
    if (deps.isSplit.value && sessionId !== deps.primarySessionId.value) deps.suspendSplit()
  })

  return {
    isCrossHostSplit,
    selectSplitPaneSession,
    createSplitPaneSession,
    closeSplitPaneSession,
  }
}
