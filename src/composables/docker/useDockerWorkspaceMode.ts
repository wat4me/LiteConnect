import { computed, ref, type ComputedRef, type Ref } from 'vue'

export type WorkspaceMode = 'terminal' | 'docker'

/** Terminal-mode side panels snapshot (restored when leaving Docker). */
export type TerminalSidebarSnapshot = {
  aiSidebarVisible: boolean
  sidebarVisible: boolean
  monitorVisible: boolean
  batchPanelVisible: boolean
  snippetsPanelVisible: boolean
  snippetPaletteVisible: boolean
}

export type DockerWorkspaceModeEntry = {
  mode: WorkspaceMode
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
 * Per-SSH-session workspace mode (terminal | docker) and sidebar snapshots.
 * Modes never leak across sessions; global sidebar state is re-applied on switch.
 */
export function useDockerWorkspaceMode(deps: {
  activeSessionId: ComputedRef<string | null> | Ref<string | null>
  panels: SidebarPanelControls
}) {
  /** sessionId → mode + terminal sidebar snapshot */
  const bySession = ref(new Map<string, DockerWorkspaceModeEntry>())

  /** sessionId → SSH connected (true until closed; reconnected restores) */
  const connectedBySession = ref(new Map<string, boolean>())

  function getEntry(sessionId: string): DockerWorkspaceModeEntry {
    let entry = bySession.value.get(sessionId)
    if (!entry) {
      entry = { mode: 'terminal', sidebarSnapshot: null }
      bySession.value.set(sessionId, entry)
    }
    return entry
  }

  const workspaceMode = computed<WorkspaceMode>(() => {
    const sid = deps.activeSessionId.value
    if (!sid) return 'terminal'
    return getEntry(sid).mode
  })

  const isDockerMode = computed(() => workspaceMode.value === 'docker')

  const isActiveSessionConnected = computed(() => {
    const sid = deps.activeSessionId.value
    if (!sid) return false
    const map = connectedBySession.value
    if (!map.has(sid)) return true
    return map.get(sid) === true
  })

  /** Toolbar: need active session that is still connected to enter Docker. */
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
    getEntry(sessionId)
  }

  const disconnectedSessionIds = computed(() => {
    const ids = new Set<string>()
    for (const [id, connected] of connectedBySession.value) {
      if (!connected) ids.add(id)
    }
    return ids
  })

  function setModeForSession(sessionId: string, mode: WorkspaceMode): void {
    const entry = getEntry(sessionId)
    if (entry.mode === mode) return

    if (mode === 'docker') {
      entry.sidebarSnapshot = captureSnapshot(deps.panels)
      hideAllSidebars(deps.panels)
      entry.mode = 'docker'
    } else {
      entry.mode = 'terminal'
      const snap = entry.sidebarSnapshot ?? EMPTY_SNAPSHOT
      applySnapshot(deps.panels, snap)
      entry.sidebarSnapshot = null
    }
    // trigger reactivity for Map mutations
    bySession.value = new Map(bySession.value)
  }

  function enterDocker(): void {
    const sid = deps.activeSessionId.value
    if (!sid || !dockerButtonEnabled.value) return
    setModeForSession(sid, 'docker')
  }

  function enterTerminal(): void {
    const sid = deps.activeSessionId.value
    if (!sid) return
    setModeForSession(sid, 'terminal')
  }

  function toggleDockerWorkspace(): void {
    if (isDockerMode.value) {
      enterTerminal()
    } else {
      enterDocker()
    }
  }

  /**
   * Apply panels for the newly active session without cross-session leakage.
   * Call when activeSessionId changes.
   */
  function applyModeForActiveSession(prevSessionId: string | null, nextSessionId: string | null): void {
    if (prevSessionId && prevSessionId !== nextSessionId) {
      const prev = getEntry(prevSessionId)
      if (prev.mode === 'terminal') {
        prev.sidebarSnapshot = captureSnapshot(deps.panels)
      }
    }

    if (!nextSessionId) {
      hideAllSidebars(deps.panels)
      return
    }

    ensureSessionTracked(nextSessionId)
    const next = getEntry(nextSessionId)
    if (next.mode === 'docker') {
      hideAllSidebars(deps.panels)
    } else {
      applySnapshot(deps.panels, next.sidebarSnapshot ?? EMPTY_SNAPSHOT)
    }
  }

  function forgetSession(sessionId: string): void {
    bySession.value.delete(sessionId)
    bySession.value = new Map(bySession.value)
    connectedBySession.value.delete(sessionId)
    connectedBySession.value = new Map(connectedBySession.value)
  }

  /** Block terminal-side panel toggles while Docker workspace is active. */
  function withTerminalModeGuard(fn: () => void): void {
    if (isDockerMode.value) return
    fn()
  }

  return {
    workspaceMode,
    isDockerMode,
    isActiveSessionConnected,
    dockerButtonEnabled,
    enterDocker,
    enterTerminal,
    toggleDockerWorkspace,
    applyModeForActiveSession,
    markSessionConnected,
    ensureSessionTracked,
    disconnectedSessionIds,
    forgetSession,
    withTerminalModeGuard,
    /** test helpers */
    _getEntry: getEntry,
    _bySession: bySession,
    _connectedBySession: connectedBySession,
  }
}
