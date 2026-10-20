import { accumulateToolCallDeltas, type AccumulatedToolCall } from './toolCallDeltas'
import { aggregateAiUsage } from '../../../shared/aiUsage'
import type { AiWorkspaceTarget } from '../../../shared/aiWorkspace'
import { MAX_AI_BACKGROUND_CONTINUATIONS, normalizeAiToolRounds } from '../../../shared/aiToolLimits'
import { assertAiImageCapability } from '../../../shared/aiImages'
import { formatAiConversationContextFile } from '../../../shared/aiFixedContext'
import { t } from '../../i18n/index'
import { runAiChatCompletion } from './chatCompletion'
import {
  isContextLengthError,
  resolveContextWindowTokens,
} from '../../../shared/aiContext'
import { looksLikeToolsUnsupported } from '../tools/sshToolChat'
import {
  sanitizeAiToolPermission,
  type AiToolPermissionMode,
} from '../../../shared/aiToolPolicy'
import { appendFinalAssistantTurn, validateAiMessages } from '../../../shared/aiMessages'
import { compactAiLiveMessages, maybeCompactAiContext } from './contextCompaction'
import { aiToolSchemaTokens, measureAiContextPressure, resolveAiContextBudget } from '../../../shared/aiContextPressure'
import { getAiProviderAdapter } from '../providers/registry'
import { createAiStreamControl, clearPendingToolApprovals, clearPendingUserQuestions } from '../tools/streamControl'
import { executeAiToolCall, type AiToolApprovalObserver } from '../tools/toolExecution'
import type {
  AiChatMessage,
  AiChatStreamPayload,
  AiContextCheckpoint,
  AiHistoryRecord,
  AiResolvedConfig,
  AiToolRun,
  AiUsage,
  AiContextPressure,
} from '../../../shared/types/ai'
import type { SshMcpRuntime } from '../../mcp/runtime'
import { readHttpErrorMessage } from '../providers/http'
import { buildAiRequestEnvironment, packRequestMessages } from './requestContext'
import { AI_QUESTION_TOOL } from '../../../shared/aiQuestions'
import { AI_LOAD_TOOLS, aiToolGroupsFromHistory, normalizeAiToolGroups, type AiToolGroup } from '../../../shared/aiToolCatalog'
import { sshToolsForChat } from '../../../shared/aiSidebarPrompt'
import { workspaceToolsForChat } from '../../../shared/aiWorkspacePrompt'

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
  contextFiles?: import('../../../shared/types/ai').AiConversationContextFile[]
  sshMcpRuntime?: SshMcpRuntime
  onBackgroundJobsStarted?: (jobIds: string[]) => void
  onBackgroundJobCollected?: (jobId: string) => void
  pendingBackgroundResults?: () => { notice: string; acknowledge: () => void } | undefined
  persistBackgroundResults?: (notice: string, apiMessages: AiChatMessage[]) => Promise<void>
  foregroundOnly?: boolean
  allowQuestions?: boolean
  toolGroups?: readonly AiToolGroup[]
  getToolPermission?: () => AiToolPermissionMode
  onToolApprovalRequested?: AiToolApprovalObserver
  contextHistory?: {
    /** New application events not yet part of completed display history. */
    continuation?: AiChatMessage[]
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
  contextPressure?: AiContextPressure
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
  let receivedToolCall = false
  const send = (payload: AiChatStreamPayload) => {
    if (payload.type === 'content' || payload.type === 'reasoning') receivedText = true
    opts.emit(payload)
  }

  const workspaceTargets = opts.workspaceTargets
  const contextFiles = opts.contextFiles || []
  const allowQuestions = opts.allowQuestions !== false && !opts.foregroundOnly
  let toolGroups = normalizeAiToolGroups([...normalizeAiToolGroups(opts.toolGroups), ...aiToolGroupsFromHistory(opts.contextHistory?.records || [])])
  const environment = await buildAiRequestEnvironment({ sessionId, cwd, workspaceTargets, contextFiles, sshMcpRuntime, allowQuestions, toolGroups })
  const { boundSessionId, useTools, extraSystem } = environment
  let tools = environment.tools
  const loadTools = (groups: AiToolGroup[]) => {
    toolGroups = normalizeAiToolGroups([...toolGroups, ...groups])
    tools = (workspaceTargets ? workspaceToolsForChat(toolGroups) : sshToolsForChat(toolGroups))
      .filter(tool => allowQuestions || tool.function.name !== AI_QUESTION_TOOL)
    return { loadedGroups: toolGroups, tools: tools.map(tool => tool.function.name) }
  }

  const control = opts.abortController ? undefined : createAiStreamControl(requestId)
  const abortController = opts.abortController || control!.controller
  const cleanupStream = () => control?.cleanup()
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
        continuation: opts.contextHistory.continuation,
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
    const packed = packRequestMessages(settings, incoming, budgetTokens, extraSystem, contextFiles.length ? 40_000 : undefined, aiToolSchemaTokens(tools))
    if (contextFiles.some(file => !packed[0]?.content.includes(file.content))) {
      throw new Error('Fixed context file is too large for the selected model context window')
    }
    return packed
  }
  let packedMessages: AiChatMessage[]
  try { packedMessages = packMessages(contextMessages) } catch (error) { cleanupStream(); throw error }

  const requestStream = (includeUsage: boolean, msgs: AiChatMessage[], withTools: boolean) => {
    const request = provider.buildRequest(settings, msgs, { stream: true, includeUsage, tools: withTools ? tools : undefined, maxTokens: resolveAiContextBudget(settings).outputReserveTokens })
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
  const receivedBackgroundMessages: AiChatMessage[] = []
  try {
    let apiMessages: AiChatMessage[] = packedMessages
    const contentParts: string[] = []
    let reasoningContent = ''
    let lastRoundMessage: AiChatMessage = { role: 'assistant', content: '' }
    const toolRuns: AiToolRun[] = []
    let toolsEnabled = Boolean(useTools && tools)
    let overflowRecovered = false
    const generatedMessages: AiChatMessage[] = []
    let contextPressure: AiContextPressure | undefined
    const reportPressure = (messages: AiChatMessage[]) => {
      contextPressure = measureAiContextPressure({ ...settings, extraSystem, toolSchemaTokens: aiToolSchemaTokens(toolsEnabled ? tools : undefined), messages })
      send({ type: 'context-pressure', value: contextPressure })
      return contextPressure
    }
    const compactStep = (messages: AiChatMessage[], force = false) => compactAiLiveMessages({
      settings, extraSystem, tools: toolsEnabled ? tools : undefined, messages, force,
      signal: abortController.signal, emit: send, onUsage: usage => { usageRequests.push(usage); reportUsage() },
    })

    const turnApiMessages = (): AiChatMessage[] | undefined => {
      const generated = appendFinalAssistantTurn(
        generatedMessages,
        lastRoundMessage,
      )
      return generated.length ? generated : undefined
    }

    const receiveBackgroundResults = async (appendRound = false) => {
      if (abortController.signal.aborted) return false
      const pending = opts.pendingBackgroundResults?.()
      if (!pending) return false
      if (appendRound) {
        const intermediate = appendFinalAssistantTurn([], lastRoundMessage)
        apiMessages.push(...intermediate)
        generatedMessages.push(...intermediate)
        lastRoundMessage = { role: 'assistant', content: '' }
      }
      const message: AiChatMessage = { role: 'user', content: pending.notice }
      apiMessages.push(message)
      generatedMessages.push(message)
      receivedBackgroundMessages.push(message)
      // Persist the original transcript, not its potentially compacted API projection.
      await opts.persistBackgroundResults?.(pending.notice, generatedMessages)
      pending.acknowledge()
      return true
    }

    const maxToolRounds = normalizeAiToolRounds(settings.maxToolRounds)
    let toolRounds = 0
    let continuations = 0
    let receivedAtEnd = false
    for (let round = 0; round < maxToolRounds + MAX_AI_BACKGROUND_CONTINUATIONS; round++) {
      if (abortController.signal.aborted) break
      if (!receivedAtEnd) await receiveBackgroundResults()
      receivedAtEnd = false
      if (abortController.signal.aborted) break
      if (round > 0) apiMessages = packMessages(await compactStep(apiMessages))
      else apiMessages = packMessages(apiMessages)
      reportPressure(apiMessages)

      streamAccepted = false
      let response = await openStream(apiMessages, toolsEnabled)
      if (!response.ok) {
        const message = await readHttpErrorMessage(response, `AI request failed (${response.status})`)
        if (toolsEnabled && !receivedToolCall && looksLikeToolsUnsupported(message)) {
          toolsEnabled = false
          response = await openStream(apiMessages, false)
        } else if (isContextLengthError(message) && !overflowRecovered) {
          overflowRecovered = true
          const before = reportPressure(apiMessages).usedTokens
          const recovered = await compactStep(apiMessages, true)
          const smaller = measureAiContextPressure({ ...settings, extraSystem, toolSchemaTokens: aiToolSchemaTokens(toolsEnabled ? tools : undefined), messages: recovered }).usedTokens < before
          apiMessages = packMessages(recovered, smaller ? undefined : Math.max(4_096, Math.floor(resolveContextWindowTokens(settings.model, settings.contextWindowTokens) / 2)))
          reportPressure(apiMessages)
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
          receivedToolCall = true
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
      if (!abortController.signal.aborted && (!calls.length || !toolsEnabled) && !roundContent.trim()) {
        throw new Error(t('ai.noMessageContent'))
      }
      if (abortController.signal.aborted) break
      if (!calls.length || !toolsEnabled || !sshMcpRuntime) {
        if (continuations < MAX_AI_BACKGROUND_CONTINUATIONS && await receiveBackgroundResults(true)) {
          continuations++
          receivedAtEnd = true
          if (roundContent.trim()) send({ type: 'content', value: '\n\n' })
          continue
        }
        break
      }

      const assistantToolCalls = calls.map((c, i) => ({
        id: c.id || `call_${round}_${i}`,
        type: 'function' as const,
        function: { name: c.name, arguments: c.arguments || '{}' },
      }))
      const assistantExchange: AiChatMessage = {
        ...roundMessage,
        role: 'assistant',
        content: roundContent || '',
        ...(roundReasoning ? { reasoningContent: roundReasoning } : {}),
        toolCalls: assistantToolCalls,
      }
      apiMessages.push(assistantExchange)
      generatedMessages.push(assistantExchange)

      const questionCall = allowQuestions ? assistantToolCalls.find(call => call.function.name === AI_QUESTION_TOOL) : undefined
      const loadingCall = assistantToolCalls.find(call => call.function.name === AI_LOAD_TOOLS)
      // A batch is planned against this request's catalog. Newly loaded schemas
      // may be used only after the model has received and read the load result.
      const availableTools = new Set(tools?.map(tool => tool.function.name))
      for (const call of assistantToolCalls) {
        if (abortController.signal.aborted) break
        // A preplanned command cannot depend on an answer the model has not read.
        // Complete the declared protocol with a non-execution result instead.
        if ((questionCall && call !== questionCall) || (!questionCall && loadingCall && call !== loadingCall)) {
          const content = questionCall
            ? 'QUESTION_BATCH_DEFERRED: This tool was not executed. Interpret the user answer or cancellation from ask_user before planning further tool calls. Call ask_user alone.'
            : 'TOOL_LOAD_BATCH_DEFERRED: This tool was not executed. Read the load_tools result and the loaded schemas before planning further tool calls. Call load_tools alone.'
          const run: AiToolRun = { id: call.id, name: call.function.name, args: call.function.arguments, content, isError: true, status: 'done' }
          send({ type: 'tool', value: { ...run, phase: 'done' } })
          toolRuns.push(run)
          const message: AiChatMessage = { role: 'tool', toolCallId: call.id, content }
          apiMessages.push(message)
          generatedMessages.push(message)
          await opts.checkpoint?.()
          continue
        }
        const result = await executeAiToolCall(call, {
          requestId, boundSessionId, workspaceTargets, sshMcpRuntime,
          signal: abortController.signal, send, getToolPermission: currentToolPermission,
          checkpoint: opts.checkpoint, foregroundOnly: opts.foregroundOnly,
          allowQuestions,
          availableTools, loadTools,
          onToolApprovalRequested: opts.onToolApprovalRequested,
          onBackgroundJobsStarted: opts.onBackgroundJobsStarted,
          onBackgroundJobCollected: opts.onBackgroundJobCollected,
        })
        if (!result) break
        toolRuns.push(result.run)
        apiMessages.push(result.message)
        generatedMessages.push(result.message)
        await opts.checkpoint?.()
      }
      toolRounds++
      if (toolRounds === maxToolRounds && !abortController.signal.aborted) {
        const notice = t('ai.toolRoundLimitReached', { count: maxToolRounds })
        contentParts.push(notice)
        lastRoundMessage = { role: 'assistant', content: notice }
        send({ type: 'content', value: `\n\n${notice}` })
        await opts.checkpoint?.()
        break
      }
    }

    const content = contentParts.join('\n\n')
    const apiTurn = turnApiMessages()
    reportPressure(appendFinalAssistantTurn(apiMessages, lastRoundMessage))
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
        contextPressure,
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
      contextPressure,
    }
  } catch (err: any) {
    if (abortController.signal.aborted || err?.name === 'AbortError') {
      send({ type: 'done' })
      return { content: '', aborted: true, contextCheckpoint: activeContextCheckpoint }
    }
    if (!receivedText && !receivedToolCall && streamAccepted && provider.allowsCompletionFallback) {
      const reply = await runAiChatCompletion(
        settings, [...contextMessages, ...receivedBackgroundMessages], abortController.signal, extraSystem,
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
        apiMessages: [...receivedBackgroundMessages, ...(reply.apiMessages || [{ role: 'assistant', content: reply.content, reasoningContent: reply.reasoningContent }])],
        contextCheckpoint: activeContextCheckpoint,
      }
    }
    throw err
  } finally {
    clearPendingToolApprovals(requestId)
    clearPendingUserQuestions(requestId)
    cleanupStream()
  }
}
