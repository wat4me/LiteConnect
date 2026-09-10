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
  'explanation 必须是 1–500 字符的中文说明：用普通用户能理解的语言解释操作做什么、为什么需要、涉及哪些文件或服务，以及可能影响；没有修改也要说明只是查询。不要在说明中重复密码或密钥。',
  '应用按照你声明的 risk 和用户的权限设置决定是否执行，不会按命令关键词替你重新判级。你必须根据实际行为如实申报，不得为了避开审批降低级别。',
  '需要审批时等待用户允许；被拒绝后不要换命令或改标签重复尝试。缺失或无效的 JSON 字段会导致本次不执行，请补全申请。',
].join('\n')

export const AI_DECLARED_RISK_PARAM_DESCRIPTION =
  'Required on every call. Declare read (inspect only, no state change), write (create/change/delete/move or change services/processes/config), or privileged (requires elevated privileges). The application uses this declaration and the user permission mode; do not lower it to avoid approval.'
export const AI_TOOL_EXPLANATION_DESCRIPTION =
  'Required Chinese explanation for the user, 1–500 characters. Explain what this operation does, why it is needed, the affected files/services and expected impact. For read-only operations state that it only inspects. Do not repeat passwords or secrets.'

export function formatAiRiskReclassifyContent(gate: Extract<AiToolGate, { action: 'reclassify' }>): string {
  return [
    gate.code + ': 未执行。' + gate.reason,
    '请补全同一工具调用的 JSON 参数：risk 必须为 read / write / privileged，explanation 必须是 1–500 字符的非空操作说明。',
    AI_DECLARED_RISK_PROMPT_ZH,
  ].join('\n')
}

/** Validate the declaration, then apply the user's mode. No command-content classification. */
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
