import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type {
  AiChatMessage,
  AiChatResult,
  AiChatSegment,
  AiChatStreamPayload,
  AiConversationThread,
  AiConversationContextFile,
  AiContextCheckpoint,
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
import { threadTitleFromMessages } from '@/utils/ai/threadTitle'
import { getSftpListedCwd } from '@/utils/sftp/sftpListedCwd'
import { AI_SESSION_OVERHEAD_BYTES, estimateAiTextBytes } from '@shared/appResourceStats'
import { registerAiResourceProbe } from '@/composables/app/rendererResourceRegistry'

export type ChatItem = {
  id: string
  createdAt: number
  completedAt?: number
  role: 'user' | 'assistant'
  content: string
  error?: boolean
  status?: 'running' | 'completed' | 'aborted' | 'error'
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
  activeRequestId: string | null
  loaded: boolean
  disposeAfterReply: boolean
  contextCheckpoint?: AiContextCheckpoint
  contextFiles: AiConversationContextFile[]
  defaultContextFiles: AiConversationContextFile[]
}

const aiSessionStates = new Map<string, AiSessionState>()
const resolvingToolApprovals = new Set<string>()
const contextCompressionNotices = new Map<string, { close: () => void }>()

function closeContextCompressionNotice(sessionId: string): void {
  contextCompressionNotices.get(sessionId)?.close()
  contextCompressionNotices.delete(sessionId)
}

function createThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function getAiSessionState(sessionId: string): AiSessionState {
  let state = aiSessionStates.get(sessionId)
  if (!state) {
    state = reactive({
      messages: reactive([]) as ChatItem[],
      input: '',
      loading: false,
      persisting: false,
      activeThreadId: '',
      threads: reactive([]) as AiThreadSummary[],
      activeRequestId: null,
      loaded: false,
      disposeAfterReply: false,
      contextCheckpoint: undefined,
      contextFiles: [],
      defaultContextFiles: [],
    })
    aiSessionStates.set(sessionId, state)
  }
  return state
}

export function listAiResourceUsage(): { sessionCount: number; estimatedBytes: number } {
  let estimatedBytes = 0
  for (const state of aiSessionStates.values()) {
    estimatedBytes += AI_SESSION_OVERHEAD_BYTES
    estimatedBytes += estimateAiTextBytes(state.input?.length || 0)
    estimatedBytes += estimateAiTextBytes(state.contextFiles.reduce((total, file) => total + file.content.length, 0))
    for (const message of state.messages) {
      estimatedBytes += estimateAiTextBytes(
        (message.content?.length || 0) + (message.reasoningContent?.length || 0),
      )
    }
  }
  return { sessionCount: aiSessionStates.size, estimatedBytes }
}

registerAiResourceProbe(listAiResourceUsage)

/** Stop background work and release renderer-only state when its terminal closes. */
export function disposeAiSessionState(sessionId: string): void {
  const state = aiSessionStates.get(sessionId)
  if (!state) return
  syncAiApprovalPending(sessionId, false)
  closeContextCompressionNotice(sessionId)
  state.input = ''
  if (state.loading) {
    state.disposeAfterReply = true
    if (state.activeRequestId) {
      void window.LiteConnect.aiAbortChatStream(state.activeRequestId).catch(() => {})
    }
    return
  }
  aiSessionStates.delete(sessionId)
}

function emptyAiSettings(): AiSettings {
  return {
    providers: [],
    activeProviderId: null,
    activeModel: '',
    systemPrompt: '',
    toolPermission: 'ask',
  }
}

/** One copy for every sidebar instance — providers are app-wide, not per SSH session. */
const settings = ref<AiSettings>(emptyAiSettings())
let settingsEpoch = 0

function replaceAiSettings(next: AiSettings) {
  settingsEpoch += 1
  settings.value = next
}

async function refreshAiSettings(): Promise<AiSettings> {
  const epoch = ++settingsEpoch
  const next = await window.LiteConnect.getAiSettings()
  if (epoch !== settingsEpoch) return settings.value
  settings.value = next
  return next
}

export function useAiChat() {
  function cwdForSession(sessionId: string): string | undefined {
    const cwd = getSftpListedCwd(sessionId).trim()
    if (!cwd.startsWith('/') || cwd.length > 4096 || /[\0\r\n]/.test(cwd)) return undefined
    return cwd
  }

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
    if (typeof message.completedAt === 'number' && Number.isFinite(message.completedAt)) {
      record.completedAt = message.completedAt
    }
    if (message.reasoningContent != null && message.reasoningContent !== '') {
      record.reasoningContent = String(message.reasoningContent)
    }
    const usage = plainUsage(message.usage)
    if (usage) record.usage = usage
    if (message.error === true) record.error = true
    if (message.status) record.status = message.status
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
      content: record.content || (record.role === 'assistant' && record.status === 'aborted' ? t('ai.stopped') : ''),
      reasoningContent: record.reasoningContent,
      usage: record.usage,
      error: record.error,
      status: record.status,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
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
      diffSummary: run.diffSummary,
      diffPreview: run.diffPreview,
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
      state.messages.some((message) => message.streaming && (message.toolRuns || []).some((run) => run.status === 'ask'))
    syncAiApprovalPending(sessionId, pending)
  }

  function setSessionLoading(sessionId: string, value: boolean) {
    const state = getAiSessionState(sessionId)
    state.loading = value
    refreshApprovalPending(sessionId)
  }

  /**
   * Mirror main-process prune: keep conversations with messages + active draft.
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
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
          contextFiles: [...store.defaultContextFiles],
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
    state.defaultContextFiles = store.defaultContextFiles || []
    const summaries: AiThreadSummary[] = store.threads
      .map((thread) => ({
        id: thread.id,
        title: thread.title || t('ai.newConversationTitle'),
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        messageCount: thread.messages.length,
        contextFilePath: thread.contextFiles?.[0]?.path,
        active: thread.id === store.activeThreadId,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)

    state.threads.splice(0, state.threads.length, ...summaries)
    state.activeThreadId = store.activeThreadId
  }

  /**
   * Thread titles are always the first user message, so they are re-derived
   * on every persist instead of being frozen once (no model-written titles).
   */
  function resolveThreadTitle(
    messages: Array<{ role: string; content: string }>,
    existing?: { title?: string },
  ): string {
    return threadTitleFromMessages(messages) || existing?.title?.trim() || ''
  }

  function applyThreadMessages(state: AiSessionState, thread: AiConversationThread | undefined) {
    const messages = (thread?.messages || []).map(fromHistoryRecord)
    state.messages.splice(0, state.messages.length, ...messages)
    state.contextCheckpoint = thread?.contextCheckpoint
    state.contextFiles = thread?.contextFiles || []
  }

  async function buildStoreFromState(
    sessionId: string,
    invalidateContextCheckpoint = false,
  ): Promise<AiSessionStore> {
    const state = getAiSessionState(sessionId)
    let store: AiSessionStore
    try {
      store = await window.LiteConnect.getAiSessionStore(sessionId)
    } catch {
      store = {
        version: 1,
        activeThreadId: state.activeThreadId || createThreadId(),
        threads: [],
        defaultContextFiles: [...state.defaultContextFiles],
      }
    }

    if (!Array.isArray(store.threads)) store.threads = []
    if (store.threads.length === 0) {
      const threadId = state.activeThreadId || createThreadId()
      const local = state.threads.find((t) => t.id === threadId)
      store.threads.push({
        id: threadId,
        title: resolveThreadTitle(state.messages, local),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        contextFiles: [...state.contextFiles],
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
    if (invalidateContextCheckpoint) delete active.contextCheckpoint
    const localSummary = state.threads.find((t) => t.id === active!.id)
    active.title = active.messages.length
      ? resolveThreadTitle(active.messages, { title: active.title || localSummary?.title })
      : ''
    active.updatedAt = Date.now()
    pruneEmptyThreadsLocal(store)
    return store
  }

  /** Deep-clone via JSON so Vue Proxies never cross Electron IPC. */
  function cloneForIpc<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  async function persistActiveThread(
    sessionId: string,
    invalidateContextCheckpoint = false,
  ): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    state.persisting = true
    try {
      const store = await buildStoreFromState(sessionId, invalidateContextCheckpoint)
      await window.LiteConnect.setAiSessionStore(sessionId, cloneForIpc(store))
      syncThreadSummaries(state, store)
      if (invalidateContextCheckpoint) state.contextCheckpoint = undefined
      return true
    } catch (err) {
      console.warn('Failed to persist AI session store:', err)
      return false
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
        current.title = threadTitleFromMessages(state.messages) || current.title
        current.updatedAt = Date.now()
        current.messageCount = state.messages.filter((m) => !m.streaming).length
        current.active = true
        state.threads.sort((a, b) => b.updatedAt - a.updatedAt)
      }
    } catch (err) {
      console.warn('Failed to persist AI message:', err)
      throw err
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
      state.contextCheckpoint = active?.contextCheckpoint
      state.contextFiles = active?.contextFiles || []
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
    assistantMessage.status = 'running'
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
        } else if (payload.type === 'compaction') {
          const before = Math.max(0, Math.round((payload.value.beforeTokens / payload.value.budgetTokens) * 100))
          if (payload.value.phase === 'start') {
            closeContextCompressionNotice(sessionId)
            contextCompressionNotices.set(sessionId, ElMessage.info({
              message: t('ai.contextCompressionStarted', { before }),
              duration: 0,
              showClose: true,
            }))
          } else if (payload.value.phase === 'done') {
            closeContextCompressionNotice(sessionId)
            const after = Math.max(0, Math.round(((payload.value.afterTokens || 0) / payload.value.budgetTokens) * 100))
            ElMessage.success(t('ai.contextCompressionDone', { before, after }))
            void window.LiteConnect.getAiSessionStore(sessionId).then((store) => {
              const thread = store.threads.find(item => item.id === state.activeThreadId)
              state.contextCheckpoint = thread?.contextCheckpoint
            }).catch(() => {})
          } else {
            closeContextCompressionNotice(sessionId)
            ElMessage.warning(t('ai.contextCompressionFailed'))
          }
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
            // Kept for later phases so the card keeps showing what was approved.
            diffSummary: incoming.diffSummary ?? prev?.diffSummary,
            diffPreview: incoming.diffPreview ?? prev?.diffPreview,
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
        state.contextCheckpoint = reply.contextCheckpoint
        updateAssistantMessage({
          content: reply.content || current.content || (aborted ? t('ai.stopped') : ''),
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
        if (run.status === 'ask' || (run.status === 'running' && finalAssistant.status === 'aborted')) {
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
      if (state.disposeAfterReply) aiSessionStates.delete(sessionId)
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
    if (!content) return false

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

  async function setConversationContextFile(
    sessionId: string,
    file: AiConversationContextFile,
  ): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    if (state.loading || !state.activeThreadId) return false
    try {
      const store = await window.LiteConnect.aiSetContextFile(sessionId, state.activeThreadId, file)
      const active = store.threads.find((thread) => thread.id === store.activeThreadId)
      state.contextFiles = active?.contextFiles || []
      syncThreadSummaries(state, store)
      return true
    } catch (err: any) {
      ElMessage.warning(err?.message || t('ai.contextFileFailed'))
      return false
    }
  }

  async function removeConversationContextFile(sessionId: string, file: AiConversationContextFile): Promise<boolean> {
    const state = getAiSessionState(sessionId)
    if (state.loading || !state.activeThreadId) return false
    try {
      const store = await window.LiteConnect.aiRemoveContextFile(sessionId, state.activeThreadId, file.source, file.path)
      const active = store.threads.find(thread => thread.id === store.activeThreadId)
      state.contextFiles = active?.contextFiles || []
      syncThreadSummaries(state, store)
      return true
    } catch (err: any) {
      ElMessage.warning(err?.message || t('ai.contextFileFailed'))
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

    const currentFile = state.contextFiles
    const defaultFile = state.defaultContextFiles
    const alreadyEmptyDefault = state.messages.length === 0 &&
      JSON.stringify(currentFile) === JSON.stringify(defaultFile)
    if (alreadyEmptyDefault) {
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
      state.messages.splice(0, state.messages.length)
      state.contextCheckpoint = active?.contextCheckpoint
      state.contextFiles = active?.contextFiles || []
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
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        contextFiles: [...store.defaultContextFiles],
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
      contextFiles: [...defaultContextFiles],
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
    state.messages.splice(0, state.messages.length)
    state.contextCheckpoint = undefined
    state.contextFiles = [...defaultContextFiles]
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
    const removed = state.messages.slice()
    state.messages.splice(0, state.messages.length)
    onUpdate(state.messages)
    if (!await persistActiveThread(sessionId, true)) {
      state.messages.splice(0, state.messages.length, ...removed)
      onUpdate(state.messages)
      ElMessage.warning(t('ai.historySaveFailed'))
      return false
    }
    return true
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
    refreshSettings: refreshAiSettings,
    replaceSettings: replaceAiSettings,
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
    setConversationContextFile,
    removeConversationContextFile,
    switchConversation,
    deleteConversation,
    clearAllConversations,
    regenerateMessage,
    retryMessage,
    editUserMessageAndResend,
    deleteMessage,
  }
}
