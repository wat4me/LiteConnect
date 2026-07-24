interface CachedSidebarState {
  activeTab: 'files' | 'transfers'
  currentPath: string
  error: string
  sftpReady: boolean
  pathInput: string
  homePath: string
  shellHomePath: string
  terminalPath: string
  lastPathDebug: string
  followTerminalPath: boolean
  previousTerminalPath: string
}

export function useSessionState() {
  const sessionStateCache = new Map<string, CachedSidebarState>()

  function persistSessionState(
    sessionId: string,
    state: Omit<CachedSidebarState, 'activeTab'> & { activeTab: string }
  ) {
    if (!sessionId) return
    sessionStateCache.set(sessionId, {
      ...state,
      activeTab: state.activeTab === 'files' ? 'files' : 'transfers',
    })
  }

  function restoreSessionState(sessionId: string): CachedSidebarState | null {
    return sessionStateCache.get(sessionId) || null
  }

  function clearSessionState(sessionId: string) {
    sessionStateCache.delete(sessionId)
  }

  return {
    persistSessionState,
    restoreSessionState,
    clearSessionState,
  }
}
