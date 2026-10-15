import type { AiWorkspaceTarget } from '../../../shared/aiWorkspace'
import { workspaceToolsForChat } from '../../../shared/aiWorkspacePrompt'
import type { SshMcpRuntime } from '../../mcp/runtime'
import { bindSessionArgs } from './sshToolChat'

const allowed = new Set(workspaceToolsForChat().map(tool => tool.function.name))
export function routeWorkspaceTool(name: string, raw: unknown, targets: AiWorkspaceTarget[], runtime: SshMcpRuntime) {
  if (!allowed.has(name)) throw new Error('SCOPE_DENIED: Tool is not available in this workspace')
  const args = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const target = targets.find(item => item.connectionId === args.connectionId)
  if (!target) throw new Error('SCOPE_DENIED: Specify a connectionId in this conversation scope')
  if (!runtime.hasSession(target.sessionId)) throw new Error('SCOPE_UNAVAILABLE: Selected server is disconnected')
  if (name === 'get_job' || name === 'cancel_job') {
    const job = typeof args.jobId === 'string' ? runtime.getJobResult(args.jobId) : undefined
    if (!job || job.sessionId !== target.sessionId) throw new Error('SCOPE_DENIED: Job does not belong to the specified server')
  }
  if (name.startsWith('pty_') && name !== 'pty_open' && name !== 'pty_list') {
    if (typeof args.ptyId !== 'string' || runtime.getPtySessionId(args.ptyId) !== target.sessionId) {
      throw new Error('SCOPE_DENIED: PTY does not belong to the specified server')
    }
  }
  const bound = bindSessionArgs(args, target.sessionId)
  delete bound.connectionId
  return { args: bound, target, label: `${target.name} (${target.username}@${target.host}:${target.port})` }
}

export async function callWorkspaceTool(runtime: SshMcpRuntime, name: string, args: Record<string, unknown>, opts: { approvalMode: 'auto'; signal: AbortSignal }) {
  // Global MCP listing tools intentionally ignore sessionId; scope their projection here.
  if (name === 'list_jobs' || name === 'pty_list') {
    const field = name === 'list_jobs' ? 'jobs' : 'ptys'
    const result = await runtime.call(name, {}, opts)
    if (result.isError) return result
    const rows = (result.structuredContent as Record<string, Array<{ sessionId: string }>>)?.[field] || []
    const structuredContent = { [field]: rows.filter(item => item.sessionId === args.sessionId) }
    return { isError: false, content: JSON.stringify(structuredContent), structuredContent }
  }
  return runtime.call(name, args, opts)
}
