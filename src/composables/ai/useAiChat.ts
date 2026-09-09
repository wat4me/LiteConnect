import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type {
  AiChatMessage,
  AiChatResult,
  AiChatSegment,
  AiChatStreamPayload,
  AiConversationThread,
  AiHistoryRecord,
  AiSessionStore,
  AiSettings,
  AiThreadSummary,
  AiToolRun,
  AiUsage,
} from '../../env.d'
import { t } from '../../i18n'
import { firstAiModelId, resolveModelContextWindow } from '@shared/aiContext'
import { flattenConversationForApi } from '@shared/aiMessages'
import { notifyAiReplyComplete, onAiReplyComplete } from './aiReplyEvents'
import { syncAiApprovalPending } from './useAiApprovalHint'
import { appendTextSegment, ensureToolSegments } from '@/utils/ai/chatSegments'
import { getSftpListedCwd } from '@/composables/sftp/sftpListedCwd'

export type ChatItem = {
  id: string
  createdAt: number
  role: 'user' | 'assistant'
  content: string
  error?: boolean
  reasoningContent?: string
  usage?: AiUsage
  streaming?: boolean
  toolRuns?: AiToolRun[]
  /** True streaming order of reasoning / tool calls / content for display. */
  segments?: AiChatSegment[]
  /** Wire Chat Completions messages for this assistant turn (prefix cache). */
  apiMessages?: AiChatMessage[]
}

type AiSessionState = {
  messages: ChatItem[]
  input: string
  loading: boolean
  persisting: boolean
  activeThreadId: string
  threads: AiThreadSummary[]
  loaded: boolean
}

const aiSessionStates = new Map<string, AiSessionState>()
/** Prevent concurrent title jobs per session+thread */
const titleGenerationInFlight = new Set<string>()

function createThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function titleFromMessages(messages: Array<{ role: string; content: string }>): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim())
  if (!firstUser) return ''
  return firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 80)
}

function titleGenKey(sessionId: string, threadId: string): string {
  return `${sessionId}::${threadId}`
}

function getAiSessionState(sessionId: string): AiSessionState {
  let state = aiSessionStates.get(sessionId)
  if (!state) {
    state = {
      messages: reactive([]) as ChatItem[],
      input: '',
      loading: false,
      persisting: false,
      activeThreadId: '',
      threads: reactive([]) as AiThreadSummary[],
      loaded: false,
    }
    aiSessionStates.set(sessionId, state)
  }
  return state
}

export function useAiChat() {
  function cwdForSession(sessionId: string): string | undefined {
    const cwd = getSftpListedCwd(sessionId).trim()
    if (!cwd.startsWith('/') || cwd.length > 4096 || /[\0\r\n]/.test(cwd)) return undefined
    return cwd
  }

  const settings = ref<AiSettings>({
    providers: [],
    activeProviderId: null,
    activeModel: '',
    systemPrompt: '',
    toolPermission: 'ask',
  })

  const activeProvider = computed(() =>
    settings.value.providers.find((p) => p.id === settings.value.activeProviderId) || settings.value.providers[0] || null
  )

  const displayModelName = computed(() => {
    if (!activeProvider.value) return ''
    return settings.value.activeModel || firstAiModelId(activeProvider.value.models)
  })

  const activeContextWindowTokens = computed(() =>
    resolveModelContextWindow({
      model: displayModelName.value,
      models: activeProvider.value?.models,
      fallback: settings.value.contextWindowTokens,
    }),
  )

  let activeStreamUnsubscribe: (() => void) | null = null
  let activeRequestId: string | null = null
  let activeStreamSessionId: string | null = null

  function onReplyComplete(cb: (sessionId: string) => void): () => void {
    return onAiReplyComplete(cb)
  }

  async function resolveToolApproval(runId: string, approved: boolean): Promise<void> {
    if (!activeRequestId || !runId) return
    try {
      await window.LiteConnect.aiResolveToolApproval(activeRequestId, runId, approved)
    } catch {
      /* stream may have ended */
    }
  }

  async function stopGeneration(sessionId?: string): Promise<boolean> {
    if (!activeRequestId) return false
    if (sessionId && activeStreamSessionId && sessionId !== activeStreamSessionId) return false
    try {
      await window.LiteConnect.aiAbortChatStream(activeRequestId)
      return true
    } catch {
      return false
    }
  }

  function sanitizeAiErrorMessage(raw: string): string {
    return String(raw || '')
      .replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '')
      .trim()
  }

  function createMessage(
    role: 'user' | 'assistant',
    content: string,
    error = false,
    result?: Partial<AiChatResult> & { streaming?: boolean }
  ): ChatItem {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      role,
      content,
      error,
      reasoningContent: result?.reasoningContent,
      usage: plainUsage(result?.usage),
      streaming: result?.streaming,
    }
  }

  /**
   * Vue `reactive()` wraps nested objects (e.g. usage) in Proxies.
   * Electron IPC uses structured clone and cannot clone Proxies —
   * produces "An object could not be cloned". Always emit plain data.
   */
  function plainUsage(usage: AiUsage | undefined): AiUsage | undefined {
    if (!usage || typeof usage !== 'object') return undefined
    const out: AiUsage = {}
    if (typeof usage.promptTokens === 'number') out.promptTokens = usage.promptTokens
    if (typeof usage.completionTokens === 'number') out.completionTokens = usage.completionTokens
    if (typeof usage.totalTokens === 'number') out.totalTokens = usage.totalTokens
    if (typeof usage.reasoningTokens === 'number') out.reasoningTokens = usage.reasoningTokens
    return Object.keys(out).length > 0 ? out : undefined
  }

  function toHistoryRecord(message: ChatItem): AiHistoryRecord {
    const record: AiHistoryRecord = {
      id: String(message.id),
      role: message.role as 'user' | 'assistant',
      content: String(message.content ?? ''),
      createdAt: Number(message.createdAt) || Date.now(),
    }
    if (message.reasoningContent != null && message.reasoningContent !== '') {
      record.reasoningContent = String(message.reasoningContent)
    }
    const usage = plainUsage(message.usage)
    if (usage) record.usage = usage
    if (message.error === true) record.error = true
    if (message.toolRuns?.length) record.toolRuns = plainToolRuns(message.toolRuns)
    const segments = plainSegments(message.segments)
    if (segments) record.segments = segments
    const apiMessages = plainApiMessages(message.apiMessages)
    if (apiMessages) record.apiMessages = apiMessages
    return record
  }

  function fromHistoryRecord(record: AiHistoryRecord): ChatItem {
    return {
      id: record.id,
      role: record.role,
      content: record.content,
      reasoningContent: record.reasoningContent,
      usage: record.usage,
      error: record.error,
      createdAt: record.createdAt,
      toolRuns: record.toolRuns,
      segments: record.segments,
      apiMessages: record.apiMessages,
    }
  }

  function plainToolRuns(runs: AiToolRun[] | undefined): AiToolRun[] | undefined {
    if (!runs?.length) return undefined
    return runs.map((run) => ({
      id: String(run.id || ''),
      name: String(run.name || ''),
      args: String(run.args || ''),
      content: String(run.content || ''),
      isError: run.isError === true,
      status: run.status,
      risk: run.risk,
      reason: run.reason,
    }))
  }

  function plainSegments(segments: AiChatSegment[] | undefined): AiChatSegment[] | undefined {
    if (!segments?.length) return undefined
    return segments.map((seg) =>
      seg.kind === 'tool' ? { kind: 'tool' as const, runId: String(seg.runId) } : { kind: seg.kind, text: String(seg.text) },
    )
  }

  function plainApiMessages(messages: AiChatMessage[] | undefined): AiChatMessage[] | undefined {
    if (!messages?.length) return undefined
    return messages.map((m) => {
      if (m.role === 'tool') {
        return { role: 'tool' as const, content: String(m.content ?? ''), toolCallId: String(m.toolCallId || '') }
      }
      if (m.role === 'user' || m.role === 'system') {
        return { role: m.role, content: String(m.content ?? '') }
      }
      const row: AiChatMessage = { role: 'assistant', content: String(m.content ?? '') }
      if (m.reasoningContent) row.reasoningContent = String(m.reasoningContent)
      if (m.toolCalls?.length) {
        row.toolCalls = m.toolCalls.map((c) => ({
          id: String(c.id || ''),
          type: 'function' as const,
          function: {
            name: String(c.function?.name || ''),
            arguments: String(c.function?.arguments || ''),
          },
        }))
      }
      return row
    })
  }

  function refreshApprovalPending(sessionId: string) {
    const state = getAiSessionState(sessionId)
    const pending =
      state.loading &&
      state.messages.some((message) => (message.toolRuns || []).some((run) => run.status === 'ask'))
    syncAiApprovalPending(sessionId, pending)
  }

  function setSessionLoading(sessionId: string, value: boolean) {
    const state = getAiSessionState(sessionId)
    state.loading = value
    refreshApprovalPending(sessionId)
  }

  /**
   * Mirror main-process prune: keep non-empty threads + active draft only.
   * Avoids empty "新对话" shells piling up in local thread list / next persist.
   */
  function pruneEmptyThreadsLocal(store: AiSessionStore): void {
    if (!Array.isArray(store.threads)) store.threads = []
    store.threads = store.threads.filter(
      (thread) =>
        (Array.isArray(thread.messages) && thread.messages.length > 0) ||
        thread.id === store.activeThreadId,
    )
    if (store.threads.length === 0) {
      const id = createThreadId()
      store.threads = [
        {
          id,
          title: '',
          titleGenerated: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
        },
      ]
      store.activeThreadId = id
      return
    }
    if (!store.threads.some((thread) => thread.id === store.activeThreadId)) {
      store.activeThreadId = store.threads[0].id
    }
  }

  function syncThreadSummaries(state: AiSessionState, store: AiSessionStore) {
    pruneEmptyThreadsLocal(store)
    const summaries: AiThreadSummary[] = store.threads
      .map((thread) => ({
        id: thread.id,
        title: thread.title || t('ai.newConversationTitle'),
        titleGenerated: thread.titleGenerated === true,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        messageCount: thread.messages.length,
        active: thread.id === store.activeThreadId,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)

    state.threads.splice(0, state.threads.length, ...summaries)
    state.activeThreadId = store.activeThreadId
  }

  function resolveThreadTitle(
    messages: Array<{ role: string; content: string }>,
    existing: { title?: string; titleGenerated?: boolean } | undefined,
    localSummary?: AiThreadSummary,
  ): { title: string; titleGenerated: boolean } {
    if (localSummary?.titleGenerated && localSummary.title?.trim()) {
      return { title: localSummary.title.trim().slice(0, 80), titleGenerated: true }
    }
    if (existing?.titleGenerated && existing.title?.trim()) {
      return { title: existing.title.trim().slice(0, 80), titleGenerated: true }
    }
    return {
      title: titleFromMessages(messages) || existing?.title || '',
      titleGenerated: false,
    }
  }

  function applyThreadMessages(state: AiSessionState, thread: AiConversationThread | undefined) {
    const messages = (thread?.messages || []).map(fromHistoryRecord)
    state.messages.splice(0, state.messages.length, ...messages)
  }

  async function buildStoreFromState(sessionId: string): Promise<AiSessionStore> {
    const state = getAiSessionState(sessionId)
    let store: AiSessionStore
    try {
      store = await window.LiteConnect.getAiSessionStore(sessionId)
    } catch {
      store = {
        version: 1,
        activeThreadId: state.activeThreadId || createThreadId(),
        threads: [],
      }
    }

    if (!Array.isArray(store.threads)) store.threads = []
    if (store.threads.length === 0) {
      const threadId = state.activeThreadId || createThreadId()
      const local = state.threads.find((t) => t.id === threadId)
      const resolved = resolveThreadTitle(state.messages, undefined, local)
      store.threads.push({
        id: threadId,
        title: resolved.title,
        titleGenerated: resolved.titleGenerated,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      })
      store.activeThreadId = threadId
      state.activeThreadId = threadId
    }

    const activeId = state.activeThreadId || store.activeThreadId
    let active = store.threads.find((t) => t.id === activeId)
    if (!active) {
      active = store.threads[0]
      state.activeThreadId = active.id
      store.activeThreadId = active.id
    } else {
      store.activeThreadId = active.id
      state.activeThreadId = active.id
    }

    active.messages = state.messages
      .filter((m) => !m.streaming)
      .map(toHistoryRecord)
    const localSummary = state.threads.find((t) => t.id === active!.id)
    const resolved = resolveThreadTitle(active.messages, active, localSummary)
    active.title = resolved.title
    active.titleGenerated = resolved.titleGenerated
    active.updatedAt = Date.now()
    pruneEmptyThreadsLocal(store)
    return store
  }

  /** Deep-clone via JSON so Vue Proxies never cross Electron IPC. */
  function cloneForIpc<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  async function persistActiveThread(sessionId: string) {
    const state = getAiSessionState(sessionId)
    state.persisting = true
    try {
      const store = await buildStoreFromState(sessionId)
      await window.LiteConnect.setAiSessionStore(sessionId, cloneForIpc(store))
      syncThreadSummaries(state, store)
    } catch (err) {
      console.warn('Failed to persist AI session store:', err)
    } finally {
      state.persisting = false
    }
  }

  async function persistMessage(sessionId: string, message: ChatItem, threadId?: string) {
    try {
      const targetThreadId = threadId || getAiSessionState(sessionId).activeThreadId
      await window.LiteConnect.appendAiSessionHistory(
        sessionId,
        cloneForIpc(toHistoryRecord(message)),
        targetThreadId || undefined,
      )
      const state = getAiSessionState(sessionId)
      // Keep local thread title/meta roughly in sync without full reload
      const current = state.threads.find((t) => t.id === state.activeThreadId)
      if (current) {
        if (!current.titleGenerated) {
          current.title = titleFromMessages(state.messages) || current.title
        }
        current.updatedAt = Date.now()
        current.messageCount = state.messages.filter((m) => !m.streaming).length
        current.active = true
        state.threads.sort((a, b) => b.updatedAt - a.updatedAt)
      }
    } catch (err) {
      console.warn('Failed to persist AI message:', err)
    }
  }

  /**
   * After the first successful assistant reply, ask the model for a short title.
   * Non-blocking. Title HTTP is aborted when user opens a new conversation.
   */
  async function maybeGenerateThreadTitle(sessionId: string): Promise<void> {
    const state = getAiSessionState(sessionId)
    // Capture thread id + message snapshot up front — user may click 新开对话
    // while the network request is still in flight.
    const threadId = state.activeThreadId
    if (!threadId) return

    const summary = state.threads.find((t) => t.id === threadId)
    if (summary?.titleGenerated) return

    const firstUser = state.messages.find((m) => m.role === 'user' && m.content.trim())
    const firstAssistant = state.messages.find(
      (m) => m.role === 'assistant' && !m.error && !m.streaming && m.content.trim(),
    )
    if (!firstUser || !firstAssistant) return

    const userText = firstUser.content
    const assistantText = firstAssistant.content

    const key = titleGenKey(sessionId, threadId)
    if (titleGenerationInFlight.has(key)) return
    titleGenerationInFlight.add(key)

    try {
      const result = await window.LiteConnect.aiGenerateConversationTitle({
        userText,
        assistantText,
        sessionId,
        threadId,
      })
      const clean = (result?.title || '').replace(/\s+/g, ' ').trim().slice(0, 40)
      // Empty = soft fail / aborted; keep provisional first-user-message title
      if (!clean) return

      // Atomic title patch on disk (safe if active thread already switched)
      const { ok } = await window.LiteConnect.aiSetThreadTitle(sessionId, threadId, clean)
      if (!ok) return

      const now = Date.now()
      const local = state.threads.find((t) => t.id === threadId)
      if (local) {
        local.title = clean
        local.titleGenerated = true
        local.updatedAt = now
        state.threads.sort((a, b) => b.updatedAt - a.updatedAt)
      }
    } catch {
      // Soft feature — never surface toasts; provisional title stays
    } finally {
      titleGenerationInFlight.delete(key)
    }
  }

  async function loadHistory(sessionId: string): Promise<ChatItem[]> {
    const state = getAiSessionState(sessionId)
    try {
      const store = await window.LiteConnect.getAiSessionStore(sessionId)
      syncThreadSummaries(state, store)
      const active = store.threads.find((t) => t.id === store.activeThreadId) || store.threads[0]
      state.activeThreadId = active?.id || ''
      const messages = (active?.messages || []).map(fromHistoryRecord)
      state.loaded = true
      return messages
    } catch (err: any) {
      ElMessage.warning(err?.message || t('ai.loadHistoryFailed'))
      state.loaded = true
      return []
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

    try {
      const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      activeRequestId = requestId
      activeStreamSessionId = sessionId
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
            reason: incoming.reason ?? prev?.reason,
          }
          if (idx >= 0) Object.assign(runs[idx], nextRun)
          else runs.push(nextRun)
          if (!current.segments) current.segments = []
          ensureToolSegments(current.segments, runs)
          refreshApprovalPending(sessionId)
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
        updateAssistantMessage({
          content: reply.content || current.content || (aborted ? t('ai.stopped') : ''),
          reasoningContent: reply.reasoningContent || current.reasoningContent,
          usage: plainUsage(reply.usage || current.usage),
          toolRuns: finalToolRuns,
          segments: plainSegments(reply.segments) || ensureToolSegments(current.segments, finalToolRuns),
          apiMessages: finalApiMessages,
          error: reply.error === true,
        })
      } finally {
        activeStreamUnsubscribe?.()
        activeStreamUnsubscribe = null
        activeRequestId = null
        activeStreamSessionId = null
      }
    } catch (err: any) {
      // Transport/storage failures are shown locally; main owns all assistant writes.
      const current = getAssistantMessage()
      const detail = sanitizeAiErrorMessage(err?.message || t('ai.requestFailed'))
      const suffix = `${current.content ? '\n\n' : ''}${detail}`
      if (!current.segments) current.segments = []
      appendTextSegment(current.segments, 'content', suffix)
      updateAssistantMessage({ content: current.content + suffix, error: true })
    } finally {
      activeStreamUnsubscribe?.()
      activeStreamUnsubscribe = null
      activeRequestId = null
      activeStreamSessionId = null
      updateAssistantMessage({ streaming: false })
      setSessionLoading(sessionId, false)
      const summary = state.threads.find(thread => thread.id === state.activeThreadId)
      if (summary) {
        summary.messageCount = state.messages.length
        summary.updatedAt = Date.now()
      }
    }
    const finalAssistant = getAssistantMessage()
    if (finalAssistant && !finalAssistant.error && finalAssistant.content.trim()) {
      void maybeGenerateThreadTitle(sessionId)
    }
    notifyAiReplyComplete(sessionId)
    return true
  }

  async function sendText(
    sessionId: string,
    text: string,
    onUpdate: (messages: ChatItem[]) => void
  ): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    const content = text.trim()
    if (!content) return false
    if (state.loading) {
      ElMessage.warning(t('ai.busy'))
      return false
    }

    // Ensure there is an active thread before first message
    if (!state.activeThreadId) {
      const store = await window.LiteConnect.getAiSessionStore(sessionId).catch(() => null)
      if (store) {
        syncThreadSummaries(state, store)
        const active = store.threads.find((t) => t.id === store.activeThreadId) || store.threads[0]
        if (active && state.messages.length === 0) {
          applyThreadMessages(state, active)
        }
        state.activeThreadId = store.activeThreadId
      } else {
        state.activeThreadId = createThreadId()
      }
    }

    const userMessage = createMessage('user', content)
    state.messages.push(userMessage)
    onUpdate(state.messages)
    await persistMessage(sessionId, userMessage, state.activeThreadId)
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

    // Keep messages before this assistant reply, then re-request
    state.messages.splice(index, state.messages.length - index)
    onUpdate(state.messages)
    await persistActiveThread(sessionId)
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
    onUpdate: (messages: ChatItem[]) => void
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
    if (!content) return false

    state.messages.splice(index, state.messages.length - index)
    onUpdate(state.messages)
    await persistActiveThread(sessionId)
    return sendText(sessionId, content, onUpdate)
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
    state.messages.splice(index, removeCount)
    onUpdate(state.messages)
    await persistActiveThread(sessionId)
    return true
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

    // Already empty active thread → no-op
    if (state.messages.length === 0) {
      ElMessage.info(t('ai.alreadyNewConversation'))
      return false
    }

    const leavingThreadId = state.activeThreadId
    const localSummary = state.threads.find((t) => t.id === leavingThreadId)
    const messages = state.messages
      .filter((m) => !m.streaming)
      .map(toHistoryRecord)

    // Drop in-flight title job for the thread we are leaving (renderer side)
    if (leavingThreadId) {
      titleGenerationInFlight.delete(titleGenKey(sessionId, leavingThreadId))
    }

    try {
      // Main process: under write lock, flush messages + abort title HTTP + push empty thread
      // cloneForIpc: messages/usage may still carry Vue Proxies if read from reactive state
      const store = await window.LiteConnect.aiCreateConversation(
        sessionId,
        cloneForIpc({
          threadId: leavingThreadId || undefined,
          messages,
          title: localSummary?.title || undefined,
          titleGenerated: localSummary?.titleGenerated === true,
        }),
      )

      const active = store.threads.find((t) => t.id === store.activeThreadId) || store.threads[0]
      state.activeThreadId = active?.id || ''
      state.messages.splice(0, state.messages.length)
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
    applyThreadMessages(state, target)
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
        titleGenerated: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
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
    state.activeThreadId = active.id
    applyThreadMessages(state, active)
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

    const empty: AiConversationThread = {
      id: createThreadId(),
      title: '',
      titleGenerated: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    }
    const store: AiSessionStore = {
      version: 1,
      activeThreadId: empty.id,
      threads: [empty],
    }

    try {
      await window.LiteConnect.setAiSessionStore(sessionId, cloneForIpc(store))
    } catch (err: any) {
      ElMessage.warning(err?.message || t('ai.clearHistoryFailed'))
      return false
    }

    state.activeThreadId = empty.id
    state.messages.splice(0, state.messages.length)
    syncThreadSummaries(state, store)
    onUpdate(state.messages)
    return true
  }

  function clearMessages(sessionId: string, onUpdate: (messages: ChatItem[]) => void) {
    const state = getAiSessionState(sessionId)
    state.messages.splice(0, state.messages.length)
    onUpdate(state.messages)
    persistActiveThread(sessionId).catch(() => {})
  }

  function getSessionState(sessionId: string): AiSessionState {
    return getAiSessionState(sessionId)
  }

  function saveSessionInput(sessionId: string, input: string) {
    const state = getAiSessionState(sessionId)
    state.input = input
  }

  return {
    settings,
    activeProvider,
    displayModelName,
    activeContextWindowTokens,
    createMessage,
    sendText,
    resolveToolApproval,
    stopGeneration,
    clearMessages,
    loadHistory,
    getSessionState,
    saveSessionInput,
    onReplyComplete,
    startNewConversation,
    switchConversation,
    deleteConversation,
    clearAllConversations,
    regenerateMessage,
    retryMessage,
    editUserMessageAndResend,
    deleteMessage,
  }
}
