export const AI_TOOL_PERMISSION_MODES = ['ask', 'readonly', 'auto'] as const
export type AiToolPermissionMode = (typeof AI_TOOL_PERMISSION_MODES)[number]
export const DEFAULT_AI_TOOL_PERMISSION: AiToolPermissionMode = 'ask'
export const AI_TOOL_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

// Legacy risk/status values remain readable in existing conversation history.
export type AiToolRisk = 'read' | 'write' | 'destructive' | 'privileged' | 'forbidden'
export type AiToolRunStatus = 'ask' | 'running' | 'done' | 'denied' | 'blocked' | 'reclassify'
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

export const AI_DECLARED_RISK_PROMPT_ZH = [
  '每次工具调用都必须在 JSON 参数中提供 risk 和 explanation，不能只在聊天正文中说明。',
  '- read（只读）：只查看，不改变文件、配置、进程或服务',
  '- write（修改）：会创建、改写、删除、移动，或改变进程/服务/配置',
  '- privileged（提权）：需要提升权限才能执行',
  'explanation 必须是 1–500 字符的一句简洁中文，直接说明本次操作的目的、目标及具体影响。不要添加“操作说明”“只读排查”等前缀，不要重复 risk 中的权限标签；涉及修改时说明影响，不包含密码或密钥。',
  '应用按你申报的 risk 和用户的权限设置决定是否执行；同时对 exec / service_control 的目标命令做一次独立判级。实际风险高于申报时会强制要求用户审批（只升不降），所以低报不会省掉审批，只会让这次调用被拦下来。你必须根据实际行为如实申报。',
  '需要审批时等待用户允许；被拒绝后不要换命令或改标签重复尝试。缺失或无效的 JSON 字段会导致本次不执行，请补全申请。',
].join('\n')

export const AI_DECLARED_RISK_PARAM_DESCRIPTION =
  'Required on every call. Declare read (inspect only, no state change), write (create/change/delete/move or change services/processes/config), or privileged (requires elevated privileges). The user permission mode is applied to this declaration, and exec/service_control targets are classified independently: an understated declaration is escalated to approval, never waived.'
export const AI_TOOL_EXPLANATION_DESCRIPTION =
  'Required, 1–500 characters. Write one concise Chinese sentence describing the action, purpose, target and concrete impact. Start directly with the action; omit headings such as “操作说明” or “只读排查” and do not repeat the risk label. State the impact of changes. Do not include passwords or secrets.'

export function formatAiRiskReclassifyContent(gate: Extract<AiToolGate, { action: 'reclassify' }>): string {
  return [
    gate.code + ': 未执行。' + gate.reason,
    '请补全同一工具调用的 JSON 参数：risk 必须为 read / write / privileged，explanation 必须是 1–500 字符的非空操作说明。',
    AI_DECLARED_RISK_PROMPT_ZH,
  ].join('\n')
}

/**
 * Validate the declaration, then apply the user's mode. This half trusts the
 * model; `applyCommandFloor` (electron/ai/commandFloor) is the half that does
 * not, and callers should compose the two.
 */
export function assessAiToolCall(_name: string, args: unknown, mode: AiToolPermissionMode = DEFAULT_AI_TOOL_PERMISSION): AiToolGate {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {}
  const risk = parseAiDeclaredRisk(input.risk)
  if (!risk) {
    return { action: 'reclassify', risk: 'write', code: 'RISK_REQUIRED', reason: '缺少有效的 risk 权限声明。' }
  }
  const explanation = typeof input.explanation === 'string' ? input.explanation.trim() : ''
  if (!explanation || explanation.length > AI_TOOL_EXPLANATION_MAX_CHARS || /[\0]/.test(explanation)) {
    return { action: 'reclassify', risk, code: 'EXPLANATION_REQUIRED', reason: 'explanation 必须是 1–500 字符的非空操作说明。' }
  }
  if (mode === 'readonly' && risk !== 'read') {
    return { action: 'deny', risk, code: 'READONLY_MODE', reason: explanation }
  }
  if (mode === 'auto' || risk === 'read') return { action: 'allow', risk, reason: explanation }
  return { action: 'ask', risk, reason: explanation }
}
