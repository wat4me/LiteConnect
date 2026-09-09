import { classifyCommand } from './mcp/classify'
import type { CommandClass } from './mcp/types'

export const AI_TOOL_PERMISSION_MODES = ['ask', 'readonly', 'auto'] as const
export type AiToolPermissionMode = (typeof AI_TOOL_PERMISSION_MODES)[number]
export const DEFAULT_AI_TOOL_PERMISSION: AiToolPermissionMode = 'ask'
export const AI_TOOL_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

export type AiToolRisk = 'read' | 'write' | 'destructive' | 'privileged' | 'forbidden'
export type AiToolRunStatus = 'ask' | 'running' | 'done' | 'denied' | 'blocked' | 'reclassify'

/** What the model must declare on exec / service_control / pty_write. */
export const AI_DECLARED_RISKS = ['read', 'write', 'privileged'] as const
export type AiDeclaredRisk = (typeof AI_DECLARED_RISKS)[number]

export const AI_DECLARED_RISK_TOOLS = new Set(['exec', 'service_control', 'pty_write'])

export type AiToolGate =
  | { action: 'allow'; risk: AiToolRisk; reason: string }
  | { action: 'ask'; risk: AiToolRisk; reason: string }
  | { action: 'deny'; risk: AiToolRisk; code: 'FORBIDDEN' | 'READONLY_MODE'; reason: string }
  | {
      action: 'reclassify'
      risk: AiToolRisk
      code: 'RISK_UNDERSTATED' | 'RISK_REQUIRED'
      reason: string
      declared?: AiDeclaredRisk
      expected: AiDeclaredRisk
    }

const INVENTORY_TOOLS = new Set([
  'list_connections',
  'list_groups',
  'list_sessions',
  'list_jobs',
  'get_job',
  'pty_list',
])

const READ_TOOLS = new Set([
  'read_file',
  'grep',
  'glob',
  'list_dir',
  'stat_path',
  'tail_file',
  'get_metrics',
  'pty_read',
])

const WRITE_TOOLS = new Set([
  'connect',
  'save_connection',
  'write_file',
  'upload_file',
  'download_file',
  'cancel_job',
  'pty_resize',
])

const DESTRUCTIVE_TOOLS = new Set(['disconnect', 'pty_open', 'pty_write', 'pty_close'])

export function isAiToolPermissionMode(value: unknown): value is AiToolPermissionMode {
  return typeof value === 'string' && (AI_TOOL_PERMISSION_MODES as readonly string[]).includes(value)
}

export function sanitizeAiToolPermission(raw: unknown): AiToolPermissionMode {
  if (raw === 'ask-write') return 'ask'
  return isAiToolPermissionMode(raw) ? raw : DEFAULT_AI_TOOL_PERMISSION
}

function classToRisk(cls: CommandClass): AiToolRisk {
  if (cls === 'read-only') return 'read'
  if (cls === 'safe') return 'write'
  if (cls === 'destructive') return 'destructive'
  if (cls === 'privileged') return 'privileged'
  return 'forbidden'
}

export function isAiDeclaredRisk(value: unknown): value is AiDeclaredRisk {
  return typeof value === 'string' && (AI_DECLARED_RISKS as readonly string[]).includes(value)
}

export function parseAiDeclaredRisk(raw: unknown): AiDeclaredRisk | undefined {
  return isAiDeclaredRisk(raw) ? raw : undefined
}

export function toolRequiresDeclaredRisk(name: string): boolean {
  return AI_DECLARED_RISK_TOOLS.has(name)
}

/** Collapse host risk onto the 3-level scale the model is allowed to declare. */
export function toDeclaredRisk(risk: AiToolRisk): AiDeclaredRisk {
  if (risk === 'read') return 'read'
  if (risk === 'privileged') return 'privileged'
  return 'write'
}

function declaredBand(risk: AiDeclaredRisk): number {
  if (risk === 'read') return 0
  if (risk === 'write') return 1
  return 2
}

function hostBand(risk: AiToolRisk): number {
  if (risk === 'read') return 0
  if (risk === 'write' || risk === 'destructive') return 1
  if (risk === 'privileged') return 2
  return 3
}

export function omitDeclaredRiskArg(args: Record<string, unknown>): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(args, 'risk')) return args
  const { risk: _risk, ...rest } = args
  return rest
}

/** Behavior classes only — no command names. Used in the system prompt and reject-retry copy. */
export const AI_DECLARED_RISK_PROMPT_ZH = [
  '调用 exec / service_control / pty_write 必须带 risk，按下面分级如实申报（只可多报，不可少报）：',
  '- read（只读）：只查看，不改变文件、配置、进程或服务',
  '- write（修改）：会创建、改写、删除、移动，或改变进程/服务/配置',
  '- privileged（提权）：需要提升权限才能执行',
  '少报会被拒绝，请用主机给出的级别重试。高危操作要等用户点「允许」后才会执行。',
].join('\n')

export const AI_DECLARED_RISK_PARAM_DESCRIPTION =
  'Required. Host risk: read = inspect only, no state change; write = create/change/delete/move, or change process/service/config; privileged = needs elevated privileges. Understating is rejected — retry with the host level. Overstating is allowed. High-risk operations wait for the user to allow them.'

export function formatAiRiskReclassifyContent(
  gate: Extract<AiToolGate, { action: 'reclassify' }>,
): string {
  if (gate.code === 'RISK_REQUIRED') {
    return [
      `RISK_REQUIRED: 未执行。exec / service_control / pty_write 必须带 risk（read | write | privileged）。`,
      `主机判定本次为 ${gate.expected}。请用同一调用重试，并设置 risk="${gate.expected}"。`,
      AI_DECLARED_RISK_PROMPT_ZH,
    ].join('\n')
  }
  return [
    `RISK_UNDERSTATED: 未执行。你声明为 ${gate.declared || 'read'}，主机判定为 ${gate.expected}（声明过低）。`,
    `请用同一条命令重新调用，并把 risk 设为 "${gate.expected}"。不要改用更低的 risk 绕过。`,
    AI_DECLARED_RISK_PROMPT_ZH,
  ].join('\n')
}

function asArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  return {}
}

export function describeAiToolRisk(
  name: string,
  args: unknown,
): { risk: AiToolRisk; reason: string; commandClass?: CommandClass } {
  const input = asArgs(args)
  if (name === 'exec') {
    const command = typeof input.command === 'string' ? input.command : ''
    const cls = classifyCommand(command)
    return { risk: classToRisk(cls.class), reason: cls.reason, commandClass: cls.class }
  }
  if (name === 'service_control') {
    const unit = typeof input.unit === 'string' ? input.unit.trim() : ''
    const action = typeof input.action === 'string' && input.action.trim() ? input.action.trim() : 'status'
    const command =
      action === 'status'
        ? `systemctl status --no-pager -- ${unit}`
        : `systemctl ${action} --no-pager -- ${unit}`
    const cls = classifyCommand(command)
    return { risk: classToRisk(cls.class), reason: cls.reason, commandClass: cls.class }
  }
  if (name === 'pty_write' && typeof input.data === 'string' && input.data.trim()) {
    const cls = classifyCommand(input.data)
    if (cls.class === 'forbidden' || cls.class === 'privileged' || cls.class === 'destructive') {
      return { risk: classToRisk(cls.class), reason: cls.reason, commandClass: cls.class }
    }
  }
  if (DESTRUCTIVE_TOOLS.has(name)) return { risk: 'destructive', reason: name }
  if (WRITE_TOOLS.has(name)) return { risk: 'write', reason: name }
  if (INVENTORY_TOOLS.has(name) || READ_TOOLS.has(name)) return { risk: 'read', reason: name }
  return { risk: 'write', reason: name }
}

export function assessAiToolCall(
  name: string,
  args: unknown,
  mode: AiToolPermissionMode = DEFAULT_AI_TOOL_PERMISSION,
): AiToolGate {
  const input = asArgs(args)
  const described = describeAiToolRisk(name, args)
  const { risk, reason } = described
  if (risk === 'forbidden') {
    if (reason === 'empty command') {
      return { action: 'deny', risk, code: 'FORBIDDEN', reason }
    }
    if (mode === 'readonly') {
      return { action: 'deny', risk, code: 'READONLY_MODE', reason: 'write tools are disabled in read-only mode' }
    }
    return { action: 'ask', risk, reason }
  }

  if (toolRequiresDeclaredRisk(name)) {
    const expected = toDeclaredRisk(risk)
    const declared = parseAiDeclaredRisk(input.risk)
    if (!declared) {
      return {
        action: 'reclassify',
        risk,
        code: 'RISK_REQUIRED',
        reason: 'declared risk is required',
        expected,
      }
    }
    if (declaredBand(declared) < hostBand(risk)) {
      return {
        action: 'reclassify',
        risk,
        code: 'RISK_UNDERSTATED',
        reason: `declared ${declared}, host ${expected}`,
        declared,
        expected,
      }
    }
  }

  const isRead = risk === 'read'
  switch (mode) {
    case 'readonly':
      if (isRead) return { action: 'allow', risk, reason }
      return { action: 'deny', risk, code: 'READONLY_MODE', reason: 'write tools are disabled in read-only mode' }
    case 'auto':
      return { action: 'allow', risk, reason }
    case 'ask':
    default:
      if (isRead || INVENTORY_TOOLS.has(name)) return { action: 'allow', risk, reason }
      return { action: 'ask', risk, reason }
  }
}
