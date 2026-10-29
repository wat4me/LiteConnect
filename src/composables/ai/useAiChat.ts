import { ElMessage } from 'element-plus/es/components/message/index'
import type {
  AiChatStreamPayload, AiConversationThread, AiConversationContextFile,
  AiSessionStore, AiToolRun, AiImageAttachment,
} from '@shared/types/ai'
import type { AiSessionState, ChatItem } from '@/domain/ai/chat'
import { t } from '@/i18n'
import { flattenConversationForApi } from '@shared/aiMessages'
import type { AiUserAnswer } from '@shared/aiQuestions'
import { assertAiImageCapability, normalizeAiImages } from '@shared/aiImages'
import { normalizeAiCompactionCount } from '@shared/aiCompaction'
import { aiToolGroupsFromHistory, normalizeAiToolGroups } from '@shared/aiToolCatalog'
import { notifyAiReplyComplete, onAiReplyComplete } from './aiReplyEvents'
import { syncAiApprovalPending } from './useAiApprovalHint'
import { appendTextSegment, ensureToolSegments } from '@/utils/ai/chatSegments'
import { getSftpListedCwd } from '@/utils/sftp/sftpListedCwd'
import { advanceChatActivity } from '@/utils/ai/chatActivity'
import { getAiPendingAction } from '@/utils/ai/pendingAction'
import {
  sanitizeAiErrorMessage, createMessage, plainUsage, toHistoryRecord, fromHistoryRecord,
  plainToolRuns, plainSegments, plainApiMessages, cloneForIpc,
} from '@/utils/ai/chatHistoryProjection'
import {
  getAiSessionState, findAiSessionState, releaseAiSessionState,
  closeContextCompressionNotice, setContextCompressionNotice,
} from './chat/sessionState'
import { settings, refreshAiSettings, replaceAiSettings, useAiModelSelection } from './chat/settings'
import { clearAiQuestionDrafts, getAiQuestionDraft, pruneAiQuestionDrafts } from './chat/questionDrafts'
import {
  createThreadId, pruneEmptyThreadsLocal, syncThreadSummaries, applyThreadMessages,
  loadThreadImages, buildStoreFromState, persistActiveThread, persistMessage, loadHistory,
} from './chat/history'

export { disposeAiSessionState, listAiResourceUsage } from './chat/sessionState'

const backgroundSubscriptions = new WeakSet<object>()
const resolvingToolApprovals = new Set<string>()
const resolvingQuestions = new Set<string>()

/** Public command facade; session ownership, persistence and IPC projection live below it. */
export function useAiChat() {
  const { activeProvider, displayModelName, activeContextWindowTokens } = useAiModelSelection()
  function cwdForSession(sessionId: string): string | undefined {
    const cwd = getSftpListedCwd(sessionId).trim()
    if (!cwd.startsWith('/') || cwd.length > 4096 || /[\0\r\n]/.test(cwd)) return undefined
    return cwd
  }

  function onReplyComplete(cb: (sessionId: string) => void): () => void {
    return onAiReplyComplete(cb)
  }

  async function resolveToolApproval(sessionId: string, runId: string, approved: boolean): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    const activeRequestId = state.activeRequestId
    const approvalKey = `${activeRequestId || ''}:${runId}`
    if (resolvingToolApprovals.has(approvalKey)) return false
    if (!activeRequestId || !state.loading || !state.messages.some(message =>
      message.streaming && message.toolRuns?.some(run => run.id === runId && run.status === 'ask'),
    )) return false
    resolvingToolApprovals.add(approvalKey)
    try {
      const resolved = await window.LiteConnect.aiResolveToolApproval(activeRequestId, runId, approved)
      if (!resolved) return false
      for (const message of state.messages) {
        const run = message.toolRuns?.find(item => item.id === runId && item.status === 'ask')
        if (!run) continue
        run.status = approved ? 'running' : 'denied'
        if (!approved) run.isError = true
        break
      }
      refreshApprovalPending(sessionId)
      return true
    } catch {
      /* stream may have ended */
      return false
    } finally {
      resolvingToolApprovals.delete(approvalKey)
    }
  }

  async function stopGeneration(sessionId: string): Promise<boolean> {
    const activeRequestId = getAiSessionState(sessionId).activeRequestId
    if (!activeRequestId) return false
    try {
      await window.LiteConnect.aiAbortChatStream(activeRequestId)
      return true
    } catch {
      return false
    }
  }

  async function answerQuestion(sessionId: string, runId: string, answer: AiUserAnswer): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    const requestId = state.activeRequestId
    if (!requestId || !state.loading || !state.messages.some(message => message.streaming && message.toolRuns?.some(run => run.id === runId && run.status === 'question'))) return false
    const key = JSON.stringify([requestId, runId])
    if (resolvingQuestions.has(key)) return false
    resolvingQuestions.add(key)
    try {
      const resolved = await window.LiteConnect.aiAnswerQuestion(requestId, runId, cloneForIpc(answer))
      if (resolved && state.activeRequestId === requestId) {
        for (const message of state.messages) {
          const run = message.toolRuns?.find(item => item.id === runId && item.status === 'question')
          if (run) run.status = 'running'
        }
        refreshApprovalPending(sessionId)
      }
      return resolved
    } catch { return false }
    finally { resolvingQuestions.delete(key) }
  }

  function refreshApprovalPending(sessionId: string) {
    const state = getAiSessionState(sessionId)
    pruneAiQuestionDrafts(state)
    syncAiApprovalPending(sessionId, getAiPendingAction(state))
  }

  function setSessionLoading(sessionId: string, value: boolean) {
    const state = getAiSessionState(sessionId)
    if (value) state.contextPressure = undefined
    state.loading = value
    refreshApprovalPending(sessionId)
  }

  function handleContextCompaction(sessionId: string, payload: Extract<AiChatStreamPayload, { type: 'compaction' }>, manual = false) {
    const state = getAiSessionState(sessionId)
    const before = Math.max(0, Math.round(payload.value.beforeTokens / payload.value.budgetTokens * 100))
    if (payload.value.phase === 'start') {
      closeContextCompressionNotice(sessionId)
      setContextCompressionNotice(sessionId, ElMessage.info({ message: t('ai.contextCompressionStarted', { before }), duration: 0, showClose: true }))
    } else {
      closeContextCompressionNotice(sessionId)
      if (payload.value.phase === 'failed') ElMessage.warning(t(manual ? 'ai.contextManualCompressionFailed' : 'ai.contextCompressionFailed'))
      else {
        if (payload.value.compactionCount) state.compactionCount = Math.max(state.compactionCount, payload.value.compactionCount)
        const after = Math.max(0, Math.round((payload.value.afterTokens || 0) / payload.value.budgetTokens * 100))
        if (payload.value.afterTokens !== undefined && payload.value.afterTokens < payload.value.beforeTokens) ElMessage.success(t('ai.contextCompressionDone', { before, after }))
        const threadId = state.activeThreadId
        void window.LiteConnect.getAiSessionStore(sessionId).then(store => {
          if (state.activeThreadId !== threadId) return
          const thread = store.threads.find(item => item.id === threadId)
          state.contextCheckpoint = thread?.contextCheckpoint
          state.compactionCount = Math.max(state.compactionCount, normalizeAiCompactionCount(thread?.compactionCount))
        }).catch(() => {})
      }
    }
  }

  async function compactContext(sessionId: string): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    if (state.loading || !state.activeThreadId) return false
    const threadId = state.activeThreadId
    const requestId = `ai-compact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let failed = false
    setSessionLoading(sessionId, true)
    state.contextPressure = undefined
    state.activeRequestId = requestId
    const unsubscribe = window.LiteConnect.onAiChatStream(requestId, payload => {
      if (payload.type === 'context-pressure') state.contextPressure = payload.value
      if (payload.type === 'compaction') {
        failed ||= payload.value.phase === 'failed'
        handleContextCompaction(sessionId, payload, true)
      }
    })
    try {
      const result = await window.LiteConnect.aiChatStream(requestId, [], {
        sessionId, threadId, compactOnly: true, assistantMessageId: requestId, createdAt: Date.now(), cwd: cwdForSession(sessionId),
      })
      if (state.activeThreadId === threadId) {
        state.contextCheckpoint = result.contextCheckpoint
        state.contextPressure = result.contextPressure
        state.compactionCount = Math.max(state.compactionCount, normalizeAiCompactionCount(result.contextCheckpoint?.compactionCount))
      }
      if (!result.contextCompacted && !failed) ElMessage.info(t('ai.contextNothingToCompact'))
      return result.contextCompacted === true
    } catch (error: any) {
      ElMessage.warning(sanitizeAiErrorMessage(error?.message || t('ai.requestFailed')))
      return false
    } finally {
      unsubscribe()
      closeContextCompressionNotice(sessionId)
      state.activeRequestId = null
      setSessionLoading(sessionId, false)
      if (state.disposeAfterReply) releaseAiSessionState(sessionId)
    }
  }

  async function ensureAssistantReply(
    sessionId: string,
    onUpdate: (messages: ChatItem[]) => void
  ): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    if (state.loading) {
      ElMessage.warning(t('ai.busy'))
      return false
    }

    const requestMessages = cloneForIpc(flattenConversationForApi(state.messages))

    if (!requestMessages.some((message) => message.role === 'user')) {
      ElMessage.warning(t('ai.needUserMessage'))
      return false
    }

    setSessionLoading(sessionId, true)

    const assistantMessage = createMessage('assistant', '', false, { streaming: true })
    assistantMessage.status = 'running'
    assistantMessage.activity = { phase: 'requesting', phaseStartedAt: Date.now(), lastActivityAt: Date.now() }
    assistantMessage.segments = []
    assistantMessage.toolRuns = []
    state.messages.push(assistantMessage)
    onUpdate(state.messages)
    const assistantIndex = state.messages.length - 1

    const getAssistantMessage = () => state.messages[assistantIndex] || assistantMessage
    const updateAssistantMessage = (patch: Partial<ChatItem>) => {
      const current = getAssistantMessage()
      Object.assign(current, patch)
      if (patch.toolRuns) refreshApprovalPending(sessionId)
    }

    let activeStreamUnsubscribe: (() => void) | null = null
    try {
      const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      state.activeRequestId = requestId
      activeStreamUnsubscribe = window.LiteConnect.onAiChatStream(requestId, (payload: AiChatStreamPayload) => {
        const current = getAssistantMessage()
        if (payload.type === 'content') {
          current.content += payload.value
          if (!current.segments) current.segments = []
          appendTextSegment(current.segments, 'content', payload.value)
        } else if (payload.type === 'reasoning') {
          current.reasoningContent = (current.reasoningContent || '') + payload.value
          if (!current.segments) current.segments = []
          appendTextSegment(current.segments, 'reasoning', payload.value)
        } else if (payload.type === 'usage') {
          current.usage = plainUsage(payload.value)
        } else if (payload.type === 'context-pressure') {
          state.contextPressure = payload.value
        } else if (payload.type === 'compaction') {
          handleContextCompaction(sessionId, payload)
        } else if (payload.type === 'tool') {
          const incoming = payload.value
          if (!current.toolRuns) current.toolRuns = []
          const runs = current.toolRuns
          const idx = runs.findIndex((r) => r.id === incoming.id)
          const status =
            incoming.status ||
            (incoming.phase === 'start' ? 'running' : incoming.phase === 'done' ? 'done' : incoming.phase)
          const prev = idx >= 0 ? runs[idx] : undefined
          const nextRun: AiToolRun = {
            id: incoming.id,
            name: incoming.name || prev?.name || '',
            args: incoming.args ?? prev?.args ?? '',
            content: incoming.content ?? prev?.content ?? '',
            isError:
              incoming.isError === true ||
              incoming.phase === 'denied' ||
              incoming.phase === 'blocked' ||
              incoming.phase === 'reclassify',
            status,
            risk: incoming.risk ?? prev?.risk,
            jobIds: incoming.jobIds ?? prev?.jobIds,
            target: incoming.target ?? prev?.target,
            reason: incoming.reason ?? prev?.reason,
            // Kept for later phases so the card keeps showing what was approved.
            diffSummary: incoming.diffSummary ?? prev?.diffSummary,
            diffPreview: incoming.diffPreview ?? prev?.diffPreview,
          }
          if (idx >= 0) Object.assign(runs[idx], nextRun)
          else runs.push(nextRun)
          state.toolGroups = normalizeAiToolGroups([...normalizeAiToolGroups(state.toolGroups), ...aiToolGroupsFromHistory([current])])
          if (!current.segments) current.segments = []
          ensureToolSegments(current.segments, runs)
          refreshApprovalPending(sessionId)
        }
        if (current.activity) {
          current.activity = advanceChatActivity(current.activity, payload, Date.now(), current.toolRuns)
        }
      })

      try {
        const reply = await window.LiteConnect.aiChatStream(requestId, requestMessages, {
          sessionId,
          threadId: state.activeThreadId,
          assistantMessageId: assistantMessage.id,
          createdAt: assistantMessage.createdAt,
          cwd: cwdForSession(sessionId),
        })
        const current = getAssistantMessage()
        const aborted = !!(reply as any)?.aborted
        const finalToolRuns = plainToolRuns(reply.toolRuns || current.toolRuns)
        const finalApiMessages = plainApiMessages(reply.apiMessages || current.apiMessages)
        state.contextCheckpoint = reply.contextCheckpoint
        state.compactionCount = Math.max(state.compactionCount, normalizeAiCompactionCount(reply.contextCheckpoint?.compactionCount))
        updateAssistantMessage({
          content: reply.content || current.content || (aborted ? t('ai.stopped') : ''),
          backgroundNotice: reply.backgroundNotice || current.backgroundNotice,
          completedAt: reply.completedAt || Date.now(),
          reasoningContent: reply.reasoningContent || current.reasoningContent,
          usage: plainUsage(reply.usage || current.usage),
          toolRuns: finalToolRuns,
          segments: plainSegments(reply.segments) || ensureToolSegments(current.segments, finalToolRuns),
          apiMessages: finalApiMessages,
          error: reply.error === true,
          status: aborted ? 'aborted' : reply.error === true ? 'error' : 'completed',
        })
      } finally {
        activeStreamUnsubscribe?.()
        activeStreamUnsubscribe = null
        state.activeRequestId = null
      }
    } catch (err: any) {
      // Transport/storage failures are shown locally; main owns all assistant writes.
      const current = getAssistantMessage()
      const detail = sanitizeAiErrorMessage(err?.message || t('ai.requestFailed'))
      const suffix = `${current.content ? '\n\n' : ''}${detail}`
      if (!current.segments) current.segments = []
      appendTextSegment(current.segments, 'content', suffix)
      updateAssistantMessage({
        content: current.content + suffix,
        completedAt: Date.now(),
        error: true,
        status: 'error',
      })
    } finally {
      closeContextCompressionNotice(sessionId)
      activeStreamUnsubscribe?.()
      activeStreamUnsubscribe = null
      state.activeRequestId = null
      const finalAssistant = getAssistantMessage()
      for (const run of finalAssistant.toolRuns || []) {
        if (run.status === 'question') {
          run.status = 'aborted'
          run.content = 'QUESTION_CANCELLED: The request ended without a user answer.'
        } else if (run.status === 'ask' || (run.status === 'running' && finalAssistant.status === 'aborted')) {
          run.status = finalAssistant.status === 'aborted' ? 'aborted' : 'denied'
          run.isError = true
        }
      }
      updateAssistantMessage({ completedAt: finalAssistant.completedAt || Date.now(), streaming: false })
      setSessionLoading(sessionId, false)
      const summary = state.threads.find(thread => thread.id === state.activeThreadId)
      if (summary) {
        summary.messageCount = state.messages.length
        summary.updatedAt = Date.now()
      }
      if (state.disposeAfterReply) releaseAiSessionState(sessionId)
    }
    notifyAiReplyComplete(sessionId)
    return true
  }

  async function sendText(
    sessionId: string,
    text: string,
    onUpdate: (messages: ChatItem[]) => void,
    attachments?: AiImageAttachment[],
  ): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    const content = text.trim()
    const images = normalizeAiImages(attachments, t)
    if (!content && !images?.length) return false
    if (images?.length) {
      assertAiImageCapability([{ role: 'user', content, images }], activeProvider.value?.models.find(model => model.id === displayModelName.value)?.supportsImages, t)
    }
    if (state.loading) {
      ElMessage.warning(t('ai.busy'))
      return false
    }

    // Ensure there is an active thread before first message
    if (!state.activeThreadId) {
      await loadHistory(sessionId)
      if (!state.loaded || !state.activeThreadId) return false
    }

    const userMessage = createMessage('user', content)
    if (images) userMessage.images = JSON.parse(JSON.stringify(images))
    state.messages.push(userMessage)
    onUpdate(state.messages)
    try {
      await persistMessage(sessionId, userMessage, state.activeThreadId)
    } catch (err: any) {
      const index = state.messages.findIndex((message) => message.id === userMessage.id)
      if (index >= 0) state.messages.splice(index, 1)
      onUpdate(state.messages)
      ElMessage.error(sanitizeAiErrorMessage(err?.message || t('ai.requestFailed')))
      return false
    }
    return ensureAssistantReply(sessionId, onUpdate)
  }

  async function regenerateMessage(
    sessionId: string,
    assistantMessageId: string,
    onUpdate: (messages: ChatItem[]) => void
  ): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    if (state.loading) {
      ElMessage.warning(t('ai.busy'))
      return false
    }

    const index = state.messages.findIndex((m) => m.id === assistantMessageId)
    if (index < 0) return false
    const target = state.messages[index]
    if (target.role !== 'assistant') return false
    let lastAssistantIndex = -1
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === 'assistant') {
        lastAssistantIndex = i
        break
      }
    }
    if (index !== lastAssistantIndex || index !== state.messages.length - 1) return false

    // Keep messages before this assistant reply, then re-request.
    const removed = state.messages.slice(index)
    state.messages.splice(index, state.messages.length - index)
    onUpdate(state.messages)
    if (!await persistActiveThread(sessionId, true)) {
      state.messages.splice(index, state.messages.length - index, ...removed)
      onUpdate(state.messages)
      ElMessage.warning(t('ai.historySaveFailed'))
      return false
    }
    return ensureAssistantReply(sessionId, onUpdate)
  }

  async function retryMessage(
    sessionId: string,
    messageId: string,
    onUpdate: (messages: ChatItem[]) => void
  ): Promise<boolean> {
    return regenerateMessage(sessionId, messageId, onUpdate)
  }

  /**
   * Edit a user message inline and resend: remove it and everything after, then re-request.
   * Only the LAST user message may be edited — editing an older turn would silently
   * discard the whole conversation after it.
   */
  async function editUserMessageAndResend(
    sessionId: string,
    userMessageId: string,
    newText: string,
    onUpdate: (messages: ChatItem[]) => void,
    onPersisted?: () => void,
  ): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    if (state.loading) {
      ElMessage.warning(t('ai.busy'))
      return false
    }
    const index = state.messages.findIndex((m) => m.id === userMessageId)
    if (index < 0) return false
    if (state.messages[index].role !== 'user') return false

    let lastUserIndex = -1
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === 'user') {
        lastUserIndex = i
        break
      }
    }
    if (index !== lastUserIndex) return false

    const content = newText.trim()
    if (!content && !state.messages[index].images?.length) return false

    const removed = state.messages.slice(index)
    const edited: ChatItem = { ...state.messages[index], content, createdAt: Date.now() }
    state.messages.splice(index, state.messages.length - index, edited)
    onUpdate(state.messages)
    if (!await persistActiveThread(sessionId, true)) {
      state.messages.splice(index, state.messages.length - index, ...removed)
      onUpdate(state.messages)
      return false
    }
    onPersisted?.()
    return ensureAssistantReply(sessionId, onUpdate)
  }

  async function deleteMessage(
    sessionId: string,
    messageId: string,
    onUpdate: (messages: ChatItem[]) => void
  ): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    if (state.loading) {
      ElMessage.warning(t('ai.busy'))
      return false
    }
    const index = state.messages.findIndex((m) => m.id === messageId)
    if (index < 0) return false

    const target = state.messages[index]
    let removeCount = 1
    // Deleting a user message also drops the following assistant reply (one turn)
    if (target.role === 'user' && state.messages[index + 1]?.role === 'assistant') {
      removeCount = 2
    }
    const removed = state.messages.slice(index, index + removeCount)
    state.messages.splice(index, removeCount)
    onUpdate(state.messages)
    if (!await persistActiveThread(sessionId, true)) {
      state.messages.splice(index, 0, ...removed)
      onUpdate(state.messages)
      ElMessage.warning(t('ai.historySaveFailed'))
      return false
    }
    return true
  }

  async function updateConversation(
    sessionId: string,
    threadId: string,
    patch: { customTitle?: string | null; pinned?: boolean },
  ): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    try {
      const store = await window.LiteConnect.aiUpdateConversation(sessionId, threadId, patch)
      syncThreadSummaries(state, store)
      return true
    } catch (err: any) {
      ElMessage.warning(err?.message || t('ai.historySaveFailed'))
      return false
    }
  }

  async function startNewConversation(
    sessionId: string,
    onUpdate: (messages: ChatItem[]) => void
  ): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    if (state.loading) {
      ElMessage.warning(t('ai.busy'))
      return false
    }

    if (state.messages.length === 0) {
      ElMessage.info(t('ai.alreadyNewConversation'))
      return false
    }

    const leavingThreadId = state.activeThreadId
    const localSummary = state.threads.find((t) => t.id === leavingThreadId)
    const messages = state.messages
      .filter((m) => !m.streaming)
      .map(toHistoryRecord)

    try {
      // Main process: under write lock, flush messages + abort title HTTP + push empty thread
      // cloneForIpc: messages/usage may still carry Vue Proxies if read from reactive state
      const store = await window.LiteConnect.aiCreateConversation(
        sessionId,
        cloneForIpc({
          threadId: leavingThreadId || undefined,
          messages,
          title: localSummary?.title || undefined,
        }),
      )

      const active = store.threads.find((t) => t.id === store.activeThreadId) || store.threads[0]
      state.activeThreadId = active?.id || ''
      state.draftImages = []
      applyThreadMessages(state, active)
      syncThreadSummaries(state, store)
      onUpdate(state.messages)
      return true
    } catch (err: any) {
      ElMessage.warning(err?.message || t('ai.newConversationFailed'))
      return false
    }
  }

  async function switchConversation(
    sessionId: string,
    threadId: string,
    onUpdate: (messages: ChatItem[]) => void
  ): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    if (state.loading) {
      ElMessage.warning(t('ai.busy'))
      return false
    }
    if (threadId === state.activeThreadId) return true

    // Save current thread before switch
    const store = await buildStoreFromState(sessionId)
    const target = store.threads.find((t) => t.id === threadId)
    if (!target) {
      ElMessage.warning(t('ai.conversationNotFound'))
      return false
    }
    store.activeThreadId = threadId
    // Leaving an empty draft: drop it so it is not kept as history
    pruneEmptyThreadsLocal(store)
    try {
      await window.LiteConnect.setAiSessionStore(sessionId, cloneForIpc(store))
    } catch (err: any) {
      ElMessage.warning(err?.message || t('ai.switchConversationFailed'))
      return false
    }

    state.activeThreadId = threadId
    state.draftImages = []
    applyThreadMessages(state, await loadThreadImages(sessionId, target))
    syncThreadSummaries(state, store)
    onUpdate(state.messages)
    return true
  }

  async function deleteConversation(
    sessionId: string,
    threadId: string,
    onUpdate: (messages: ChatItem[]) => void
  ): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    if (state.loading) {
      ElMessage.warning(t('ai.busy'))
      return false
    }

    const store = await buildStoreFromState(sessionId)
    const idx = store.threads.findIndex((t) => t.id === threadId)
    if (idx < 0) return false

    store.threads.splice(idx, 1)
    if (store.threads.length === 0) {
      const empty: AiConversationThread = {
        id: createThreadId(),
        title: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        contextFiles: [],
      }
      store.threads.push(empty)
      store.activeThreadId = empty.id
    } else if (store.activeThreadId === threadId) {
      store.activeThreadId = store.threads[0].id
    }

    try {
      await window.LiteConnect.setAiSessionStore(sessionId, cloneForIpc(store))
    } catch (err: any) {
      ElMessage.warning(err?.message || t('ai.deleteHistoryFailed'))
      return false
    }

    const active = store.threads.find((t) => t.id === store.activeThreadId) || store.threads[0]
    if (state.activeThreadId !== active.id) state.draftImages = []
    state.activeThreadId = active.id
    applyThreadMessages(state, await loadThreadImages(sessionId, active))
    syncThreadSummaries(state, store)
    onUpdate(state.messages)
    return true
  }

  async function clearAllConversations(
    sessionId: string,
    onUpdate: (messages: ChatItem[]) => void
  ): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    if (state.loading) {
      ElMessage.warning(t('ai.busy'))
      return false
    }

    let defaultContextFiles: AiConversationContextFile[]
    try {
      const saved = await window.LiteConnect.getAiSessionStore(sessionId)
      defaultContextFiles = saved.defaultContextFiles
    } catch (err: any) {
      ElMessage.warning(err?.message || t('ai.clearHistoryFailed'))
      return false
    }

    const empty: AiConversationThread = {
      id: createThreadId(),
      title: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      contextFiles: [],
    }
    const store: AiSessionStore = {
      version: 1,
      activeThreadId: empty.id,
      threads: [empty],
      defaultContextFiles,
    }

    try {
      await window.LiteConnect.setAiSessionStore(sessionId, cloneForIpc(store))
    } catch (err: any) {
      ElMessage.warning(err?.message || t('ai.clearHistoryFailed'))
      return false
    }

    state.activeThreadId = empty.id
    state.draftImages = []
    applyThreadMessages(state, empty)
    syncThreadSummaries(state, store)
    onUpdate(state.messages)
    return true
  }

  async function clearMessages(sessionId: string, onUpdate: (messages: ChatItem[]) => void): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    if (state.loading) {
      ElMessage.warning(t('ai.busy'))
      return false
    }
    const threadId = state.activeThreadId
    if (!threadId) return false
    try {
      const store = await window.LiteConnect.getAiSessionStore(sessionId)
      if (state.activeThreadId !== threadId || state.loading) return false
      const thread = store.threads.find(item => item.id === threadId)
      if (!thread) throw new Error(t('ai.clearConversationFailed'))
      thread.messages = []
      thread.title = thread.customTitle || ''
      thread.updatedAt = Date.now()
      thread.toolGroups = []
      thread.compactionCount = 0
      delete thread.contextCheckpoint
      // Keep the host store's other threads and active selection as read.
      // Only update the originating thread; a later UI selection must survive.
      await window.LiteConnect.setAiSessionStore(sessionId, cloneForIpc(store))
      clearAiQuestionDrafts(state, threadId)
      if (state.activeThreadId === threadId) {
        state.messages.splice(0, state.messages.length)
        state.contextCheckpoint = undefined
        state.contextPressure = undefined
        state.compactionCount = 0
        state.toolGroups = []
        const selectedStore = { ...store, activeThreadId: threadId }
        syncThreadSummaries(state, selectedStore)
        onUpdate(state.messages)
      } else {
        const summary = state.threads.find(item => item.id === threadId)
        if (summary) { summary.title = thread.title || t('ai.newConversationTitle'); summary.messageCount = 0; summary.updatedAt = thread.updatedAt }
      }
      return true
    } catch {
      ElMessage.warning(t('ai.historySaveFailed'))
      return false
    }
  }

  function getSessionState(sessionId: string): AiSessionState {
    return getAiSessionState(sessionId)
  }

  function getQuestionDraft(sessionId: string, run: Pick<AiToolRun, 'id' | 'args'>) {
    return getAiQuestionDraft(getAiSessionState(sessionId), run)
  }

  function saveSessionInput(sessionId: string, input: string) {
    const state = getAiSessionState(sessionId)
    state.input = input
  }

  const api = typeof window === 'undefined' ? undefined : window.LiteConnect
  if (api?.onAiBackgroundReply && !backgroundSubscriptions.has(api)) {
    backgroundSubscriptions.add(api)
    api.onAiBackgroundReply(event => {
      const state = findAiSessionState(event.sessionId)
      if (!state || state.activeThreadId !== event.threadId) return
      const message = fromHistoryRecord(event.record)
      state.toolGroups = normalizeAiToolGroups([...normalizeAiToolGroups(state.toolGroups), ...aiToolGroupsFromHistory([message])])
      message.streaming = event.record.status === 'running'
      const previous = state.messages.find(item => item.id === message.id)
      if (message.streaming) {
        const phase = message.toolRuns?.some(run => run.status === 'question') ? 'question' : message.toolRuns?.some(run => run.status === 'ask') ? 'approval'
          : message.toolRuns?.some(run => run.status === 'running') ? 'tool'
            : message.content ? 'responding' : message.reasoningContent ? 'reasoning' : 'waiting'
        message.activity = { phase, phaseStartedAt: previous?.activity?.phase === phase ? previous.activity.phaseStartedAt : Date.now(), lastActivityAt: Date.now() }
      }
      if (previous) Object.assign(previous, message)
      else state.messages.push(message)
      if (event.passive) {
        const summary = state.threads.find(thread => thread.id === event.threadId)
        if (summary) { summary.messageCount = state.messages.length; summary.updatedAt = Date.now() }
        return
      }
      state.activeRequestId = message.streaming ? event.requestId : null
      setSessionLoading(event.sessionId, !!message.streaming)
      if (!message.streaming) {
        if (state.disposeAfterReply) {
          releaseAiSessionState(event.sessionId)
          syncAiApprovalPending(event.sessionId, false)
          return
        }
        const summary = state.threads.find(thread => thread.id === event.threadId)
        if (summary) { summary.messageCount = state.messages.length; summary.updatedAt = Date.now() }
        void api.getAiSessionStore(event.sessionId).then(store => {
          if (state.activeThreadId !== event.threadId) return
          const thread = store.threads.find(item => item.id === event.threadId)
          state.contextCheckpoint = thread?.contextCheckpoint
          state.compactionCount = Math.max(state.compactionCount, normalizeAiCompactionCount(thread?.compactionCount))
        }).catch(() => {})
        notifyAiReplyComplete(event.sessionId)
      }
    })
  }

  return {
    settings,
    refreshSettings: refreshAiSettings,
    replaceSettings: replaceAiSettings,
    activeProvider,
    displayModelName,
    activeContextWindowTokens,
    createMessage,
    sendText,
    resolveToolApproval,
    answerQuestion,
    getQuestionDraft,
    stopGeneration,
    compactContext,
    clearMessages,
    loadHistory,
    getSessionState,
    saveSessionInput,
    onReplyComplete,
    startNewConversation,
    updateConversation,
    switchConversation,
    deleteConversation,
    clearAllConversations,
    regenerateMessage,
    retryMessage,
    editUserMessageAndResend,
    deleteMessage,
  }
}
