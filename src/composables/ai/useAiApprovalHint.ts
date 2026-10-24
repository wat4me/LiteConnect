import { reactive } from 'vue'
import type { AiPendingAction } from '@/utils/ai/pendingAction'

/** SSH sessions whose AI needs a user answer or an execution approval. */
const pendingApprovalSessions = reactive(new Set<string>())
const pendingActions = reactive(new Map<string, AiPendingAction>())

export function syncAiApprovalPending(sessionId: string, pending: AiPendingAction | false | null) {
  if (!sessionId) return
  if (pending) {
    pendingApprovalSessions.add(sessionId)
    pendingActions.set(sessionId, pending)
  } else {
    pendingApprovalSessions.delete(sessionId)
    pendingActions.delete(sessionId)
  }
}

export function sessionHasAiApprovalPending(sessionId: string): boolean {
  return pendingApprovalSessions.has(sessionId)
}

export function useAiApprovalHint() {
  return {
    pendingApprovalSessions,
    hasPending: sessionHasAiApprovalPending,
    getPendingAction: (sessionId: string) => pendingActions.get(sessionId) || null,
  }
}
