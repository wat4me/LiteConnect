import type { ApprovalMode, CommandClass, CommandClassification, SshMcpToolErrorCode } from './types'

export type PolicyDecision =
  | { allow: true }
  | { allow: false; code: SshMcpToolErrorCode; reason: string }

/**
 * Default is fail-closed for anything that can mutate or escalate.
 * High-risk (`forbidden`) commands use the same gate as destructive: the AI
 * sidebar always asks first, then calls with `auto` after the user allows.
 */
export const MCP_APPROVAL_MODES = ['deny-destructive', 'ask-destructive', 'auto'] as const

export function sanitizeMcpApprovalMode(value: unknown): ApprovalMode {
  if (value === 'auto' || value === 'ask-destructive' || value === 'deny-destructive') return value
  return 'deny-destructive'
}

/**
 * After the MCP client has asked the human and they agreed, retry with
 * `confirmed=true`. That only upgrades *ask* mode, and never lifts `forbidden`.
 */
export function approvalModeAfterClientConfirm(
  configured: ApprovalMode,
  confirmed: boolean,
  commandClass: CommandClass,
): ApprovalMode {
  if (!confirmed || configured !== 'ask-destructive') return configured
  if (commandClass === 'forbidden') return 'deny-destructive'
  return 'auto'
}

export function decideCommandPolicy(
  classification: CommandClassification,
  mode: ApprovalMode = 'deny-destructive',
): PolicyDecision {
  const cls = classification.class
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
      return (
        `Command needs the human operator to confirm in this MCP client (${cls || 'destructive'})${detail}. ` +
        'Ask them to approve the exact command, then retry the same tool with confirmed=true. ' +
        'Do not set confirmed=true unless they explicitly agreed.'
      )
    default:
      return reason || code
  }
}
