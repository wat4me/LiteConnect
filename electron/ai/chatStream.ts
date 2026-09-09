import type { IpcMainInvokeEvent } from 'electron'
import {
  isContextLengthError,
  resolveContextWindowTokens,
} from '../../shared/aiContext'
import {
  accumulateToolCallDeltas,
  bindSessionArgs,
  looksLikeToolsUnsupported,
  MAX_SSH_TOOL_ROUNDS,
  parseToolCallArguments,
  sshToolsForChat,
  sanitizeTrackedCwd,
  sshToolSystemAddendum,
  type AccumulatedToolCall,
} from './sshToolChat'
import { serializeToolRunForHistory } from '../../shared/aiToolRunDisplay'
import { clampToolResultForModel } from '../../shared/mcp/toolResultClamp'
import {
  AI_TOOL_APPROVAL_TIMEOUT_MS,
  assessAiToolCall,
  formatAiRiskReclassifyContent,
  omitDeclaredRiskArg,
  sanitizeAiToolPermission,
  type AiToolPermissionMode,
  type AiToolRunStatus,
} from '../../shared/aiToolPolicy'
import { appendFinalAssistantTurn } from '../../shared/aiMessages'
import type { AiChatMessage, AiResolvedConfig, AiToolRun } from '../../shared/types/ai'
import type { SshMcpRuntime } from '../mcp/runtime'
import { isValidUUID } from '../utils/validation'
import {
  extractAiReasoningFromChoice,
  extractAiUsage,
  getAiChatCompletionsUrl,
  normalizeAiContent,
  packRequestMessages,
  readAiStream,
  readHttpErrorMessage,
  toApiChatMessages,
  validateAiMessages,
} from './providerHttp'

const activeAiStreams = new Map<string, AbortController>()

type PendingToolApproval = { finish: (approved: boolean) => void }
const pendingToolApprovals = new Map<string, PendingToolApproval>()

function toolApprovalKey(requestId: string, callId: string): string {
  return `${requestId}::${callId}`
}

function waitForToolApproval(requestId: string, callId: string, signal: AbortSignal): Promise<boolean> {
  const key = toolApprovalKey(requestId, callId)
  return new Promise((resolve) => {
    let settled = false
    const finish = (approved: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      pendingToolApprovals.delete(key)
      resolve(approved)
    }
    const onAbort = () => finish(false)
    const timer = setTimeout(() => finish(false), AI_TOOL_APPROVAL_TIMEOUT_MS)
    pendingToolApprovals.set(key, { finish })
    signal.addEventListener('abort', onAbort)
    if (signal.aborted) finish(false)
  })
}

export function abortAiChatStream(requestId: string): boolean {
  if (!requestId || typeof requestId !== 'string') return false
  const controller = activeAiStreams.get(requestId)
  if (!controller) return false
  controller.abort()
  activeAiStreams.delete(requestId)
  return true
}

export function resolveToolApproval(requestId: string, callId: string, approved: boolean): boolean {
  if (typeof requestId !== 'string' || typeof callId !== 'string') return false
  const pending = pendingToolApprovals.get(toolApprovalKey(requestId, callId))
  if (!pending) return false
  pending.finish(approved === true)
  return true
}

export async function runAiChatStream(opts: {
  event: IpcMainInvokeEvent
  requestId: string
  messages: unknown
  sessionId?: string
  cwd?: string
  settings: AiResolvedConfig
  sshMcpRuntime?: SshMcpRuntime
  getToolPermission?: () => AiToolPermissionMode
}): Promise<{
  content: string
  reasoningContent?: string
  usage?: ReturnType<typeof extractAiUsage>
  toolRuns?: AiToolRun[]
  aborted?: boolean
  apiMessages?: AiChatMessage[]
}> {
  const { event, requestId, messages, sessionId, cwd, settings, sshMcpRuntime, getToolPermission } = opts
  const currentToolPermission = () =>
    sanitizeAiToolPermission(getToolPermission?.() ?? settings.toolPermission)
  if (!requestId || typeof requestId !== 'string') {
    throw new Error('Invalid AI request id')
  }
  const chatMessages = validateAiMessages(messages)

  const send = (payload: any) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(`ai:chatStream:${requestId}`, payload)
    }
  }

  const boundSessionId =
    typeof sessionId === 'string' && isValidUUID(sessionId) ? sessionId : ''
  let extraSystem = ''
  let useTools = Boolean(sshMcpRuntime && boundSessionId)
  if (useTools && sshMcpRuntime) {
    const listed = await sshMcpRuntime.call('list_sessions', {})
    const sessions =
      (listed.structuredContent as {
        sessions?: Array<{ sessionId: string; host?: string; username?: string; connectionName?: string }>
      })?.sessions || []
    const snap = sessions.find((s) => s.sessionId === boundSessionId)
    extraSystem = sshToolSystemAddendum({
      sessionId: boundSessionId,
      host: snap?.host,
      username: snap?.username,
      connectionName: snap?.connectionName,
      cwd: sanitizeTrackedCwd(cwd),
    })
  }

  let packedMessages = packRequestMessages(settings, chatMessages, undefined, extraSystem)
  const tools = useTools ? sshToolsForChat() : undefined

  const createBody = (includeUsage: boolean, msgs: any[], withTools: boolean) => ({
    model: settings.model,
    temperature: settings.temperature ?? 0.7,
    messages: toApiChatMessages(msgs, withTools),
    stream: true,
    ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
    ...(withTools && tools ? { tools, tool_choice: 'auto' as const } : {}),
  })

  const abortController = new AbortController()
  activeAiStreams.set(requestId, abortController)
  const cleanupStream = () => {
    activeAiStreams.delete(requestId)
  }

  const requestStream = (includeUsage: boolean, msgs: any[], withTools: boolean) =>
    fetch(getAiChatCompletionsUrl(settings.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(createBody(includeUsage, msgs, withTools)),
      signal: abortController.signal,
    })

  const openStream = async (msgs: any[], withTools: boolean) => {
    let response = await requestStream(true, msgs, withTools)
    if (!response.ok) response = await requestStream(false, msgs, withTools)
    return response
  }

  try {
    let apiMessages: AiChatMessage[] = packedMessages
    const contentParts: string[] = []
    let reasoningContent = ''
    let lastRoundContent = ''
    let lastRoundReasoning = ''
    let usage: ReturnType<typeof extractAiUsage> | undefined
    const toolRuns: AiToolRun[] = []
    let toolsEnabled = Boolean(useTools && tools)

    const turnApiMessages = (): AiChatMessage[] | undefined => {
      const generated = appendFinalAssistantTurn(
        apiMessages.slice(packedMessages.length),
        { content: lastRoundContent, reasoningContent: lastRoundReasoning },
      )
      return generated.length ? generated : undefined
    }

    for (let round = 0; round < (toolsEnabled ? MAX_SSH_TOOL_ROUNDS : 1); round++) {
      if (abortController.signal.aborted) break

      let response = await openStream(apiMessages, toolsEnabled)
      if (!response.ok) {
        const message = await readHttpErrorMessage(response, `AI request failed (${response.status})`)
        if (toolsEnabled && looksLikeToolsUnsupported(message)) {
          toolsEnabled = false
          response = await openStream(apiMessages, false)
        } else if (isContextLengthError(message) && round === 0) {
          packedMessages = packRequestMessages(
            settings,
            chatMessages,
            Math.max(4_096, Math.floor(resolveContextWindowTokens(settings.model, settings.contextWindowTokens) / 2)),
            extraSystem,
          )
          apiMessages = packedMessages
          response = await openStream(apiMessages, toolsEnabled)
        }
        if (!response.ok) {
          throw new Error(await readHttpErrorMessage(response, message))
        }
      }

      let roundContent = ''
      let roundReasoning = ''
      lastRoundContent = ''
      lastRoundReasoning = ''
      const toolAcc = new Map<number, AccumulatedToolCall>()
      await readAiStream(response, (chunk) => {
        if (abortController.signal.aborted) return
        const choice = chunk?.choices?.[0]
        const delta = choice?.delta || {}
        const contentDelta = normalizeAiContent(delta.content ?? choice?.text)
        const reasoningDelta = extractAiReasoningFromChoice(choice)
        const chunkUsage = extractAiUsage(chunk?.usage)
        accumulateToolCallDeltas(toolAcc, delta.tool_calls || choice?.message?.tool_calls)

        if (reasoningDelta) {
          reasoningContent += reasoningDelta
          roundReasoning += reasoningDelta
          send({ type: 'reasoning', value: reasoningDelta })
        }
        if (contentDelta) {
          roundContent += contentDelta
          send({ type: 'content', value: contentDelta })
        }
        if (chunkUsage) {
          usage = chunkUsage
          send({ type: 'usage', value: chunkUsage })
        }
      })

      lastRoundContent = roundContent
      lastRoundReasoning = roundReasoning
      if (roundContent.trim()) contentParts.push(roundContent)

      const calls = [...toolAcc.values()].filter((c) => c.name)
      if (!calls.length || !toolsEnabled || !sshMcpRuntime || abortController.signal.aborted) break

      const assistantToolCalls = calls.map((c, i) => ({
        id: c.id || `call_${round}_${i}`,
        type: 'function' as const,
        function: { name: c.name, arguments: c.arguments || '{}' },
      }))
      apiMessages = [
        ...apiMessages,
        {
          role: 'assistant',
          content: roundContent || '',
          ...(roundReasoning ? { reasoningContent: roundReasoning } : {}),
          toolCalls: assistantToolCalls,
        },
      ]

      for (const call of assistantToolCalls) {
        const boundArgs = bindSessionArgs(
          parseToolCallArguments(call.function.arguments),
          boundSessionId,
        )
        const gate = assessAiToolCall(call.function.name, boundArgs, currentToolPermission())
        const mcpArgs = omitDeclaredRiskArg(boundArgs)
        const callArgs = call.function.arguments || '{}'
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
            reason: gate.reason,
          },
        })

        let result: { isError: boolean; content: string; structuredContent?: unknown }
        let status: AiToolRunStatus = 'done'
        if (gate.action === 'reclassify') {
          status = 'reclassify'
          result = {
            isError: true,
            content: formatAiRiskReclassifyContent(gate),
            structuredContent: {
              code: gate.code,
              expected: gate.expected,
              declared: gate.declared,
              message: gate.reason,
            },
          }
        } else if (gate.action === 'deny') {
          status = 'blocked'
          result = {
            isError: true,
            content: `${gate.code}: ${gate.reason}`,
            structuredContent: { code: gate.code, message: gate.reason },
          }
        } else if (gate.action === 'ask') {
          const approved = await waitForToolApproval(requestId, call.id, abortController.signal)
          if (!approved) {
            status = 'denied'
            result = {
              isError: true,
              content: abortController.signal.aborted
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
                reason: gate.reason,
              },
            })
            result = await sshMcpRuntime.call(call.function.name, mcpArgs, { approvalMode: 'auto' })
          }
        } else {
          result = await sshMcpRuntime.call(call.function.name, mcpArgs, { approvalMode: 'auto' })
        }

        if (abortController.signal.aborted && status === 'done' && !result.content) break

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
          reason: gate.reason,
        }
        toolRuns.push(run)
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
            reason: run.reason,
            status: run.status,
          },
        })
        apiMessages.push({
          role: 'tool',
          toolCallId: call.id,
          content: result.content,
        })
      }
    }

    const content = contentParts.join('\n\n')
    const apiTurn = turnApiMessages()
    if (abortController.signal.aborted) {
      send({ type: 'done' })
      return {
        content,
        reasoningContent: reasoningContent || undefined,
        usage,
        toolRuns,
        aborted: true,
        apiMessages: apiTurn,
      }
    }

    send({ type: 'done' })
    return {
      content,
      reasoningContent: reasoningContent || undefined,
      usage,
      toolRuns,
      apiMessages: apiTurn,
    }
  } catch (err: any) {
    if (abortController.signal.aborted || err?.name === 'AbortError') {
      send({ type: 'done' })
      return { content: '', aborted: true }
    }
    throw err
  } finally {
    cleanupStream()
  }
}
