import { reactive } from 'vue'

/** SSH sessions whose AI is blocked on a tool approval. */
const pendingApprovalSessions = reactive(new Set<string>())

export function syncAiApprovalPending(sessionId: string, pending: boolean) {
  if (!sessionId) return
  if (pending) pendingApprovalSessions.add(sessionId)
  else pendingApprovalSessions.delete(sessionId)
}

export function sessionHasAiApprovalPending(sessionId: string): boolean {
  return pendingApprovalSessions.has(sessionId)
}

export function useAiApprovalHint() {
  return {
    pendingApprovalSessions,
    hasPending: sessionHasAiApprovalPending,
  }
}
