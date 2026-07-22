/**
 * Pure reconcile decision for DockerContainerTerminal lifecycle.
 *
 * Encodes the contract that the component must NOT start an Exec before the
 * xterm + dataHandler are ready, and that session/container/runnable/active
 * changes route through a single decision function. Extracted as a pure helper
 * so the call-order contract can be unit-tested without a Vue/xterm mount env.
 */

export type ReconcileInputs = {
  /** Component mounted and xterm + dataHandler created. */
  ready: boolean
  /** Detail tab is visible. */
  active: boolean
  /** Valid session id present. */
  sessionId: string | null | undefined
  /** Container id present. */
  containerId: string | null | undefined
  /** SSH transport down. */
  sshDisconnected: boolean
  /** Container is running and not paused/restarting. */
  containerRunnable: boolean
  /** The container id the current live Exec was started for (null if none). */
  activeExecContainerId: string | null
  /** The session id the current live Exec was started for (null if none). */
  activeExecSessionId: string | null
}

export type ReconcileDecision =
  | { kind: 'stop' }
  | { kind: 'noop' }
  | { kind: 'start'; containerId: string; sessionId: string }

/**
 * Decide whether to start, stop, or do nothing.
 *
 * - Stop when not ready, not active, no session/container, SSH disconnected,
 *   or container not runnable.
 * - Start when ready + active + valid ids + runnable, AND either there is no
 *   live exec OR the live exec is for a different container/session.
 * - Noop when all conditions for start are met but an exec for the same
 *   container+session is already live (prevents duplicate start on remount /
 *   immediate-watcher + onMounted double path).
 */
export function decideTerminalReconcile(inp: ReconcileInputs): ReconcileDecision {
  const canStart =
    inp.ready &&
    inp.active &&
    !!inp.sessionId &&
    !!inp.containerId &&
    !inp.sshDisconnected &&
    inp.containerRunnable

  if (!canStart) {
    // If there is a live exec, stop it; otherwise nothing to do.
    if (inp.activeExecContainerId || inp.activeExecSessionId) {
      return { kind: 'stop' }
    }
    return { kind: 'noop' }
  }

  const cid = inp.containerId as string
  const sid = inp.sessionId as string

  // Already live for the same container+session -> do not double-start.
  if (
    inp.activeExecContainerId === cid &&
    inp.activeExecSessionId === sid
  ) {
    return { kind: 'noop' }
  }

  // Different container/session while an exec is live -> stop+start collapses
  // to a single start (component stops the old one before starting the new).
  return { kind: 'start', containerId: cid, sessionId: sid }
}

// ─── Async reconcile scheduler ──────────────────────────────────────────────

/**
 * Immutable snapshot of the inputs that a single reconcile round captures.
 * Once captured, the round uses ONLY this snapshot for its decision and for
 * the `start` target, so an `await` cannot let a later props change leak into
 * the active-owner bookkeeping of an in-flight start.
 */
export type ReconcileSnapshot = {
  ready: boolean
  active: boolean
  sessionId: string | null
  containerId: string | null
  sshDisconnected: boolean
  containerRunnable: boolean
}

/**
 * Target a start was issued for. The controller records this as the active
 * owner ONLY for the target it actually started, never for current props.
 */
export type StartTarget = { containerId: string; sessionId: string }

export type ReconcileControllerOpts = {
  /** Read current props/state as an immutable snapshot. */
  getSnapshot: () => ReconcileSnapshot
  /** Read the container id the current live exec was started for (null if none). */
  getActiveExecContainerId: () => string | null
  /** Read the session id the current live exec was started for (null if none). */
  getActiveExecSessionId: () => string | null
  /** Set the active exec owner after a start settles (target captured this round). */
  setActiveExec: (containerId: string | null, sessionId: string | null) => void
  /** Perform a start for the immutable target. Must not read external "current" props. */
  start: (target: StartTarget) => Promise<void>
  /** Stop the current live exec (if any). */
  stop: () => Promise<void>
  /** True if the host (component) is disposed; runner refuses new rounds when true. */
  isDisposed: () => boolean
}

export type ReconcileController = {
  /** Request a reconcile round. Coalesces into the single-consumer loop. */
  request: () => void
  /** Dispose the controller; in-flight rounds finish but no new rounds start. */
  dispose: () => void
  /** Test hook: true when the runner loop is currently executing. */
  isRunning: () => boolean
  /** Test hook: true when a request was coalesced during an in-flight round. */
  isDirty: () => boolean
}

/**
 * Single-consumer async reconcile loop.
 *
 * Solves the in-flight drop bug: when a start/stop is pending and props change
 * again (e.g. A -> B), the new request is marked dirty instead of discarded.
 * The runner clears the dirty flag, captures an IMMUTABLE snapshot, runs the
 * decision, and - if another request arrived mid-round - loops again. This
 * guarantees the final active owner reflects the latest target, not the one
 * that happened to be pending when the change occurred.
 *
 * `start` receives the round's captured target; the component must record that
 * exact target as the active owner (via setActiveExec), so a late props change
 * can't impersonate a different exec. If props changed during the await, the
 * next dirty loop will stop the just-started exec and start the new target.
 */
export function createReconcileController(
  opts: ReconcileControllerOpts,
): ReconcileController {
  let running = false
  let dirty = false
  let disposed = false

  function request(): void {
    if (disposed || opts.isDisposed()) return
    dirty = true
    if (running) return
    void run()
  }

  function dispose(): void {
    disposed = true
    dirty = false
  }

  async function run(): Promise<void> {
    if (running) return
    running = true
    try {
      while (dirty && !disposed && !opts.isDisposed()) {
        // Clear dirty BEFORE capturing the snapshot so requests arriving during
        // this round's awaits set dirty=true and trigger another loop iteration.
        dirty = false
        const snap = opts.getSnapshot()
        const activeCid = opts.getActiveExecContainerId()
        const activeSid = opts.getActiveExecSessionId()
        const decision = decideTerminalReconcile({
          ready: snap.ready,
          active: snap.active,
          sessionId: snap.sessionId,
          containerId: snap.containerId,
          sshDisconnected: snap.sshDisconnected,
          containerRunnable: snap.containerRunnable,
          activeExecContainerId: activeCid,
          activeExecSessionId: activeSid,
        })
        if (decision.kind === 'stop') {
          await opts.stop()
          // stop() is responsible for clearing active exec owner.
        } else if (decision.kind === 'start') {
          // If a previous exec is live for a different target, stop it first
          // (serial - never two concurrent starts).
          if (activeCid || activeSid) {
            await opts.stop()
          }
          if (disposed || opts.isDisposed()) return
          // Capture the immutable target for this round.
          const target: StartTarget = {
            containerId: decision.containerId,
            sessionId: decision.sessionId,
          }
          await opts.start(target)
          // If the host disposed during the await, do NOT record an owner:
          // a disposed component must not influence bookkeeping, and the next
          // mount's fresh controller starts with a clean slate.
          if (disposed || opts.isDisposed()) return
          // Record the EXACT target we started for. If props changed during the
          // await, the next dirty loop will stop this exec and start the new one.
          opts.setActiveExec(target.containerId, target.sessionId)
        }
        // noop: nothing to do this round.
      }
    } finally {
      running = false
    }
  }

  return {
    request,
    dispose,
    isRunning: () => running,
    isDirty: () => dirty,
  }
}

// ─── Rendered content owner + retry commit policy ───────────────────────────

/**
 * Whether starting `target` requires resetting the xterm screen/scrollback.
 *
 * The xterm screen "belongs to" the last container/session whose start
 * actually wrote bytes (`renderedOwner`). This is DISTINCT from the live exec
 * owner: stop clears the live owner but MUST NOT clear the rendered owner,
 * otherwise a subsequent start for a different container can't tell that the
 * screen still shows the old container's content.
 *
 * - Different container OR different session -> reset (avoid mixing A's
 *   scrollback with B's prompt).
 * - Same container+session, bash->sh retry -> keep (user needs to see the
 *   failure reason that led to the retry).
 * - No rendered owner yet (first start) -> no reset needed (empty terminal).
 */
export function shouldResetForTarget(
  renderedContainerId: string | null,
  renderedSessionId: string | null,
  target: { containerId: string; sessionId: string },
): boolean {
  if (!renderedContainerId && !renderedSessionId) return false
  if (renderedContainerId !== target.containerId) return true
  if (renderedSessionId !== target.sessionId) return true
  return false
}

export type RetryCommitInputs = {
  /** True if the host component is disposed. */
  disposed: boolean
  /** The immutable target captured at the moment the user clicked retry. */
  retryTarget: { containerId: string; sessionId: string }
  /** The current props target (may have changed during the await). */
  currentTarget: { containerId: string | null | undefined; sessionId: string | null | undefined }
  /** Whether the current props still satisfy startability. */
  canStart: boolean
}

export type RetryCommitDecision =
  | { kind: 'commit'; containerId: string; sessionId: string }
  | { kind: 'reconcile-only' }
  | { kind: 'skip' }

/**
 * Decide what to do after a retry's await settles.
 *
 * - disposed -> skip (do not write any owner).
 * - current props still match the retry target and are startable -> commit the
 *   retry target as the active owner (the retry genuinely succeeded for the
 *   currently-shown container).
 * - props changed or no longer startable -> do NOT write the target (would
 *   either impersonate B/C with A's result, or overwrite the controller's new
 *   owner). Just request a reconcile and let the dirty-loop decide.
 *
 * Shell choice (bash/sh) is never reset here - the retry path preserves the
 * user's explicit selection.
 */
export function decideRetryCommit(inp: RetryCommitInputs): RetryCommitDecision {
  if (inp.disposed) return { kind: 'skip' }
  const matchesCurrent =
    inp.canStart &&
    inp.currentTarget.containerId === inp.retryTarget.containerId &&
    inp.currentTarget.sessionId === inp.retryTarget.sessionId
  if (matchesCurrent) {
    return {
      kind: 'commit',
      containerId: inp.retryTarget.containerId,
      sessionId: inp.retryTarget.sessionId,
    }
  }
  return { kind: 'reconcile-only' }
}
