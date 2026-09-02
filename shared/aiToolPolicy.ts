import { classifyCommand } from './mcp/classify'
import type { CommandClass } from './mcp/types'

export const AI_TOOL_PERMISSION_MODES = ['ask', 'ask-write', 'readonly', 'auto'] as const
export type AiToolPermissionMode = (typeof AI_TOOL_PERMISSION_MODES)[number]
export const DEFAULT_AI_TOOL_PERMISSION: AiToolPermissionMode = 'ask'
export const AI_TOOL_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

export type AiToolRisk = 'read' | 'write' | 'destructive' | 'privileged' | 'forbidden'
export type AiToolRunStatus = 'ask' | 'running' | 'done' | 'denied' | 'blocked'

export type AiToolGate =
  | { action: 'allow'; risk: AiToolRisk; reason: string }
  | { action: 'ask'; risk: AiToolRisk; reason: string }
  | { action: 'deny'; risk: AiToolRisk; code: 'FORBIDDEN' | 'READONLY_MODE'; reason: string }

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
  'list_dir',
  'stat_path',
  'tail_file',
  'get_metrics',
  'pty_read',
])

const WRITE_TOOLS = new Set([
  'connect',
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
  return isAiToolPermissionMode(raw) ? raw : DEFAULT_AI_TOOL_PERMISSION
}

function classToRisk(cls: CommandClass): AiToolRisk {
  if (cls === 'read-only' || cls === 'safe') return 'read'
  if (cls === 'destructive') return 'destructive'
  if (cls === 'privileged') return 'privileged'
  return 'forbidden'
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
  const described = describeAiToolRisk(name, args)
  const { risk, reason } = described
  if (risk === 'forbidden') {
    return { action: 'deny', risk, code: 'FORBIDDEN', reason }
  }
  const isRead = risk === 'read'
  switch (mode) {
    case 'readonly':
      if (isRead) return { action: 'allow', risk, reason }
      return { action: 'deny', risk, code: 'READONLY_MODE', reason: 'write tools are disabled in read-only mode' }
    case 'ask-write':
      if (isRead) return { action: 'allow', risk, reason }
      return { action: 'ask', risk, reason }
    case 'auto':
      return { action: 'allow', risk, reason }
    case 'ask':
    default:
      if (INVENTORY_TOOLS.has(name)) return { action: 'allow', risk, reason }
      return { action: 'ask', risk, reason }
  }
}
