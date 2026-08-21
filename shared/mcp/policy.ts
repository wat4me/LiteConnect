import type { ApprovalMode, CommandClass, CommandClassification, SshMcpToolErrorCode } from './types'

export type PolicyDecision =
  | { allow: true }
  | { allow: false; code: SshMcpToolErrorCode; reason: string }

/**
 * Default is fail-closed for anything that can mutate or escalate.
 * `auto` still never allows `forbidden`.
 */
export function decideCommandPolicy(
  classification: CommandClassification,
  mode: ApprovalMode = 'deny-destructive',
): PolicyDecision {
  const cls = classification.class
  if (cls === 'forbidden') {
    return { allow: false, code: 'FORBIDDEN', reason: classification.reason }
  }
  if (cls === 'read-only' || cls === 'safe') {
    return { allow: true }
  }
  if (mode === 'auto') {
    return { allow: true }
  }
  if (mode === 'ask-destructive') {
    return {
      allow: false,
      code: 'APPROVAL_REQUIRED',
      reason: classification.reason,
    }
  }
  if (cls === 'privileged') {
    return { allow: false, code: 'PRIVILEGED_DENIED', reason: classification.reason }
  }
  return { allow: false, code: 'DESTRUCTIVE_DENIED', reason: classification.reason }
}

export function policyErrorMessage(code: SshMcpToolErrorCode, reason: string, cls?: CommandClass): string {
  const detail = reason ? `: ${reason}` : ''
  switch (code) {
    case 'FORBIDDEN':
      return `Command is forbidden${detail}`
    case 'PRIVILEGED_DENIED':
      return `Privileged command is not allowed${detail}`
    case 'DESTRUCTIVE_DENIED':
      return `Destructive command is not allowed${detail}`
    case 'APPROVAL_REQUIRED':
      return `Command needs approval (${cls || 'destructive'})${detail}`
    default:
      return reason || code
  }
}
