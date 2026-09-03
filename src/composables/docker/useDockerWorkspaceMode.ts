import { computed, ref, type ComputedRef, type Ref } from 'vue'

export type WorkspaceMode = 'terminal' | 'docker'

/** Terminal chrome snapshot (restored when switching PTY sessions). */
export type TerminalSidebarSnapshot = {
  aiSidebarVisible: boolean
  sidebarVisible: boolean
  monitorVisible: boolean
  batchPanelVisible: boolean
  snippetsPanelVisible: boolean
  snippetPaletteVisible: boolean
}

export type DockerTabEntry = {
  open: boolean
  selected: boolean
}

export type SessionChromeEntry = {
  sidebarSnapshot: TerminalSidebarSnapshot | null
}

export type SidebarPanelControls = {
  aiSidebarVisible: Ref<boolean>
  sidebarVisible: Ref<boolean>
  monitorVisible: Ref<boolean>
  batchPanelVisible: Ref<boolean>
  snippetsPanelVisible: Ref<boolean>
  snippetPaletteVisible: Ref<boolean>
}

const EMPTY_SNAPSHOT: TerminalSidebarSnapshot = {
  aiSidebarVisible: false,
  sidebarVisible: false,
  monitorVisible: false,
  batchPanelVisible: false,
  snippetsPanelVisible: false,
  snippetPaletteVisible: false,
}

function captureSnapshot(panels: SidebarPanelControls): TerminalSidebarSnapshot {
  return {
    aiSidebarVisible: panels.aiSidebarVisible.value,
    sidebarVisible: panels.sidebarVisible.value,
    monitorVisible: panels.monitorVisible.value,
    batchPanelVisible: panels.batchPanelVisible.value,
    snippetsPanelVisible: panels.snippetsPanelVisible.value,
    snippetPaletteVisible: panels.snippetPaletteVisible.value,
  }
}

function hideAllSidebars(panels: SidebarPanelControls): void {
  panels.aiSidebarVisible.value = false
  panels.sidebarVisible.value = false
  panels.monitorVisible.value = false
  panels.batchPanelVisible.value = false
  panels.snippetsPanelVisible.value = false
  panels.snippetPaletteVisible.value = false
}

function applySnapshot(panels: SidebarPanelControls, snap: TerminalSidebarSnapshot): void {
  panels.aiSidebarVisible.value = snap.aiSidebarVisible
  panels.sidebarVisible.value = snap.sidebarVisible
  panels.monitorVisible.value = snap.monitorVisible
  panels.batchPanelVisible.value = snap.batchPanelVisible
  panels.snippetsPanelVisible.value = snap.snippetsPanelVisible
  panels.snippetPaletteVisible.value = snap.snippetPaletteVisible
}

/**
 * Docker is an SSH-subordinate window: a sub-tab beside 终端 1 / 终端 2,
 * keyed by connection (host), not by PTY session.
 */
export function useDockerWorkspaceMode(deps: {
  activeSessionId: ComputedRef<string | null> | Ref<string | null>
  activeConnectionId: ComputedRef<string | null> | Ref<string | null>
  panels: SidebarPanelControls
}) {
  const byConnection = ref(new Map<string, DockerTabEntry>())
  const bySession = ref(new Map<string, SessionChromeEntry>())
  const connectedBySession = ref(new Map<string, boolean>())

  function peekTab(connectionId: string): DockerTabEntry {
    return byConnection.value.get(connectionId) ?? { open: false, selected: false }
  }

  function getTab(connectionId: string): DockerTabEntry {
    let entry = byConnection.value.get(connectionId)
    if (!entry) {
      entry = { open: false, selected: false }
      byConnection.value.set(connectionId, entry)
    }
    return entry
  }

  function getChrome(sessionId: string): SessionChromeEntry {
    let entry = bySession.value.get(sessionId)
    if (!entry) {
      entry = { sidebarSnapshot: null }
      bySession.value.set(sessionId, entry)
    }
    return entry
  }

  function touchConnections(): void {
    byConnection.value = new Map(byConnection.value)
  }

  function touchSessions(): void {
    bySession.value = new Map(bySession.value)
  }

  const dockerTabOpen = computed(() => {
    const cid = deps.activeConnectionId.value
    if (!cid) return false
    return peekTab(cid).open
  })

  const isDockerMode = computed(() => {
    const cid = deps.activeConnectionId.value
    if (!cid) return false
    const tab = peekTab(cid)
    return tab.open && tab.selected
  })

  const workspaceMode = computed<WorkspaceMode>(() => (isDockerMode.value ? 'docker' : 'terminal'))

  const isActiveSessionConnected = computed(() => {
    const sid = deps.activeSessionId.value
    if (!sid) return false
    const map = connectedBySession.value
    if (!map.has(sid)) return true
    return map.get(sid) === true
  })

  /** Need a connected PTY on the current host to open Docker. */
  const dockerButtonEnabled = computed(() => {
    const sid = deps.activeSessionId.value
    if (!sid) return false
    return isActiveSessionConnected.value
  })

  function markSessionConnected(sessionId: string, connected: boolean): void {
    const next = new Map(connectedBySession.value)
    next.set(sessionId, connected)
    connectedBySession.value = next
  }

  function ensureSessionTracked(sessionId: string, opts?: { connected?: boolean }): void {
    if (!connectedBySession.value.has(sessionId)) {
      markSessionConnected(sessionId, opts?.connected !== false)
    }
    getChrome(sessionId)
  }

  const disconnectedSessionIds = computed(() => {
    const ids = new Set<string>()
    for (const [id, connected] of connectedBySession.value) {
      if (!connected) ids.add(id)
    }
    return ids
  })

  function enterDocker(): void {
    const cid = deps.activeConnectionId.value
    const sid = deps.activeSessionId.value
    if (!cid || !sid || !dockerButtonEnabled.value) return
    const tab = getTab(cid)
    tab.open = true
    tab.selected = true
    touchConnections()
  }

  /** Leave the Docker pane; keep the Docker sub-tab if it was opened. */
  function enterTerminal(): void {
    const cid = deps.activeConnectionId.value
    if (!cid) return
    const tab = getTab(cid)
    if (!tab.selected) return
    tab.selected = false
    touchConnections()
  }

  function closeDockerTab(): void {
    const cid = deps.activeConnectionId.value
    if (!cid) return
    const tab = getTab(cid)
    tab.open = false
    tab.selected = false
    touchConnections()
  }

  function toggleDockerWorkspace(): void {
    if (isDockerMode.value) {
      enterTerminal()
    } else {
      enterDocker()
    }
  }

  /**
   * Re-apply PTY sidebar snapshots when the active session changes.
   * Docker selection is per connection and is not stored on the PTY.
   */
  function applyModeForActiveSession(prevSessionId: string | null, nextSessionId: string | null): void {
    if (prevSessionId && prevSessionId !== nextSessionId) {
      getChrome(prevSessionId).sidebarSnapshot = captureSnapshot(deps.panels)
      touchSessions()
    }

    if (!nextSessionId) {
      hideAllSidebars(deps.panels)
      return
    }

    ensureSessionTracked(nextSessionId)
    if (isDockerMode.value) return
    applySnapshot(deps.panels, getChrome(nextSessionId).sidebarSnapshot ?? EMPTY_SNAPSHOT)
  }

  function forgetSession(sessionId: string): void {
    bySession.value.delete(sessionId)
    touchSessions()
    connectedBySession.value.delete(sessionId)
    connectedBySession.value = new Map(connectedBySession.value)
  }

  function forgetConnection(connectionId: string): void {
    byConnection.value.delete(connectionId)
    touchConnections()
  }

  function pruneConnections(liveIds: Iterable<string>): void {
    const live = new Set(liveIds)
    let changed = false
    for (const id of [...byConnection.value.keys()]) {
      if (!live.has(id)) {
        byConnection.value.delete(id)
        changed = true
      }
    }
    if (changed) touchConnections()
  }

  return {
    workspaceMode,
    isDockerMode,
    dockerTabOpen,
    isActiveSessionConnected,
    dockerButtonEnabled,
    enterDocker,
    enterTerminal,
    closeDockerTab,
    toggleDockerWorkspace,
    applyModeForActiveSession,
    markSessionConnected,
    ensureSessionTracked,
    disconnectedSessionIds,
    forgetSession,
    forgetConnection,
    pruneConnections,
    /** test helpers */
    _getTab: peekTab,
    _getChrome: getChrome,
    _byConnection: byConnection,
    _connectedBySession: connectedBySession,
  }
}
