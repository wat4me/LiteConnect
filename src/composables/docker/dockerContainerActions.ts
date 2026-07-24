import type { DockerContainerAction } from '../env.d'

/**
 * Which action buttons to show for a container state (conservative for unknown).
 * - running: stop + restart
 * - exited | created | dead: start only
 * - paused | restarting | removing | unknown: none
 */
export function visibleContainerActions(state: string): DockerContainerAction[] {
  const s = (state || '').toLowerCase()
  if (s === 'running') return ['stop', 'restart']
  if (s === 'exited' || s === 'created' || s === 'dead') return ['start']
  return []
}

export function canShowContainerActions(opts: {
  dockerAvailable: boolean
  sshConnected: boolean
}): boolean {
  return opts.dockerAvailable && opts.sshConnected
}

export type DockerActionFeedbackKind =
  | 'completed'
  | 'already-in-state'
  | 'container-not-found'
  | 'action-conflict'
  | 'permission-denied'
  | 'ssh-disconnected'
  | 'generation-stale'
  | 'request-timeout'
  | 'request-failed'

/** Map stable main-process code / outcome to UI feedback kind (never English message). */
export function mapActionResultToFeedback(
  response:
    | { ok: true; result: { outcome: 'completed' | 'already-in-state' } }
    | { ok: false; code: string },
): DockerActionFeedbackKind {
  if (response.ok) {
    return response.result.outcome === 'already-in-state' ? 'already-in-state' : 'completed'
  }
  const code = response.code
  if (code === 'container-not-found') return 'container-not-found'
  if (code === 'action-conflict') return 'action-conflict'
  if (code === 'permission-denied') return 'permission-denied'
  if (code === 'ssh-disconnected') return 'ssh-disconnected'
  if (code === 'generation-stale') return 'generation-stale'
  if (code === 'request-timeout') return 'request-timeout'
  return 'request-failed'
}

/** Whether a late action result may update UI / show toast / refresh. */
export function canApplyContainerActionResult(opts: {
  disposed: boolean
  resultSessionId: string
  activeSessionId: string | null
  ownerSessionId: string | null
  resultGen: number
  currentGen: number
}): boolean {
  if (opts.disposed) return false
  if (opts.resultGen !== opts.currentGen) return false
  if (opts.ownerSessionId !== opts.resultSessionId) return false
  if (opts.activeSessionId !== opts.resultSessionId) return false
  return true
}
