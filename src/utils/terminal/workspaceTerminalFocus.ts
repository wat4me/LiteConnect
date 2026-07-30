/**
 * Safe xterm focus used by TerminalTab. Pure for unit tests — no DOM recreate.
 * Returns false when missing instance, inactive pane, or focus throws.
 */
export function focusLiveTerminal(opts: {
  active: boolean
  getTerminal: () => { focus: () => void } | null | undefined
}): boolean {
  if (!opts.active) return false
  const terminal = opts.getTerminal()
  if (!terminal) return false
  try {
    terminal.focus()
    return true
  } catch {
    return false
  }
}

/**
 * Resolve which mounted terminal tab should receive keyboard focus when
 * restoring the terminal workspace (e.g. leaving Docker mode).
 * Always the primary active session — never secondary split or background tabs.
 */
export function resolvePrimaryTerminalFocusSessionId(
  activeSessionId: string | null | undefined,
  liveSessionIds?: readonly string[],
): string | null {
  if (!activeSessionId) return null
  if (liveSessionIds && liveSessionIds.length > 0 && !liveSessionIds.includes(activeSessionId)) {
    return null
  }
  return activeSessionId
}

export type FocusableTerminalTab = {
  focusTerminal: () => boolean
}

/**
 * Call focus only on the primary session's tab. Other sessions must not focus.
 * Returns whether focus was applied.
 */
export function focusPrimaryTerminalTab(
  tabsBySessionId: Map<string, FocusableTerminalTab>,
  activeSessionId: string | null | undefined,
  liveSessionIds?: readonly string[],
): boolean {
  const targetId = resolvePrimaryTerminalFocusSessionId(activeSessionId, liveSessionIds)
  if (!targetId) return false
  const tab = tabsBySessionId.get(targetId)
  if (!tab) return false
  return tab.focusTerminal()
}

/**
 * After Docker→terminal, wait until the terminal host is visible in layout
 * before focusing xterm (v-show + toolbar button focus steal).
 * Returns a cancel function so rapid Docker↔Terminal toggles drop stale focus.
 */
export function scheduleAfterTerminalVisible(focus: () => void): () => void {
  let cancelled = false
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(() => {
      if (!cancelled) focus()
    })
    return () => {
      cancelled = true
      try {
        cancelAnimationFrame(id)
      } catch {}
    }
  }
  focus()
  return () => {
    cancelled = true
  }
}
