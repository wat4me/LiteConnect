import { AI_TOOL_APPROVAL_TIMEOUT_MS } from '../../../shared/aiToolPolicy'
import { validateAiUserAnswer, type AiUserAnswer, type AiUserQuestion } from '../../../shared/aiQuestions'

type ActiveAiStream = { controller: AbortController; ownerId?: number }
const activeAiStreams = new Map<string, ActiveAiStream>()

export function createAiStreamControl(requestId: string, ownerId?: number) {
  if (typeof requestId !== 'string' || !requestId || activeAiStreams.has(requestId)) {
    throw new Error('Invalid or active AI request id')
  }
  const controller = new AbortController()
  const active = { controller, ownerId }
  activeAiStreams.set(requestId, active)
  return {
    controller,
    cleanup: () => {
      if (activeAiStreams.get(requestId) === active) {
        activeAiStreams.delete(requestId)
        clearPendingUserQuestions(requestId)
      }
    },
  }
}

type PendingToolApproval = { finish: (approved: boolean) => void; ownerId?: number }
const pendingToolApprovals = new Map<string, PendingToolApproval>()

function toolApprovalKey(requestId: string, callId: string): string {
  return `${requestId}::${callId}`
}

export function waitForToolApproval(requestId: string, callId: string, signal: AbortSignal): Promise<boolean> {
  const key = toolApprovalKey(requestId, callId)
  return new Promise((resolve) => {
    let settled = false
    const finish = (approved: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      pendingToolApprovals.delete(key)
      resolve(approved)
    }
    const onAbort = () => finish(false)
    const timer = setTimeout(() => finish(false), AI_TOOL_APPROVAL_TIMEOUT_MS)
    pendingToolApprovals.set(key, { finish, ownerId: activeAiStreams.get(requestId)?.ownerId })
    signal.addEventListener('abort', onAbort)
    if (signal.aborted) finish(false)
  })
}

export function abortAiChatStream(requestId: string, ownerId?: number): boolean {
  if (!requestId || typeof requestId !== 'string') return false
  const active = activeAiStreams.get(requestId)
  if (!active || (ownerId !== undefined && active.ownerId !== ownerId)) return false
  active.controller.abort()
  return true
}

export function resolveToolApproval(
  requestId: string,
  callId: string,
  approved: boolean,
  ownerId?: number,
): boolean {
  if (typeof requestId !== 'string' || typeof callId !== 'string') return false
  const pending = pendingToolApprovals.get(toolApprovalKey(requestId, callId))
  if (!pending || (ownerId !== undefined && pending.ownerId !== ownerId)) return false
  pending.finish(approved === true)
  return true
}

export function clearPendingToolApprovals(requestId: string): void {
  for (const [key, pending] of pendingToolApprovals) {
    if (key.startsWith(`${requestId}::`)) pending.finish(false)
  }
}

type PendingQuestion = { requestId: string; ownerId?: number; questions: AiUserQuestion[]; finish: (answer?: AiUserAnswer) => void }
const pendingQuestions = new Map<string, PendingQuestion>()
const questionKey = (requestId: string, callId: string) => JSON.stringify([requestId, callId])

export function waitForUserAnswer(requestId: string, callId: string, questions: AiUserQuestion[], signal: AbortSignal): Promise<AiUserAnswer | undefined> {
  const key = questionKey(requestId, callId)
  if (pendingQuestions.has(key)) throw new Error('Question is already pending')
  return new Promise(resolve => {
    const finish = (answer?: AiUserAnswer) => {
      if (!pendingQuestions.has(key)) return
      pendingQuestions.delete(key)
      signal.removeEventListener('abort', onAbort)
      resolve(answer)
    }
    const onAbort = () => finish()
    pendingQuestions.set(key, { requestId, ownerId: activeAiStreams.get(requestId)?.ownerId, questions: structuredClone(questions), finish })
    signal.addEventListener('abort', onAbort)
    if (signal.aborted) finish()
  })
}

export function resolveUserAnswer(requestId: string, callId: string, raw: unknown, ownerId?: number): boolean {
  if (typeof requestId !== 'string' || typeof callId !== 'string') return false
  const pending = pendingQuestions.get(questionKey(requestId, callId))
  if (!pending || (ownerId !== undefined && ownerId !== pending.ownerId)) return false
  try { pending.finish(validateAiUserAnswer(raw, pending.questions)); return true } catch { return false }
}

export function clearPendingUserQuestions(requestId: string): void {
  for (const pending of [...pendingQuestions.values()]) if (pending.requestId === requestId) pending.finish()
}
