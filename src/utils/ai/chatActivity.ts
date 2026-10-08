import type { AiChatStreamPayload } from '@shared/types/ai'

export type AiActivityPhase = 'requesting' | 'waiting' | 'reasoning' | 'responding' | 'tool-input' | 'tool-prepare' | 'tool' | 'approval' | 'compacting'
export type AiChatActivity = {
  phase: AiActivityPhase
  phaseStartedAt: number
  lastActivityAt: number
}

export const AI_OUTPUT_QUIET_MS = 8_000
export const AI_OUTPUT_DELAY_MS = 30_000

/** Receipt times are transient UI state, never inferred from historical reasoning. */
export function advanceChatActivity(
  activity: AiChatActivity,
  payload: AiChatStreamPayload,
  now: number,
  runs: Array<{ status?: string }> = [],
): AiChatActivity {
  let phase: AiActivityPhase
  switch (payload.type) {
    case 'model-status': phase = payload.value; break
    case 'reasoning':
    case 'content':
      if (!payload.value) return activity
      phase = payload.type === 'reasoning' ? 'reasoning' : 'responding'
      break
    case 'compaction': phase = payload.value.phase === 'start' ? 'compacting' : 'requesting'; break
    case 'tool':
      phase = runs.some(run => run.status === 'ask') ? 'approval'
        : runs.some(run => run.status === 'running') ? 'tool' : 'waiting'
      break
    default: return activity
  }
  return { phase, phaseStartedAt: phase === activity.phase ? activity.phaseStartedAt : now, lastActivityAt: now }
}

export function chatActivityDisplay(activity: AiChatActivity, now: number) {
  const quietMs = Math.max(0, now - activity.lastActivityAt)
  const modelPhase = ['requesting', 'waiting', 'reasoning', 'responding', 'tool-input'].includes(activity.phase)
  const staleOutput = ['reasoning', 'responding', 'tool-input'].includes(activity.phase) && quietMs >= AI_OUTPUT_QUIET_MS
  return {
    phase: staleOutput ? 'waiting' as const : activity.phase,
    elapsedSeconds: Math.floor(Math.max(0, now - (staleOutput ? activity.lastActivityAt : activity.phaseStartedAt)) / 1000),
    quietSeconds: Math.floor(quietMs / 1000),
    delayed: modelPhase && quietMs >= AI_OUTPUT_DELAY_MS,
  }
}
