import { nextTick, type Ref } from 'vue'

export type FocusScrollMode = 'auto' | 'if-needed' | 'never' | 'center'

/**
 * Tree scroll lock (click reflow) + reveal current path after terminal follow / locate.
 */
export function useSftpTreeScroll(deps: {
  treeScrollRef: Ref<HTMLElement | null>
  rowElements: Map<string, HTMLElement>
  cleanPath: (path: string) => string
  setFocusedPath: (path: string) => void
  focusExplorer: () => void
}) {
  let lockedScrollTop: number | null = null
  let lockScrollUntil = 0
  let pendingRevealPath: string | null = null
  let revealAttempts = 0
  const REVEAL_MAX_ATTEMPTS = 24

  function captureTreeScroll(holdMs = 450) {
    const el = deps.treeScrollRef.value
    if (!el) return
    lockedScrollTop = el.scrollTop
    lockScrollUntil = Date.now() + holdMs
  }

  function clearScrollLock() {
    lockedScrollTop = null
    lockScrollUntil = 0
  }

  function restoreTreeScroll() {
    if (lockedScrollTop == null || Date.now() > lockScrollUntil) return
    const el = deps.treeScrollRef.value
    if (!el) return
    if (el.scrollTop !== lockedScrollTop) {
      el.scrollTop = lockedScrollTop
    }
  }

  function scheduleRestoreTreeScroll() {
    if (lockedScrollTop == null || Date.now() > lockScrollUntil) return
    nextTick(() => {
      restoreTreeScroll()
      requestAnimationFrame(() => {
        restoreTreeScroll()
        requestAnimationFrame(restoreTreeScroll)
      })
    })
  }

  function focusRow(path: string, opts?: { scroll?: FocusScrollMode }) {
    deps.setFocusedPath(path)
    deps.focusExplorer()
    const mode = opts?.scroll ?? 'if-needed'
    if (mode === 'never') return
    nextTick(() => {
      const row = deps.rowElements.get(path)
      const scroller = deps.treeScrollRef.value
      if (!row) return
      if (mode === 'if-needed' && scroller) {
        const rowRect = row.getBoundingClientRect()
        const box = scroller.getBoundingClientRect()
        const visible = rowRect.top >= box.top - 1 && rowRect.bottom <= box.bottom + 1
        if (visible) return
      }
      row.scrollIntoView({
        block: mode === 'center' ? 'center' : 'nearest',
        inline: 'nearest',
      })
    })
  }

  function isRowVisible(path: string): boolean {
    const row = deps.rowElements.get(path)
    const scroller = deps.treeScrollRef.value
    if (!row || !scroller) return false
    const rowRect = row.getBoundingClientRect()
    const box = scroller.getBoundingClientRect()
    return rowRect.top >= box.top - 2 && rowRect.bottom <= box.bottom + 2
  }

  /**
   * Scroll the path row into view once it exists in the DOM.
   * Root `/` has no row in the tree, so it is a no-op.
   */
  function requestRevealPath(path: string) {
    const clean = deps.cleanPath(path)
    if (clean === '/') {
      pendingRevealPath = null
      return
    }
    // Intentional reveal (follow / path jump) must win over click reflow lock.
    clearScrollLock()
    pendingRevealPath = clean
    revealAttempts = 0
    tryRevealPendingPath()
  }

  /**
   * Same as requestRevealPath; kept for call sites that mean "user asked to locate".
   * Always restarts the reveal attempt even if the path string did not change.
   */
  function forceRevealPath(path: string) {
    requestRevealPath(path)
  }

  function tryRevealPendingPath() {
    const path = pendingRevealPath
    if (!path) return

    const row = deps.rowElements.get(path)
    if (!row) {
      if (revealAttempts++ < REVEAL_MAX_ATTEMPTS) {
        nextTick(() => {
          requestAnimationFrame(() => tryRevealPendingPath())
        })
      } else {
        pendingRevealPath = null
      }
      return
    }

    // Do not let a stale click lock fight scrollIntoView.
    clearScrollLock()

    if (isRowVisible(path)) {
      deps.setFocusedPath(path)
      pendingRevealPath = null
      return
    }

    deps.setFocusedPath(path)
    row.scrollIntoView({ block: 'center', inline: 'nearest' })
    nextTick(() => {
      if (!isRowVisible(path)) {
        deps.rowElements.get(path)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
      if (pendingRevealPath === path) pendingRevealPath = null
    })
  }

  function hasPendingReveal(): boolean {
    return !!pendingRevealPath
  }

  return {
    captureTreeScroll,
    restoreTreeScroll,
    scheduleRestoreTreeScroll,
    focusRow,
    requestRevealPath,
    forceRevealPath,
    tryRevealPendingPath,
    hasPendingReveal,
  }
}
