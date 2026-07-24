import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiChatMessage, AiChatResult, AiChatStreamPayload, AiHistoryRecord, AiSettings, AiUsage } from '../../env.d'
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

function getAiSessionState(sessionId: string): AiSessionState {
  let state = aiSessionStates.get(sessionId)
  if (!state) {
    state = {
      messages: reactive([]) as ChatItem[],
      input: '',
      loading: false,
      persisting: false,
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

  async function persistMessage(sessionId: string, message: ChatItem) {
    try {
      await window.LiteConnect.appendAiSessionHistory(sessionId, toHistoryRecord(message))
    } catch (err) {
      console.warn('Failed to persist AI message:', err)
    }
  }

  async function loadHistory(sessionId: string): Promise<ChatItem[]> {
    try {
      const records = await window.LiteConnect.getAiSessionHistory(sessionId)
      return records.map(fromHistoryRecord)
    } catch (err: any) {
      ElMessage.warning(err?.message || t('ai.loadHistoryFailed'))
      return []
    }
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

    const userMessage = createMessage('user', content)
    state.messages.push(userMessage)
    onUpdate(state.messages)
    await persistMessage(sessionId, userMessage)
    setSessionLoading(sessionId, true)

    const chatMessages = state.messages
      .filter((message) => !message.error && !message.streaming)
      .map(({ role, content }) => ({ role, content }))

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

  function clearMessages(sessionId: string, onUpdate: (messages: ChatItem[]) => void) {
    const state = getAiSessionState(sessionId)
    state.messages.splice(0, state.messages.length)
    onUpdate(state.messages)
    window.LiteConnect.clearAiSessionHistory(sessionId).catch(() => {})
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
  }
}
