import { sharedT, type SharedTranslate } from './i18n'

/** Stable boundary between model-authored explanations and application notices. */
export const AI_TOOL_REASON_SEPARATOR = '\n[LiteConnect policy] '

export const AI_TOOL_PERMISSION_MODES = ['ask', 'readonly', 'auto'] as const
export type AiToolPermissionMode = (typeof AI_TOOL_PERMISSION_MODES)[number]
export const DEFAULT_AI_TOOL_PERMISSION: AiToolPermissionMode = 'ask'
export const AI_TOOL_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

// Legacy risk/status values remain readable in existing conversation history.
export type AiToolRisk = 'read' | 'write' | 'destructive' | 'privileged' | 'forbidden'
export type AiToolRunStatus = 'ask' | 'question' | 'running' | 'done' | 'denied' | 'blocked' | 'reclassify' | 'aborted'
export const AI_DECLARED_RISKS = ['read', 'write', 'privileged'] as const
export type AiDeclaredRisk = (typeof AI_DECLARED_RISKS)[number]
export const AI_TOOL_EXPLANATION_MAX_CHARS = 500

export type AiToolGate =
  | { action: 'allow'; risk: AiDeclaredRisk; reason: string }
  | { action: 'ask'; risk: AiDeclaredRisk; reason: string }
  | { action: 'deny'; risk: AiDeclaredRisk; code: 'READONLY_MODE'; reason: string }
  // The existing stream status is retained for malformed permission requests only.
  | { action: 'reclassify'; risk: AiDeclaredRisk; code: 'RISK_REQUIRED' | 'EXPLANATION_REQUIRED'; reason: string }

export function isAiToolPermissionMode(value: unknown): value is AiToolPermissionMode {
  return typeof value === 'string' && (AI_TOOL_PERMISSION_MODES as readonly string[]).includes(value)
}

export function sanitizeAiToolPermission(raw: unknown): AiToolPermissionMode {
  if (raw === 'ask-write') return 'ask'
  return isAiToolPermissionMode(raw) ? raw : DEFAULT_AI_TOOL_PERMISSION
}

export function isAiDeclaredRisk(value: unknown): value is AiDeclaredRisk {
  return typeof value === 'string' && (AI_DECLARED_RISKS as readonly string[]).includes(value)
}

export function parseAiDeclaredRisk(raw: unknown): AiDeclaredRisk | undefined {
  return isAiDeclaredRisk(raw) ? raw : undefined
}

/** Permission metadata is for the application, never a remote tool argument. */
export function omitDeclaredRiskArg(args: Record<string, unknown>): Record<string, unknown> {
  const { risk: _risk, explanation: _explanation, ...rest } = args
  return rest
}

export const AI_DECLARED_RISK_PROMPT_ZH = sharedT('sharedText.promptRiskDeclaration')

export const AI_DECLARED_RISK_PARAM_DESCRIPTION =
  'Declare actual risk; follow the shared system permission rules.'
export const AI_TOOL_EXPLANATION_DESCRIPTION =
  'Action, purpose, target and impact; UI language; no secrets.'

export function formatAiRiskReclassifyContent(gate: Extract<AiToolGate, { action: 'reclassify' }>, translate: SharedTranslate = sharedT): string {
  return [
    translate('sharedText.reclassifyNotExecuted', { code: gate.code, reason: gate.reason }),
    translate('sharedText.reclassifyInstructions'),
    translate('sharedText.promptRiskDeclaration'),
  ].join('\n')
}

/**
 * Validate the declaration, then apply the user's mode. This half trusts the
 * model; `applyCommandFloor` (electron/ai/commandFloor) is the half that does
 * not, and callers should compose the two.
 */
export function assessAiToolCall(_name: string, args: unknown, mode: AiToolPermissionMode = DEFAULT_AI_TOOL_PERMISSION, translate: SharedTranslate = sharedT): AiToolGate {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {}
  const risk = parseAiDeclaredRisk(input.risk)
  if (!risk) {
    return { action: 'reclassify', risk: 'write', code: 'RISK_REQUIRED', reason: translate('sharedText.riskRequired') }
  }
  const explanation = typeof input.explanation === 'string' ? input.explanation.trim() : ''
  if (!explanation || explanation.length > AI_TOOL_EXPLANATION_MAX_CHARS || /[\0]/.test(explanation)) {
    return { action: 'reclassify', risk, code: 'EXPLANATION_REQUIRED', reason: translate('sharedText.explanationRequired') }
  }
  if (mode === 'readonly' && risk !== 'read') {
    return { action: 'deny', risk, code: 'READONLY_MODE', reason: explanation }
  }
  if (mode === 'auto' || risk === 'read') return { action: 'allow', risk, reason: explanation }
  return { action: 'ask', risk, reason: explanation }
}
