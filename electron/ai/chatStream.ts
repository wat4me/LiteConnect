import { accumulateToolCallDeltas, type AccumulatedToolCall } from './toolCallDeltas'
import { aggregateAiUsage } from '../../shared/aiUsage'
import type { AiWorkspaceTarget } from '../../shared/aiWorkspace'
import { workspaceToolsForChat, workspaceToolSystemAddendum } from '../../shared/aiWorkspacePrompt'
import { normalizeAiToolRounds } from '../../shared/aiToolLimits'
import { assertAiImageCapability } from '../../shared/aiImages'
import { formatAiConversationContextFile } from '../../shared/aiFixedContext'
import { t } from '../i18n'
import { runAiChatCompletion } from './chatCompletion'
import {
  isContextLengthError,
  resolveContextWindowTokens,
} from '../../shared/aiContext'
import {
  looksLikeToolsUnsupported,
  sshToolsForChat,
  sshToolSystemAddendum,
} from './sshToolChat'
import {
  sanitizeAiToolPermission,
  type AiToolPermissionMode,
} from '../../shared/aiToolPolicy'
import { appendFinalAssistantTurn, validateAiMessages } from '../../shared/aiMessages'
import { maybeCompactAiContext } from './contextCompaction'
import { getAiProviderAdapter } from './providers/registry'
import { createAiStreamControl, clearPendingToolApprovals } from './streamControl'
import { executeAiToolCall, type AiToolApprovalObserver } from './toolExecution'
import type {
  AiChatMessage,
  AiChatStreamPayload,
  AiContextCheckpoint,
  AiHistoryRecord,
  AiResolvedConfig,
  AiToolRun,
  AiUsage,
} from '../../shared/types/ai'
import type { SshMcpRuntime } from '../mcp/runtime'
import { isValidUUID } from '../utils/validation'
import { readHttpErrorMessage } from './providers/http'
import { packRequestMessages } from './requestContext'

export async function runAiChatStream(opts: {
  emit: (payload: AiChatStreamPayload) => void
  checkpoint?: () => Promise<void>
  abortController?: AbortController
  requestId: string
  messages: unknown
  sessionId?: string
  workspaceTargets?: AiWorkspaceTarget[]
  cwd?: string
  settings: AiResolvedConfig
  contextFiles?: import('../../shared/types/ai').AiConversationContextFile[]
  sshMcpRuntime?: SshMcpRuntime
  onBackgroundJobsStarted?: (jobIds: string[]) => void
  onBackgroundJobCollected?: (jobId: string) => void
  foregroundOnly?: boolean
  getToolPermission?: () => AiToolPermissionMode
  onToolApprovalRequested?: AiToolApprovalObserver
  contextHistory?: {
    compactionCount?: number
    records: AiHistoryRecord[]
    checkpoint?: AiContextCheckpoint
    saveCheckpoint: (checkpoint: AiContextCheckpoint) => Promise<void>
  }
}): Promise<{
  content: string
  reasoningContent?: string
  usage?: AiUsage
  toolRuns?: AiToolRun[]
  aborted?: boolean
  apiMessages?: AiChatMessage[]
  contextCheckpoint?: AiContextCheckpoint
}> {
  const { requestId, messages, sessionId, cwd, settings, sshMcpRuntime, getToolPermission } = opts
  const currentToolPermission = () =>
    sanitizeAiToolPermission(getToolPermission?.() ?? settings.toolPermission)
  if (!requestId || typeof requestId !== 'string') {
    throw new Error('Invalid AI request id')
  }
  const provider = getAiProviderAdapter(settings.protocol)
  const chatMessages = validateAiMessages(messages)
  assertAiImageCapability(chatMessages, settings.supportsImages)

  let receivedText = false
  const send = (payload: AiChatStreamPayload) => {
    if (payload.type === 'content' || payload.type === 'reasoning') receivedText = true
    opts.emit(payload)
  }

  const boundSessionId =
    typeof sessionId === 'string' && isValidUUID(sessionId) ? sessionId : ''
  let extraSystem = ''
  const workspaceTargets = opts.workspaceTargets
  const useTools = Boolean(sshMcpRuntime && (workspaceTargets?.length || boundSessionId))
  if (workspaceTargets) {
    extraSystem = workspaceToolSystemAddendum(workspaceTargets)
  } else if (useTools && sshMcpRuntime) {
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
      cwd,
    })
  }
  const contextFiles = opts.contextFiles || []
  for (const file of contextFiles) extraSystem += `\n\n${formatAiConversationContextFile(file)}`

  const control = opts.abortController ? undefined : createAiStreamControl(requestId)
  const abortController = opts.abortController || control!.controller
  const cleanupStream = () => control?.cleanup()
  const tools = useTools ? (workspaceTargets ? workspaceToolsForChat() : sshToolsForChat()) : undefined
  const usageRequests: (AiUsage | undefined)[] = []
  const reportUsage = () => {
    const usage = aggregateAiUsage(usageRequests)
    if (usage) send({ type: 'usage', value: usage })
    return usage
  }
  let contextMessages = chatMessages
  let activeContextCheckpoint = opts.contextHistory?.checkpoint
  if (opts.contextHistory) {
    try {
      const prepared = await maybeCompactAiContext({
        compactionCount: opts.contextHistory.compactionCount,
        records: opts.contextHistory.records,
        checkpoint: opts.contextHistory.checkpoint,
        settings,
        extraSystem,
        tools,
        signal: abortController.signal,
        emit: send,
        saveCheckpoint: opts.contextHistory.saveCheckpoint,
        onUsage: usage => { usageRequests.push(usage); reportUsage() },
      })
      contextMessages = prepared.messages
      activeContextCheckpoint = prepared.checkpoint
    } catch (error) {
      cleanupStream()
      throw error
    }
  }
  const packMessages = (incoming: AiChatMessage[], budgetTokens?: number) => {
    const packed = packRequestMessages(settings, incoming, budgetTokens, extraSystem, contextFiles.length ? 40_000 : undefined)
    if (contextFiles.some(file => !packed[0]?.content.includes(file.content))) {
      throw new Error('Fixed context file is too large for the selected model context window')
    }
    return packed
  }
  let packedMessages: AiChatMessage[]
  try { packedMessages = packMessages(contextMessages) } catch (error) { cleanupStream(); throw error }

  const requestStream = (includeUsage: boolean, msgs: AiChatMessage[], withTools: boolean) => {
    const request = provider.buildRequest(settings, msgs, { stream: true, includeUsage, tools: withTools ? tools : undefined })
    return fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: abortController.signal,
    })
  }

  const openStream = async (msgs: AiChatMessage[], withTools: boolean) => {
    send({ type: 'model-status', value: 'requesting' })
    let response = await requestStream(true, msgs, withTools)
    if (provider.supportsStreamUsageOption && !response.ok && (response.status === 400 || response.status === 422)) {
      const detail = await readHttpErrorMessage(response.clone(), '')
      if (/stream[_\s-]?options|include[_\s-]?usage/i.test(detail)) {
        response = await requestStream(false, msgs, withTools)
      }
    }
    return response
  }

  let streamAccepted = false
  try {
    let apiMessages: AiChatMessage[] = packedMessages
    const contentParts: string[] = []
    let reasoningContent = ''
    let lastRoundMessage: AiChatMessage = { role: 'assistant', content: '' }
    const toolRuns: AiToolRun[] = []
    let toolsEnabled = Boolean(useTools && tools)

    const turnApiMessages = (): AiChatMessage[] | undefined => {
      const generated = appendFinalAssistantTurn(
        apiMessages.slice(packedMessages.length),
        lastRoundMessage,
      )
      return generated.length ? generated : undefined
    }

    const maxToolRounds = normalizeAiToolRounds(settings.maxToolRounds)
    for (let round = 0; round < (toolsEnabled ? maxToolRounds : 1); round++) {
      if (abortController.signal.aborted) break

      streamAccepted = false
      let response = await openStream(apiMessages, toolsEnabled)
      if (!response.ok) {
        const message = await readHttpErrorMessage(response, `AI request failed (${response.status})`)
        if (toolsEnabled && looksLikeToolsUnsupported(message)) {
          toolsEnabled = false
          response = await openStream(apiMessages, false)
        } else if (isContextLengthError(message) && round === 0) {
          packedMessages = packMessages(
            contextMessages,
            Math.max(4_096, Math.floor(resolveContextWindowTokens(settings.model, settings.contextWindowTokens) / 2)),
          )
          apiMessages = packedMessages
          response = await openStream(apiMessages, toolsEnabled)
        }
        if (!response.ok) {
          throw new Error(await readHttpErrorMessage(response, message))
        }
      }
      streamAccepted = true
      const usageIndex = usageRequests.push(undefined) - 1
      reportUsage()
      send({ type: 'model-status', value: 'waiting' })

      let roundContent = ''
      let roundReasoning = ''
      lastRoundMessage = { role: 'assistant', content: '' }
      const toolAcc = new Map<number, AccumulatedToolCall>()
      const roundMessage = await provider.readStream(settings, response, (delta) => {
        if (abortController.signal.aborted) return
        const contentDelta = delta.content
        const reasoningDelta = delta.reasoning
        const chunkUsage = delta.usage
        accumulateToolCallDeltas(toolAcc, delta.toolCalls)
        if (delta.toolCalls?.length) {
          send({ type: 'model-status', value: 'tool-input' })
        }

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
          usageRequests[usageIndex] = chunkUsage
          reportUsage()
        }
      })

      lastRoundMessage = roundMessage
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
          ...roundMessage,
          role: 'assistant',
          content: roundContent || '',
          ...(roundReasoning ? { reasoningContent: roundReasoning } : {}),
          toolCalls: assistantToolCalls,
        },
      ]

      for (const call of assistantToolCalls) {
        const result = await executeAiToolCall(call, {
          requestId, boundSessionId, workspaceTargets, sshMcpRuntime,
          signal: abortController.signal, send, getToolPermission: currentToolPermission,
          checkpoint: opts.checkpoint, foregroundOnly: opts.foregroundOnly,
          onToolApprovalRequested: opts.onToolApprovalRequested,
          onBackgroundJobsStarted: opts.onBackgroundJobsStarted,
          onBackgroundJobCollected: opts.onBackgroundJobCollected,
        })
        if (!result) break
        toolRuns.push(result.run)
        apiMessages.push(result.message)
        await opts.checkpoint?.()
      }
      if (round + 1 === maxToolRounds && !abortController.signal.aborted) {
        const notice = t('ai.toolRoundLimitReached', { count: maxToolRounds })
        contentParts.push(notice)
        lastRoundMessage = { role: 'assistant', content: notice }
        send({ type: 'content', value: `\n\n${notice}` })
        await opts.checkpoint?.()
      }
    }

    const content = contentParts.join('\n\n')
    const apiTurn = turnApiMessages()
    if (abortController.signal.aborted) {
      send({ type: 'done' })
      return {
        content,
        reasoningContent: reasoningContent || undefined,
        usage: aggregateAiUsage(usageRequests),
        toolRuns,
        aborted: true,
        apiMessages: apiTurn,
        contextCheckpoint: activeContextCheckpoint,
      }
    }

    send({ type: 'done' })
    return {
      content,
      reasoningContent: reasoningContent || undefined,
      usage: aggregateAiUsage(usageRequests),
      toolRuns,
      apiMessages: apiTurn,
      contextCheckpoint: activeContextCheckpoint,
    }
  } catch (err: any) {
    if (abortController.signal.aborted || err?.name === 'AbortError') {
      send({ type: 'done' })
      return { content: '', aborted: true, contextCheckpoint: activeContextCheckpoint }
    }
    if (!receivedText && streamAccepted && provider.allowsCompletionFallback) {
      const reply = await runAiChatCompletion(
        settings, contextMessages, abortController.signal, extraSystem,
        contextFiles.length ? 40_000 : undefined, contextFiles.length ? contextFiles.map(formatAiConversationContextFile).join('\n\n') : undefined,
      )
      if (reply.reasoningContent) send({ type: 'reasoning', value: reply.reasoningContent })
      send({ type: 'content', value: reply.content })
      usageRequests.push(reply.usage)
      const usage = reportUsage()
      send({ type: 'done' })
      return {
        ...reply,
        usage,
        apiMessages: reply.apiMessages || [{ role: 'assistant', content: reply.content, reasoningContent: reply.reasoningContent }],
        contextCheckpoint: activeContextCheckpoint,
      }
    }
    throw err
  } finally {
    clearPendingToolApprovals(requestId)
    cleanupStream()
  }
}
