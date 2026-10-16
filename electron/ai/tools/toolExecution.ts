import type { AiWorkspaceTarget } from '../../../shared/aiWorkspace'
import type { AiChatMessage, AiChatStreamPayload, AiFunctionToolCall, AiToolRun, AiToolPermissionMode, AiToolRunStatus } from '../../../shared/types/ai'
import { assessAiToolCall, formatAiRiskReclassifyContent, omitDeclaredRiskArg } from '../../../shared/aiToolPolicy'
import { serializeToolRunForHistory } from '../../../shared/aiToolRunDisplay'
import { clampToolResultForModel } from '../../../shared/mcp/toolResultClamp'
import type { SshMcpRuntime } from '../../mcp/runtime'
import { routeWorkspaceTool, callWorkspaceTool } from './workspaceToolRouting'
import { bindSessionArgs, parseToolCallArguments } from './sshToolChat'
import { applyCommandFloor, commandContentRisk } from './commandFloor'
import { buildFileChangeDiffPreview } from './toolDiffPreview'
import { waitForToolApproval } from './streamControl'
import { AI_QUESTION_TOOL } from '../../../shared/aiQuestions'
import { executeUserQuestion } from './userQuestion'

export type AiToolApprovalObserver = (input: { requestId: string; callId: string; sessionId: string; toolName: string }) => void | (() => void)
export type AiToolExecutionContext = {
  requestId: string
  boundSessionId: string
  workspaceTargets?: AiWorkspaceTarget[]
  sshMcpRuntime: SshMcpRuntime
  signal: AbortSignal
  send: (payload: AiChatStreamPayload) => void
  getToolPermission: () => AiToolPermissionMode
  checkpoint?: () => Promise<void>
  foregroundOnly?: boolean
  allowQuestions?: boolean
  onToolApprovalRequested?: AiToolApprovalObserver
  onBackgroundJobsStarted?: (jobIds: string[]) => void
  onBackgroundJobCollected?: (jobId: string) => void
}

/** Policy/routing/execution only; conversation history remains with the caller. */
export async function executeAiToolCall(call: AiFunctionToolCall, opts: AiToolExecutionContext): Promise<{ run: AiToolRun; message: AiChatMessage } | undefined> {
  const { requestId, boundSessionId, workspaceTargets, sshMcpRuntime, signal, send } = opts
  if (signal.aborted) return undefined
  if (call.function.name === AI_QUESTION_TOOL) return executeUserQuestion(call, opts)
  const rawArgs = parseToolCallArguments(call.function.arguments)
  let targetLabel: string | undefined
  let boundArgs: Record<string, unknown>
  try {
    if (workspaceTargets) {
      const routed = routeWorkspaceTool(call.function.name, rawArgs, workspaceTargets, sshMcpRuntime)
      boundArgs = routed.args
      targetLabel = routed.label
    } else boundArgs = bindSessionArgs(rawArgs, boundSessionId)
  } catch (error) {
    const content = error instanceof Error ? error.message : String(error)
    const run: AiToolRun = { id: call.id, name: call.function.name, args: call.function.arguments || '{}', content, isError: true, status: 'blocked' }
    send({ type: 'tool', value: { ...run, phase: 'blocked' } })
    return { run, message: { role: 'tool', toolCallId: call.id, content } }
  }
  const executeTool = async () => {
    try {
      return await (workspaceTargets
        ? callWorkspaceTool(sshMcpRuntime, call.function.name, mcpArgs, { approvalMode: 'auto', signal })
        : sshMcpRuntime.call(call.function.name, mcpArgs, { approvalMode: 'auto', signal }))
    } catch (error) {
      if (signal.aborted) throw error
      const message = error instanceof Error ? error.message : String(error)
      return {
        isError: true,
        content: `TOOL_RESULT_UNKNOWN: ${message}\nThe tool call failed unexpectedly. The remote operation may have run or partially completed. Check the current state before retrying; do not assume rollback or automatically repeat a write.`,
        structuredContent: { code: 'TOOL_RESULT_UNKNOWN', message },
      }
    }
  }
  if (opts.foregroundOnly && call.function.name === 'exec') boundArgs.background = false
  // The declaration decides whether to ask; the command classifier is an
  // escalate-only floor on top of it, so a call labelled `read` that is
  // really a delete cannot ride through `auto` mode unexamined.
  const toolPermission = opts.getToolPermission()
  const gate = applyCommandFloor(
    assessAiToolCall(call.function.name, boundArgs, toolPermission),
    commandContentRisk(call.function.name, boundArgs),
    toolPermission,
  )
  const mcpArgs = omitDeclaredRiskArg(boundArgs)
  const callArgs = opts.foregroundOnly && call.function.name === 'exec' ? JSON.stringify(boundArgs) : call.function.arguments || '{}'
  // Approval should not be blind: diff the file we are about to rewrite.
  // edit_file yields a small focused diff; write_file a whole-file one.
  const needsDiffPreview = gate.action === 'ask' &&
    (call.function.name === 'write_file' || call.function.name === 'edit_file')
  if (needsDiffPreview) send({ type: 'model-status', value: 'tool-prepare' })
  const diffPreview = needsDiffPreview
    ? await buildFileChangeDiffPreview(sshMcpRuntime, call.function.name, mcpArgs)
    : undefined
  send({
    type: 'tool',
    value: {
      phase:
        gate.action === 'ask'
          ? 'ask'
          : gate.action === 'deny'
            ? 'blocked'
            : gate.action === 'reclassify'
              ? 'reclassify'
              : 'running',
      id: call.id,
      name: call.function.name,
      args: callArgs,
      risk: gate.risk,
      target: targetLabel,
      reason: gate.reason,
      ...(diffPreview
        ? { diffSummary: diffPreview.summary, diffPreview: diffPreview.diff }
        : {}),
    },
  })

  const approval = gate.action === 'ask'
    ? waitForToolApproval(requestId, call.id, signal)
    : undefined
  if (approval && opts.onToolApprovalRequested) {
    try {
      const closeNotification = opts.onToolApprovalRequested({
        requestId,
        callId: call.id,
        sessionId: String(boundArgs.sessionId || boundSessionId),
        toolName: call.function.name,
      })
      if (closeNotification) {
        void approval.finally(closeNotification)
      }
    } catch (err) {
      console.warn('[AI Approval Notification]', err)
    }
  }
  await opts.checkpoint?.()
  if (signal.aborted) return undefined
  let result: { isError: boolean; content: string; structuredContent?: unknown }
  let status: AiToolRunStatus = 'done'
  if (gate.action === 'reclassify') {
    status = 'reclassify'
    result = {
      isError: true,
      content: formatAiRiskReclassifyContent(gate),
      structuredContent: {
        code: gate.code,
        message: gate.reason,
      },
    }
  } else if (gate.action === 'deny') {
    status = 'blocked'
    result = {
      isError: true,
      content: `${gate.code}: 当前设置仅允许申报为 read 的操作；本次申报为 ${gate.risk}，未执行。`,
      structuredContent: { code: gate.code, message: gate.reason },
    }
  } else if (gate.action === 'ask') {
    const approved = await approval
    if (!approved) {
      status = 'denied'
      result = {
        isError: true,
        content: signal.aborted
          ? 'USER_DENIED: The request was cancelled.'
          : 'USER_DENIED: The user refused this tool call.',
      }
    } else {
      send({
        type: 'tool',
        value: {
          phase: 'running',
          id: call.id,
          name: call.function.name,
          args: callArgs,
          risk: gate.risk,
          target: targetLabel,
          reason: gate.reason,
        },
      })
      await opts.checkpoint?.()
      if (signal.aborted) return undefined
      result = await executeTool()
    }
  } else {
    result = await executeTool()
  }

  let jobIds: string[] | undefined
  if (call.function.name === 'exec' && !result.isError && mcpArgs.background === true) {
    const payload = result.structuredContent as { jobId?: string; jobs?: { jobId: string }[] }
    const ids = payload?.jobId ? [payload.jobId] : (payload?.jobs || []).map(job => job.jobId)
    jobIds = ids
    opts.onBackgroundJobsStarted?.(ids)
  }
  if (call.function.name === 'get_job' && !result.isError) {
    const job = result.structuredContent as { jobId?: string; status?: string }
    if (job?.jobId && job.status && job.status !== 'running') opts.onBackgroundJobCollected?.(job.jobId)
  }
  if (signal.aborted) return undefined

  result = clampToolResultForModel(result)

  const stored = serializeToolRunForHistory({
    name: call.function.name,
    args: callArgs,
    content: result.content,
    isError: result.isError,
    structured: result.structuredContent,
  })
  const run: AiToolRun = {
    id: call.id,
    name: call.function.name,
    args: stored.args,
    content: stored.content,
    isError: result.isError,
    status,
    risk: gate.risk,
    jobIds,
    target: targetLabel,
    reason: gate.reason,
  }
  send({
    type: 'tool',
    value: {
      phase: status === 'done' ? 'done' : status,
      id: run.id,
      name: run.name,
      args: run.args,
      content: run.content,
      isError: run.isError,
      risk: run.risk,
      jobIds: run.jobIds,
      target: run.target,
      reason: run.reason,
      status: run.status,
    },
  })
  return { run, message: { role: 'tool', toolCallId: call.id, content: result.content } }
}
