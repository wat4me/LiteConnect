import { AI_TOOL_APPROVAL_TIMEOUT_MS } from '../../../shared/aiToolPolicy'

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
      if (activeAiStreams.get(requestId) === active) activeAiStreams.delete(requestId)
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
