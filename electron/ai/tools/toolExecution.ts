import { t } from '../../i18n'
import type { AiChatMessage, AiFunctionToolCall, AiToolRun, AiToolRunStatus } from '../../../shared/types/ai'
import { assessAiToolCall, formatAiRiskReclassifyContent, omitDeclaredRiskArg } from '../../../shared/aiToolPolicy'
import { serializeToolRunForHistory } from '../../../shared/aiToolRunDisplay'
import { clampToolResultForModel } from '../../../shared/mcp/toolResultClamp'
import { routeWorkspaceTool, callWorkspaceTool } from './workspaceToolRouting'
import { bindSessionArgs, parseToolCallArguments } from './sshToolChat'
import { applyCommandFloor, commandContentRisk } from './commandFloor'
import { buildFileChangeDiffPreview } from './toolDiffPreview'
import { waitForToolApproval } from './streamControl'
import { AI_QUESTION_TOOL } from '../../../shared/aiQuestions'
import { executeUserQuestion } from './userQuestion'
import { AI_LOAD_TOOLS, parseAiToolGroupRequest } from '../../../shared/aiToolCatalog'
import type { AiToolExecutionContext } from './toolExecutionContext'
import { isKnowledgeTool } from '../../../shared/aiKnowledge'
import { classifyCommand, validateMcpCommand } from '../../../shared/mcp/classify'
import { MCP_SCHEDULE_MAX_DELAY_MS, MCP_SCHEDULE_MIN_DELAY_MS, MCP_SCHEDULE_NOTE_MAX_CHARS } from '../../../shared/mcp/limits'
import { clampJobTimeout, parseStdin } from '../../mcp/args'
import { formatLocalDateTime, parseLocalDateTime } from '../../../shared/localTime'

const SCHEDULE_FAILURES: Record<string, string> = {
  SCHEDULE_LIMIT: 'Too many scheduled commands are pending; wait for some to run or cancel them with cancel_job.',
  SCHEDULE_DUPLICATE: 'The same command is already scheduled for this conversation.',
  SCHEDULE_UNAVAILABLE: 'Scheduled execution is not available in this conversation. Run the command now or ask the user to check later.',
  SESSION_NOT_FOUND: 'The SSH session is no longer open, so nothing could be scheduled.',
  INVALID_SCHEDULE_TIME: 'startAt could not be read as a time. Pass "YYYY-MM-DD HH:mm" with the date included.',
}

/** Policy/routing/execution only; conversation history remains with the caller. */
export async function executeAiToolCall(call: AiFunctionToolCall, opts: AiToolExecutionContext): Promise<{ run: AiToolRun; message: AiChatMessage } | undefined> {
  const { requestId, boundSessionId, workspaceTargets, sshMcpRuntime, signal, send } = opts
  if (signal.aborted) return undefined
  if (call.function.name === AI_QUESTION_TOOL) return executeUserQuestion(call, opts)
  const localResult = (content: string, isError: boolean, status: AiToolRunStatus = 'done') => {
    const run: AiToolRun = { id: call.id, name: call.function.name, args: call.function.arguments, content, isError, status }
    send({ type: 'tool', value: { ...run, phase: status } })
    return { run, message: { role: 'tool' as const, toolCallId: call.id, content } }
  }
  if (opts.availableTools && !opts.availableTools.has(call.function.name)) {
    return localResult('TOOL_NOT_AVAILABLE: This tool is not loaded. Use the advertised load_tools groups for optional capabilities; use exec for ordinary system commands. No operation was executed.', true, 'blocked')
  }
  const rawArgs = parseToolCallArguments(call.function.arguments)
  if (call.function.name === AI_LOAD_TOOLS) {
    const groups = parseAiToolGroupRequest((rawArgs as Record<string, unknown>)?.groups)
    if (!groups) return localResult('INVALID_TOOL_GROUPS: groups must be a nonempty array containing only file_transfer, interactive_terminal or job_overview. No tools were loaded.', true)
    if (!opts.loadTools) return localResult('TOOL_LOADING_UNAVAILABLE: Tool loading is unavailable in this execution.', true)
    return localResult(JSON.stringify({ ...opts.loadTools(groups), notice: 'Tools are available in the next request. Loading performed no remote operation and granted no approval. Plan the next operation using the actual loaded schemas.' }), false)
  }
  let targetLabel: string | undefined
  let boundArgs: Record<string, unknown>
  try {
    if (isKnowledgeTool(call.function.name)) {
      boundArgs = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs as Record<string, unknown> : {}
      if (!opts.knowledge) throw new Error('KNOWLEDGE_UNAVAILABLE')
      const selected = workspaceTargets?.find(item => item.connectionId === boundArgs.connectionId) || (workspaceTargets?.length === 1 && boundArgs.connectionId === undefined && boundArgs.groupId === undefined ? workspaceTargets[0] : undefined)
      targetLabel = opts.knowledge.targetLabel?.(boundArgs) || selected?.name
    } else if (workspaceTargets) {
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
      if (isKnowledgeTool(call.function.name)) return await opts.knowledge!.call(call.function.name, mcpArgs, signal)
      return await (workspaceTargets
        ? callWorkspaceTool(sshMcpRuntime, call.function.name, mcpArgs, { approvalMode: 'auto', signal, transferContext: opts.transferContext })
        : sshMcpRuntime.call(call.function.name, mcpArgs, { approvalMode: 'auto', signal, transferContext: opts.transferContext }))
    } catch (error) {
      if (signal.aborted) throw error
      const message = error instanceof Error ? error.message : String(error)
      return {
        isError: true,
        content: `TOOL_RESULT_UNKNOWN: ${message}\n${t('notice.toolResultUnknown')}`,
        structuredContent: { code: 'TOOL_RESULT_UNKNOWN', message },
      }
    }
  }
  if (opts.foregroundOnly && call.function.name === 'exec') boundArgs.background = false
  // A delayed exec is approved like an immediate one, then registered instead of run.
  const scheduling = call.function.name === 'exec' && (boundArgs.startAfterMs !== undefined || boundArgs.startAt !== undefined) && !opts.foregroundOnly
  const scheduleExec = async (): Promise<{ isError: boolean; content: string; structuredContent?: unknown }> => {
    const failure = (code: string, message: string) => ({ isError: true, content: `${code}: ${message}`, structuredContent: { code, message } })
    if (!opts.scheduleBackgroundJob) return failure('SCHEDULE_UNAVAILABLE', SCHEDULE_FAILURES.SCHEDULE_UNAVAILABLE)
    const now = Date.now()
    let delay = boundArgs.startAfterMs
    if (delay !== undefined && boundArgs.startAt !== undefined) return failure('INVALID_ARGUMENTS', 'Pass either startAfterMs or startAt, not both.')
    if (boundArgs.startAt !== undefined) {
      const dueAt = typeof boundArgs.startAt === 'string' ? parseLocalDateTime(boundArgs.startAt) : undefined
      if (dueAt === undefined) return failure('INVALID_SCHEDULE_TIME', `startAt was not a readable time; use "YYYY-MM-DD HH:mm" local time or ISO 8601 with an offset. Now: ${formatLocalDateTime(now)}.`)
      delay = dueAt - now
    }
    if (typeof delay !== 'number' || !Number.isInteger(delay) || delay < MCP_SCHEDULE_MIN_DELAY_MS || delay > MCP_SCHEDULE_MAX_DELAY_MS) {
      const requested = typeof delay === 'number' && Number.isFinite(delay) ? formatLocalDateTime(now + delay) : 'unknown'
      return failure('INVALID_SCHEDULE_DELAY', `The start time must be 1 minute to 24 hours ahead. Now: ${formatLocalDateTime(now)}; requested start: ${requested}.`)
    }
    if (boundArgs.background !== true) return failure('INVALID_ARGUMENTS', 'startAfterMs requires background=true.')
    if (boundArgs.sessionIds !== undefined || boundArgs.group !== undefined) return failure('INVALID_ARGUMENTS', 'startAfterMs cannot be combined with sessionIds or group.')
    const validated = validateMcpCommand(boundArgs.command)
    if (!validated.ok) return failure('INVALID_COMMAND', validated.reason)
    const classification = classifyCommand(validated.command)
    if (classification.class === 'forbidden') return failure('COMMAND_FORBIDDEN', 'This command is denied by policy and cannot be scheduled.')
    const stdin = parseStdin(boundArgs.stdin)
    if (stdin === false) return failure('INVALID_ARGUMENTS', 'stdin is too long for a scheduled command.')
    const note = typeof boundArgs.note === 'string' ? boundArgs.note.replace(/\s+/g, ' ').trim().slice(0, MCP_SCHEDULE_NOTE_MAX_CHARS) : ''
    const sessionId = String(boundArgs.sessionId || boundSessionId)
    try {
      const scheduled = await opts.scheduleBackgroundJob({
        sessionId, command: validated.command, stdin: stdin || undefined, jobTimeoutMs: clampJobTimeout(boundArgs.jobTimeoutMs),
        startAfterMs: delay, note: note || undefined, risk: gate.risk, class: classification.class,
      })
      const payload = {
        jobId: scheduled.jobId, sessionId, command: validated.command, status: 'scheduled' as const,
        dueAt: scheduled.dueAt, dueAtLocal: formatLocalDateTime(scheduled.dueAt), scheduledAtLocal: formatLocalDateTime(now), startAfterMs: delay,
        ...(note ? { note } : {}),
        notice: `Scheduled, not executed. It starts at ${formatLocalDateTime(scheduled.dueAt)}; tell the user that local time. The result is delivered later as a background-task completion; do not poll get_job or wait for it. Cancel with cancel_job before it starts.`,
      }
      return { isError: false, content: JSON.stringify(payload, null, 2), structuredContent: payload }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = /^[A-Z_]+$/.test(message) ? message : 'SCHEDULE_FAILED'
      return failure(code, SCHEDULE_FAILURES[code] || message)
    }
  }
  // The declaration decides whether to ask; the command classifier is an
  // escalate-only floor on top of it, so a call labelled `read` that is
  // really a delete cannot ride through `auto` mode unexamined.
  const toolPermission = opts.getToolPermission()
  const gate = applyCommandFloor(
    assessAiToolCall(call.function.name, call.function.name === 'knowledge_save' && boundArgs.risk === 'read' ? { ...boundArgs, risk: 'write' } : boundArgs, toolPermission, t),
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
      content: formatAiRiskReclassifyContent(gate, t),
      structuredContent: {
        code: gate.code,
        message: gate.reason,
      },
    }
  } else if (gate.action === 'deny') {
    status = 'blocked'
    result = {
      isError: true,
      content: t('notice.toolReadonlyDenied', { code: gate.code, risk: gate.risk }),
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
      result = await (scheduling ? scheduleExec() : executeTool())
    }
  } else {
    result = await (scheduling ? scheduleExec() : executeTool())
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

  result = clampToolResultForModel(result, t)

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
