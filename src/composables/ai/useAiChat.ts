import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type {
  AiChatMessage,
  AiChatResult,
  AiChatStreamPayload,
  AiConversationThread,
  AiHistoryRecord,
  AiSessionStore,
  AiSettings,
  AiThreadSummary,
  AiUsage,
} from '../../env.d'
import { t } from '../../i18n'

export type ChatItem = AiChatMessage & {
  id: string
  createdAt: number
  error?: boolean
  reasoningContent?: string
  usage?: AiUsage
  streaming?: boolean
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
const replyCompleteListeners = new Set<(sessionId: string) => void>()

function notifyReplyComplete(sessionId: string) {
  for (const listener of replyCompleteListeners) {
    try {
      listener(sessionId)
    } catch (err) {
      console.warn('[AI] reply complete listener error:', err)
    }
  }
}

function createThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function titleFromMessages(messages: Array<{ role: string; content: string }>): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim())
  if (!firstUser) return ''
  return firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 80)
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
  const settings = ref<AiSettings>({
    providers: [],
    activeProviderId: null,
    activeModel: '',
    systemPrompt: '',
  })

  const activeProvider = computed(() =>
    settings.value.providers.find((p) => p.id === settings.value.activeProviderId) || settings.value.providers[0] || null
  )

  const displayModelName = computed(() => {
    if (!activeProvider.value) return ''
    const model = settings.value.activeModel || activeProvider.value.models[0] || ''
    return model
  })

  let activeStreamUnsubscribe: (() => void) | null = null
  let activeRequestId: string | null = null
  let activeStreamSessionId: string | null = null

  function onReplyComplete(cb: (sessionId: string) => void): () => void {
    replyCompleteListeners.add(cb)
    return () => replyCompleteListeners.delete(cb)
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

  function createMessage(
    role: AiChatMessage['role'],
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
      usage: result?.usage,
      streaming: result?.streaming,
    }
  }

  function toHistoryRecord(message: ChatItem): AiHistoryRecord {
    return {
      id: message.id,
      role: message.role as 'user' | 'assistant',
      content: message.content,
      reasoningContent: message.reasoningContent,
      usage: message.usage,
      error: message.error,
      createdAt: message.createdAt,
    }
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
    }
  }

  function setSessionLoading(sessionId: string, value: boolean) {
    const state = getAiSessionState(sessionId)
    state.loading = value
  }

  function syncThreadSummaries(state: AiSessionState, store: AiSessionStore) {
    const summaries: AiThreadSummary[] = store.threads
      .map((thread) => ({
        id: thread.id,
        title: thread.title || t('ai.newConversationTitle'),
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        messageCount: thread.messages.length,
        active: thread.id === store.activeThreadId,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)

    state.threads.splice(0, state.threads.length, ...summaries)
    state.activeThreadId = store.activeThreadId
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
      store.threads.push({
        id: threadId,
        title: titleFromMessages(state.messages),
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
    active.title = titleFromMessages(active.messages) || active.title || ''
    active.updatedAt = Date.now()
    return store
  }

  async function persistActiveThread(sessionId: string) {
    const state = getAiSessionState(sessionId)
    state.persisting = true
    try {
      const store = await buildStoreFromState(sessionId)
      await window.LiteConnect.setAiSessionStore(sessionId, store)
      syncThreadSummaries(state, store)
    } catch (err) {
      console.warn('Failed to persist AI session store:', err)
    } finally {
      state.persisting = false
    }
  }

  async function persistMessage(sessionId: string, message: ChatItem) {
    try {
      await window.LiteConnect.appendAiSessionHistory(sessionId, toHistoryRecord(message))
      const state = getAiSessionState(sessionId)
      // Keep local thread title/meta roughly in sync without full reload
      const title = titleFromMessages(state.messages)
      const current = state.threads.find((t) => t.id === state.activeThreadId)
      if (current) {
        current.title = title || current.title
        current.updatedAt = Date.now()
        current.messageCount = state.messages.filter((m) => !m.streaming).length
        current.active = true
        state.threads.sort((a, b) => b.updatedAt - a.updatedAt)
      }
    } catch (err) {
      console.warn('Failed to persist AI message:', err)
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

    const chatMessages = state.messages
      .filter((message) => !message.error && !message.streaming && message.content.trim())
      .map(({ role, content }) => ({ role, content }))

    if (chatMessages.length === 0) {
      ElMessage.warning(t('ai.needUserMessage'))
      return false
    }

    setSessionLoading(sessionId, true)

    const assistantMessage = createMessage('assistant', '', false, { streaming: true })
    state.messages.push(assistantMessage)
    onUpdate(state.messages)
    const assistantIndex = state.messages.length - 1

    const getAssistantMessage = () => state.messages[assistantIndex] || assistantMessage
    let checkpointTimer: ReturnType<typeof setTimeout> | null = null
    let checkpointInFlight: Promise<void> | null = null

    const scheduleAssistantCheckpoint = () => {
      if (checkpointTimer) clearTimeout(checkpointTimer)
      checkpointTimer = setTimeout(() => {
        checkpointTimer = null
        const msg = getAssistantMessage()
        if (!msg.content && !msg.reasoningContent) return
        const p: Promise<void> = persistMessage(sessionId, { ...msg, streaming: false }).then(
          () => undefined,
          () => undefined,
        )
        checkpointInFlight = p.finally(() => {
          if (checkpointInFlight === p) checkpointInFlight = null
        })
      }, 1200)
    }

    const updateAssistantMessage = (patch: Partial<ChatItem>) => {
      const current = getAssistantMessage()
      state.messages.splice(assistantIndex, 1, { ...current, ...patch })
      onUpdate(state.messages)
      if (patch.content !== undefined || patch.reasoningContent !== undefined) {
        scheduleAssistantCheckpoint()
      }
    }

    try {
      const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      activeRequestId = requestId
      activeStreamSessionId = sessionId
      activeStreamUnsubscribe = window.LiteConnect.onAiChatStream(requestId, (payload: AiChatStreamPayload) => {
        const current = getAssistantMessage()
        if (payload.type === 'content') {
          updateAssistantMessage({ content: current.content + payload.value })
        } else if (payload.type === 'reasoning') {
          updateAssistantMessage({ reasoningContent: (current.reasoningContent || '') + payload.value })
        } else if (payload.type === 'usage') {
          updateAssistantMessage({ usage: payload.value })
        }
      })

      try {
        const reply = await window.LiteConnect.aiChatStream(requestId, chatMessages)
        const current = getAssistantMessage()
        const aborted = !!(reply as any)?.aborted
        updateAssistantMessage({
          content: reply.content || current.content || (aborted ? t('ai.stopped') : ''),
          reasoningContent: reply.reasoningContent || current.reasoningContent,
          usage: reply.usage || current.usage,
          error: aborted && !reply.content && !current.content ? false : current.error,
        })
      } finally {
        activeStreamUnsubscribe?.()
        activeStreamUnsubscribe = null
        activeRequestId = null
        activeStreamSessionId = null
      }
    } catch (err: any) {
      const current = getAssistantMessage()
      const aborted = err?.name === 'AbortError' || /abort|取消|停止/i.test(String(err?.message || ''))
      if (aborted) {
        updateAssistantMessage({
          content: current.content || t('ai.stopped'),
        })
      } else if (!current.content && !current.reasoningContent) {
        try {
          const reply = await window.LiteConnect.aiChat(chatMessages)
          updateAssistantMessage({
            content: reply.content,
            reasoningContent: reply.reasoningContent,
            usage: reply.usage,
          })
        } catch (fallbackErr: any) {
          updateAssistantMessage({
            content: fallbackErr?.message || err?.message || t('ai.requestFailed'),
            error: true,
          })
        }
      } else {
        updateAssistantMessage({
          content: `${current.content}\n\n${err?.message || t('ai.requestInterrupted')}`,
          error: true,
        })
      }
    } finally {
      if (checkpointTimer) {
        clearTimeout(checkpointTimer)
        checkpointTimer = null
      }
      activeRequestId = null
      activeStreamSessionId = null
      updateAssistantMessage({ streaming: false })
      state.persisting = true
      try {
        if (checkpointInFlight) await checkpointInFlight
        await persistMessage(sessionId, getAssistantMessage())
      } finally {
        state.persisting = false
        setSessionLoading(sessionId, false)
      }
    }
    notifyReplyComplete(sessionId)
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
    await persistMessage(sessionId, userMessage)
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
   * Edit a user message: remove it and everything after, put text into input via callback result.
   * Caller should put returned text into input for user to re-send (or pass autoResend).
   */
  async function prepareEditUserMessage(
    sessionId: string,
    userMessageId: string,
    onUpdate: (messages: ChatItem[]) => void
  ): Promise<string | null> {
    const state = getAiSessionState(sessionId)
    if (state.loading) {
      ElMessage.warning(t('ai.busy'))
      return null
    }
    const index = state.messages.findIndex((m) => m.id === userMessageId)
    if (index < 0) return null
    const target = state.messages[index]
    if (target.role !== 'user') return null

    const content = target.content
    state.messages.splice(index, state.messages.length - index)
    onUpdate(state.messages)
    await persistActiveThread(sessionId)
    return content
  }

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

    // Persist current thread, then create a fresh empty one
    const store = await buildStoreFromState(sessionId)
    const now = Date.now()
    const newThread: AiConversationThread = {
      id: createThreadId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: [],
    }
    store.threads.push(newThread)
    store.activeThreadId = newThread.id

    try {
      await window.LiteConnect.setAiSessionStore(sessionId, store)
    } catch (err: any) {
      ElMessage.warning(err?.message || t('ai.newConversationFailed'))
      return false
    }

    state.activeThreadId = newThread.id
    state.messages.splice(0, state.messages.length)
    syncThreadSummaries(state, store)
    onUpdate(state.messages)
    return true
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
    try {
      await window.LiteConnect.setAiSessionStore(sessionId, store)
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
      const empty = {
        id: createThreadId(),
        title: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [] as AiHistoryRecord[],
      }
      store.threads.push(empty)
      store.activeThreadId = empty.id
    } else if (store.activeThreadId === threadId) {
      store.activeThreadId = store.threads[0].id
    }

    try {
      await window.LiteConnect.setAiSessionStore(sessionId, store)
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

    const empty = {
      id: createThreadId(),
      title: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [] as AiHistoryRecord[],
    }
    const store: AiSessionStore = {
      version: 1,
      activeThreadId: empty.id,
      threads: [empty],
    }

    try {
      await window.LiteConnect.setAiSessionStore(sessionId, store)
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
    createMessage,
    sendText,
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
    prepareEditUserMessage,
    editUserMessageAndResend,
    deleteMessage,
  }
}
