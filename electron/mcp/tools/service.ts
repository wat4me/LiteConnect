import { MCP_SERVICE_UNIT_MAX } from '../../../shared/mcp/limits'
import { classifyCommand } from '../../../shared/mcp/classify'
import type { ApprovalMode, SshMcpToolResult } from '../../../shared/mcp/types'
import { clampTimeout } from '../args'
import type { McpRuntimeHost } from '../runtimeHost'

export async function serviceControl(
  host: McpRuntimeHost,
  input: Record<string, unknown>,
  approvalMode: ApprovalMode,
): Promise<SshMcpToolResult> {
  const session = host.requireSession(input.sessionId)
  const unit = typeof input.unit === 'string' ? input.unit.trim() : ''
  if (!unit || unit.length > MCP_SERVICE_UNIT_MAX || !/^[A-Za-z0-9:._@-]+$/.test(unit)) {
    return host.error('INVALID_UNIT', 'unit must match [A-Za-z0-9:._@-] and be at most 128 characters')
  }
  const actionRaw = typeof input.action === 'string' ? input.action.trim() : 'status'
  const action = actionRaw as 'status' | 'start' | 'stop' | 'restart' | 'reload'
  if (!['status', 'start', 'stop', 'restart', 'reload'].includes(action)) {
    return host.error('INVALID_ARGUMENTS', 'action must be status, start, stop, restart, or reload')
  }
  const command =
    action === 'status'
      ? `systemctl status --no-pager -n 25 -- ${unit}`
      : `systemctl ${action} --no-pager -- ${unit}`
  const classification = classifyCommand(command)
  const denied = await host.ensureCommandAllowed(classification, session.sessionId, command, approvalMode)
  if (denied) return denied
  const snap = host.ssh.getSessionSnapshot(session.sessionId)
  const result = await host.runForegroundExec(
    {
      sessionId: session.sessionId,
      generation: session.generation,
      connectionId: snap?.connectionId || '',
      connectionName: snap?.connectionName || '',
    },
    command,
    classification,
    clampTimeout(undefined),
  )
  return host.ok({ ...(result as object), unit, action })
}
