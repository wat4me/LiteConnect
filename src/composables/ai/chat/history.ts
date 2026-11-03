import type {
  AiConversationSummary, AiConversationThread, AiSaveConversationPayload, AiSessionStore, AiThreadSummary,
} from '@shared/types/ai'
import type { AiSessionState, ChatItem } from '@/domain/ai/chat'
import { ElMessage } from 'element-plus/es/components/message/index'
import { t } from '@/i18n'
import { normalizeAiCompactionCount } from '@shared/aiCompaction'
import { aiToolGroupsFromHistory, normalizeAiToolGroups } from '@shared/aiToolCatalog'
import { threadTitleFromMessages } from '@/utils/ai/threadTitle'
import { fromHistoryRecord, toHistoryRecord, cloneForIpc } from '@/utils/ai/chatHistoryProjection'
import { getAiSessionState } from './sessionState'

export function createThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const historyLoads = new Map<string, Promise<ChatItem[]>>()
/**
 * Mirror main-process prune: keep conversations with messages + active draft.
 * Avoids empty "新对话" shells piling up in local thread list / next persist.
 */
export function pruneEmptyThreadsLocal(store: AiSessionStore): void {
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
        contextFiles: [],
      },
    ]
    store.activeThreadId = id
    return
  }
  if (!store.threads.some((thread) => thread.id === store.activeThreadId)) {
    store.activeThreadId = store.threads[0].id
  }
}

/** Thread list and selection as reported by main; message bodies stay out of this path. */
export function applyConversationSummary(state: AiSessionState, summary: AiConversationSummary) {
  state.defaultContextFiles = summary.defaultContextFiles || []
  const summaries: AiThreadSummary[] = summary.threads
    .map((thread) => ({
      ...thread,
      title: thread.title || t('ai.newConversationTitle'),
      pinned: thread.pinned === true,
      active: thread.id === summary.activeThreadId,
    }))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt)

  state.threads.splice(0, state.threads.length, ...summaries)
  state.activeThreadId = summary.activeThreadId
  const retainedThreads = new Set(summaries.map(thread => thread.id))
  for (const [key, draft] of state.questionDrafts || []) {
    if (!retainedThreads.has(draft.threadId)) state.questionDrafts!.delete(key)
  }
}

export function syncThreadSummaries(state: AiSessionState, store: AiSessionStore) {
  pruneEmptyThreadsLocal(store)
  applyConversationSummary(state, {
    activeThreadId: store.activeThreadId,
    defaultContextFiles: store.defaultContextFiles || [],
    threads: store.threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      customTitle: thread.customTitle,
      pinned: thread.pinned === true,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messageCount: thread.messages.length,
      active: thread.id === store.activeThreadId,
    })),
  })
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

export function applyThreadMessages(state: AiSessionState, thread: AiConversationThread | undefined) {
  const messages = (thread?.messages || []).map(fromHistoryRecord)
  state.messages.splice(0, state.messages.length, ...messages)
  state.contextCheckpoint = thread?.contextCheckpoint
  state.contextPressure = undefined
  state.compactionCount = normalizeAiCompactionCount(thread?.compactionCount) || normalizeAiCompactionCount(thread?.contextCheckpoint?.compactionCount)
  state.contextFiles = thread?.contextFiles || []
  state.toolGroups = thread?.toolGroups || []
}

export async function loadThreadImages(sessionId: string, thread: AiConversationThread): Promise<AiConversationThread> {
  if (!thread.messages.some(message => message.images?.some(image => !image.dataUrl && !image.missing))) return thread
  const refreshed = await window.LiteConnect.getAiSessionStore(sessionId)
  return refreshed.threads.find(item => item.id === thread.id) || thread
}

export async function buildStoreFromState(
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
      contextFiles: [],
    })
    store.activeThreadId = threadId
    state.activeThreadId = threadId
  }

  const activeId = state.activeThreadId || store.activeThreadId
  let active = store.threads.find((t) => t.id === activeId)
  if (!active) {
    // Another SSH window may have pruned this window's empty draft.
    // Recreate its own thread instead of overwriting a different conversation.
    active = {
      id: activeId, title: '', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [], contextFiles: [...state.contextFiles],
    }
    store.threads.push(active)
  }
  store.activeThreadId = active.id
  state.activeThreadId = active.id

  active.messages = state.messages
    .filter((m) => !m.streaming)
    .map(toHistoryRecord)
  active.toolGroups = normalizeAiToolGroups([...normalizeAiToolGroups(active.toolGroups), ...normalizeAiToolGroups(state.toolGroups), ...aiToolGroupsFromHistory(state.messages)])
  if (state.compactionCount) active.compactionCount = Math.max(state.compactionCount, normalizeAiCompactionCount(active.compactionCount))
  if (invalidateContextCheckpoint) delete active.contextCheckpoint
  const localSummary = state.threads.find((t) => t.id === active!.id)
  active.title = active.customTitle || (active.messages.length
    ? resolveThreadTitle(active.messages, { title: active.title || localSummary?.title })
    : '')
  active.updatedAt = Date.now()
  pruneEmptyThreadsLocal(store)
  return store
}

/** Everything main needs to replace one conversation, without the rest of the store. */
export function conversationPayload(
  state: AiSessionState,
  invalidateContextCheckpoint = false,
  selectThreadId?: string,
): AiSaveConversationPayload {
  return {
    messages: state.messages.filter((m) => !m.streaming).map(toHistoryRecord),
    ...(invalidateContextCheckpoint ? { invalidateContextCheckpoint: true } : {}),
    ...(state.toolGroups?.length ? { toolGroups: [...state.toolGroups] } : {}),
    ...(state.compactionCount ? { compactionCount: state.compactionCount } : {}),
    ...(state.contextFiles.length ? { contextFiles: state.contextFiles.map((file) => ({ ...file })) } : {}),
    ...(selectThreadId ? { selectThreadId } : {}),
  }
}

export async function persistActiveThread(
  sessionId: string,
  invalidateContextCheckpoint = false,
): Promise<boolean> {
  const state = getAiSessionState(sessionId)
  state.persisting = true
  try {
    if (!state.activeThreadId) state.activeThreadId = createThreadId()
    const result = await window.LiteConnect.aiSaveConversation(
      sessionId,
      state.activeThreadId,
      cloneForIpc(conversationPayload(state, invalidateContextCheckpoint)),
    )
    applyConversationSummary(state, result)
    if (invalidateContextCheckpoint) state.contextCheckpoint = undefined
    return true
  } catch (err) {
    console.warn('Failed to persist AI session store:', err)
    return false
  } finally {
    state.persisting = false
  }
}

export async function persistMessage(sessionId: string, message: ChatItem, threadId?: string) {
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
      current.title = current.customTitle || threadTitleFromMessages(state.messages) || current.title
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

export async function loadHistory(sessionId: string): Promise<ChatItem[]> {
  const pending = historyLoads.get(sessionId)
  if (pending) return pending
  const state = getAiSessionState(sessionId)
  const load = (async () => {
    try {
      // Host history is shared, but every new runtime SSH window starts its own
      // draft. Reloads of an existing window keep its locally selected thread.
      const store = state.loaded
        ? await buildStoreFromState(sessionId)
        : await window.LiteConnect.aiCreateConversation(sessionId, {})
      syncThreadSummaries(state, store)
      const active = store.threads.find((t) => t.id === store.activeThreadId) || store.threads[0]
      state.activeThreadId = active?.id || ''
      const messages = (active?.messages || []).map(fromHistoryRecord)
      state.contextCheckpoint = active?.contextCheckpoint
      state.compactionCount = normalizeAiCompactionCount(active?.compactionCount) || normalizeAiCompactionCount(active?.contextCheckpoint?.compactionCount)
      state.contextFiles = active?.contextFiles || []
      state.toolGroups = active?.toolGroups || []
      state.loaded = true
      return messages
    } catch (err: any) {
      ElMessage.warning(err?.message || t('ai.loadHistoryFailed'))
      return []
    }
  })()
  historyLoads.set(sessionId, load)
  try { return await load } finally { if (historyLoads.get(sessionId) === load) historyLoads.delete(sessionId) }
}
