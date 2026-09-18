/**
 * Whether PTY resize should be sent to the remote after a local fit.
 * Hidden / zero-size panes must never resize; unchanged cols/rows skip sshResize.
 */
export function canMeasureTerminal(size: { width: number; height: number }): boolean {
  return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
}

export function shouldSendSshResize(
  previous: { cols: number; rows: number } | null,
  next: { cols: number; rows: number },
  options?: { force?: boolean },
): boolean {
  if (!next || next.cols <= 0 || next.rows <= 0) return false
  if (options?.force) return true
  if (!previous) return true
  return previous.cols !== next.cols || previous.rows !== next.rows
}

/** Foreground for paint/resize/focus: pane selected AND workspace host visible. */
export function computeEffectiveTerminalActive(opts: {
  active: boolean
  workspaceVisible: boolean
}): boolean {
  return !!opts.active && !!opts.workspaceVisible
}

export type TerminalDims = { cols: number; rows: number }

/**
 * Pure plan for performResize (Docker restore must not clearSelection/fit when dims match).
 * - noop: local refresh/focus only; keep selection
 * - ssh-only: send PTY size without fit/clearSelection (force reconnect, same geometry)
 * - fit: clearSelection + fit; optionally sshResize
 */
export type TerminalResizePlan =
  | { kind: 'noop' }
  | { kind: 'ssh-only'; cols: number; rows: number }
  | { kind: 'fit'; cols: number; rows: number; sendSsh: boolean; clearSelection: true }

export function planTerminalResize(opts: {
  proposed: TerminalDims | null | undefined
  current: TerminalDims
  lastSent: TerminalDims | null
  forceSshResize?: boolean
  skipSshResize?: boolean
}): TerminalResizePlan {
  const proposed = opts.proposed
  if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) {
    return { kind: 'noop' }
  }

  const dimsMatchCurrent =
    proposed.cols === opts.current.cols && proposed.rows === opts.current.rows

  if (dimsMatchCurrent) {
    if (opts.skipSshResize) return { kind: 'noop' }
    if (
      shouldSendSshResize(opts.lastSent, proposed, {
        force: opts.forceSshResize === true,
      })
    ) {
      // Same local geometry: do not fit/clearSelection; may still notify remote (force).
      return { kind: 'ssh-only', cols: proposed.cols, rows: proposed.rows }
    }
    return { kind: 'noop' }
  }

  const sendSsh =
    !opts.skipSshResize &&
    shouldSendSshResize(opts.lastSent, proposed, {
      force: opts.forceSshResize === true,
    })
  return {
    kind: 'fit',
    cols: proposed.cols,
    rows: proposed.rows,
    sendSsh,
    clearSelection: true,
  }
}
