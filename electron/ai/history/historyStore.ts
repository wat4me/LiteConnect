import { normalizeAiImages } from '../../../shared/aiImages'
import { normalizeAiCompactionCount } from '../../../shared/aiCompaction'
import { externalizeAiImages, hydrateAiImages, pruneAiImageFiles } from './imageStore'
import { t } from '../../i18n/index'
import type { AiContextCheckpoint, AiConversationThread, AiHistoryRecord, AiSessionStore } from '../../../shared/types/ai'
import { aiSessionKey, getAppDatabase, sessionIdFromAiKey } from '../../store/appDatabase'
import type { AiHistoryLimits, AiHistoryPrunePreview } from '../../../shared/aiHistoryLimits'
import { decodeAiSessionStore } from './historyCodec'
import {
  AI_CONTEXT_FILES_MAX, AI_HISTORY_TITLE_MAX, createEmptyThread, getActiveThread,
  normalizeAiContextFile, normalizeAiHistoryRecord, normalizeContextCheckpoint,
  normalizeSessionStore, pruneEmptyThreads, recoverInterruptedAiSessionStore, titleFromMessages,
} from './historyModel'

export type { AiConversationThread, AiHistoryRecord, AiSessionStore }
// Keep the history service contract while data rules remain independently testable.
export {
  AI_CONTEXT_FILE_MAX_BYTES, AI_CONTEXT_FILES_MAX, applyAiHistoryLimits,
  createThreadId, createEmptyThread, createEmptyStore, getActiveThread,
  normalizeAiContextFile, normalizeAiContextFiles, normalizeAiHistoryRecord,
  normalizeSessionStore, pruneEmptyThreads, recoverInterruptedAiSessionStore, titleFromMessages,
} from './historyModel'

function readAiSessionStoreFromDatabase(sessionId: string, limits?: Partial<AiHistoryLimits>) {
  return decodeAiSessionStore(getAppDatabase().getSingleton<unknown>(aiSessionKey(sessionId)), limits)
}

export async function readAiSessionStore(
  sessionId: string,
  limits?: Partial<AiHistoryLimits>,
): Promise<AiSessionStore> {
  const { store } = await readAiSessionStoreFromDatabase(sessionId, limits)
  return hydrateAiImages(sessionId, store)
}

const aiStoreWriteChains = new Map<string, Promise<unknown>>()

function runAiStoreTask<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const prev = aiStoreWriteChains.get(sessionId) ?? Promise.resolve()
  const next = prev.then(task, task)
  const settled = next.then(() => undefined, () => undefined)
  aiStoreWriteChains.set(sessionId, settled)
  void settled.then(() => {
    // A newer task may already own this session's chain.
    if (aiStoreWriteChains.get(sessionId) === settled) aiStoreWriteChains.delete(sessionId)
  })
  return next
}

async function writeAiSessionStoreUnlocked(
  sessionId: string,
  store: AiSessionStore,
  limits?: Partial<AiHistoryLimits>,
): Promise<void> {
  const database = getAppDatabase()
  const normalized = normalizeSessionStore(store, limits)
  const snapshot = await externalizeAiImages(sessionId, normalized)
  // A timed-out shutdown may seal storage while attachment I/O is still pending.
  if (database.isOpen === false) return
  database.setSingleton(aiSessionKey(sessionId), snapshot)
  try { await pruneAiImageFiles(sessionId, snapshot) } catch (error) { console.warn('Failed to prune AI image attachments:', error) }
}

export async function readAiSessionStoreAndGc(
  sessionId: string,
  limits?: Partial<AiHistoryLimits>,
): Promise<AiSessionStore> {
  return runAiStoreTask(sessionId, async () => {
    const { store, rawThreadCount, rawMessageCount, created } = await readAiSessionStoreFromDatabase(sessionId, limits)
    const recovered = recoverInterruptedAiSessionStore(store)
    const messageCount = store.threads.reduce((sum, thread) => sum + thread.messages.length, 0)
    if (created || recovered ||
      (rawThreadCount != null && store.threads.length < rawThreadCount) ||
      (rawMessageCount != null && messageCount < rawMessageCount)) {
      await writeAiSessionStoreUnlocked(sessionId, store, limits)
    }
    return hydrateAiImages(sessionId, store)
  })
}

export async function writeAiSessionStore(
  sessionId: string,
  store: AiSessionStore,
  limits?: Partial<AiHistoryLimits>,
): Promise<void> {
  for (const thread of store?.threads || []) {
    for (const message of thread.messages || []) if (message.images !== undefined) normalizeAiImages(message.images, t)
  }
  let snapshot: AiSessionStore
  try {
    snapshot = JSON.parse(JSON.stringify(store))
  } catch {
    snapshot = normalizeSessionStore(store, limits)
  }
  return runAiStoreTask(sessionId, () => writeAiSessionStoreUnlocked(sessionId, snapshot, limits))
}

export async function mutateAiSessionStore(
  sessionId: string,
  mutator: (store: AiSessionStore) => void | Promise<void>,
  limits?: Partial<AiHistoryLimits>,
): Promise<AiSessionStore> {
  return runAiStoreTask(sessionId, async () => {
    const { store } = await readAiSessionStoreFromDatabase(sessionId, limits)
    await mutator(store)
    await writeAiSessionStoreUnlocked(sessionId, store, limits)
    return hydrateAiImages(sessionId, store)
  })
}

export async function writeAiHistoryRecords(sessionId: string, records: AiHistoryRecord[], limits?: Partial<AiHistoryLimits>): Promise<void> {
  await mutateAiSessionStore(sessionId, (store) => {
    const active = getActiveThread(store)
    active.messages = records.map((r) => normalizeAiHistoryRecord(r)).sort((a, b) => a.createdAt - b.createdAt)
    delete active.contextCheckpoint
    active.title = active.customTitle || titleFromMessages(active.messages) || active.title
    active.updatedAt = Date.now()
  }, limits)
}

export async function upsertAiHistoryRecord(sessionId: string, record: any, threadId?: string, limits?: Partial<AiHistoryLimits>): Promise<void> {
  const next = normalizeAiHistoryRecord(record)
  await mutateAiSessionStore(sessionId, (store) => {
    let active = threadId ? store.threads.find((thread) => thread.id === threadId) : getActiveThread(store)
    if (!active && threadId) {
      const hasAnyMessages = store.threads.some((thread) => thread.messages.length > 0)
      if (hasAnyMessages) throw new Error('AI conversation no longer exists')
      const now = next.createdAt || Date.now()
      active = {
        id: threadId,
        title: '',
        createdAt: now,
        updatedAt: now,
        messages: [],
        contextFiles: [...store.defaultContextFiles],
      }
      store.threads = [active]
      store.activeThreadId = threadId
    }
    if (!active) throw new Error('AI conversation no longer exists')
    const idx = active.messages.findIndex((r) => r.id === next.id)
    if (idx >= 0) {
      const checkpointIndex = active.contextCheckpoint
        ? active.messages.findIndex(message => message.id === active!.contextCheckpoint?.throughMessageId)
        : -1
      if (checkpointIndex >= 0 && idx <= checkpointIndex) delete active.contextCheckpoint
      active.messages[idx] = next
    }
    else active.messages.push(next)
    active.messages.sort((a, b) => a.createdAt - b.createdAt)
    active.title = active.customTitle || titleFromMessages(active.messages) || active.title
    active.updatedAt = Date.now()
  }, limits)
}

export async function writeAiContextCheckpoint(
  sessionId: string,
  threadId: string,
  checkpoint: AiContextCheckpoint,
  limits?: Partial<AiHistoryLimits>,
): Promise<void> {
  await mutateAiSessionStore(sessionId, (store) => {
    const thread = store.threads.find(item => item.id === threadId)
    if (!thread) throw new Error('AI conversation no longer exists')
    const normalized = normalizeContextCheckpoint(checkpoint, thread.messages)
    if (!normalized) throw new Error('Invalid or stale AI context checkpoint')
    const previousCount = normalizeAiCompactionCount(thread.compactionCount)
    const unchanged = thread.contextCheckpoint?.throughMessageId === normalized.throughMessageId && thread.contextCheckpoint?.summary === normalized.summary
    normalized.compactionCount = Math.max(normalizeAiCompactionCount(normalized.compactionCount), previousCount + (unchanged ? 0 : 1))
    thread.compactionCount = normalized.compactionCount
    thread.contextCheckpoint = normalized
    thread.updatedAt = Date.now()
  }, limits)
}

export async function setAiConversationContextFile(
  historyId: string,
  threadId: string,
  value: unknown,
  limits?: Partial<AiHistoryLimits>,
): Promise<AiSessionStore> {
  const file = normalizeAiContextFile(value)
  if (!file) throw new Error('Invalid or oversized AI context file')
  return mutateAiSessionStore(historyId, (store) => {
    if (store.activeThreadId !== threadId) throw new Error('AI conversation changed')
    const active = getActiveThread(store)
    const files = [...active.contextFiles]
    const existing = files.findIndex(item => item.source === file.source && item.path === file.path)
    if (existing >= 0) files[existing] = file
    else {
      if (files.length >= AI_CONTEXT_FILES_MAX) throw new Error(t('ai.contextFileLimit', { count: AI_CONTEXT_FILES_MAX }))
      files.push(file)
    }
    active.contextFiles = files
    const defaults = [...store.defaultContextFiles]
    const defaultIndex = defaults.findIndex(item => item.source === file.source && item.path === file.path)
    if (defaultIndex >= 0) defaults[defaultIndex] = file
    else {
      if (defaults.length >= AI_CONTEXT_FILES_MAX) throw new Error(t('ai.contextFileLimit', { count: AI_CONTEXT_FILES_MAX }))
      defaults.push(file)
    }
    store.defaultContextFiles = defaults
    active.updatedAt = Date.now()
  }, limits)
}

export async function removeAiConversationContextFile(
  historyId: string,
  threadId: string,
  source: 'local' | 'ssh',
  path: string,
  removeFromFuture = true,
  limits?: Partial<AiHistoryLimits>,
): Promise<AiSessionStore> {
  return mutateAiSessionStore(historyId, (store) => {
    if (store.activeThreadId !== threadId) throw new Error('AI conversation changed')
    const active = getActiveThread(store)
    const files = active.contextFiles.filter(file => file.source !== source || file.path !== path)
    active.contextFiles = files
    if (removeFromFuture) {
      store.defaultContextFiles = store.defaultContextFiles.filter(file => file.source !== source || file.path !== path)
    }
    active.updatedAt = Date.now()
  }, limits)
}

export async function updateAiConversationMetadata(
  historyId: string,
  threadId: string,
  patch: { customTitle?: string | null; pinned?: boolean },
  limits?: Partial<AiHistoryLimits>,
): Promise<AiSessionStore> {
  const updated = await mutateAiSessionStore(historyId, (store) => {
    const thread = store.threads.find(item => item.id === threadId)
    if (!thread) throw new Error('AI conversation no longer exists')
    if (Object.prototype.hasOwnProperty.call(patch, 'customTitle')) {
      if (patch.customTitle !== null && typeof patch.customTitle !== 'string') throw new Error('Invalid AI conversation title')
      const title = (patch.customTitle || '').replace(/\s+/g, ' ').trim().slice(0, AI_HISTORY_TITLE_MAX)
      if (title) thread.customTitle = title
      else delete thread.customTitle
      thread.title = thread.customTitle || titleFromMessages(thread.messages)
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'pinned')) {
      if (typeof patch.pinned !== 'boolean') throw new Error('Invalid AI conversation pin state')
      if (patch.pinned) thread.pinned = true
      else delete thread.pinned
    }
  }, limits)
  return normalizeSessionStore(updated, limits)
}

export async function createNewConversationAtomic(
  sessionId: string,
  payload: {
    threadId?: string
    messages?: any[]
    title?: string
  },
  limits?: Partial<AiHistoryLimits>,
): Promise<AiSessionStore> {
  return mutateAiSessionStore(sessionId, (store) => {
    const now = Date.now()
    const activeId = typeof payload.threadId === 'string' && payload.threadId
      ? payload.threadId
      : store.activeThreadId
    let active = store.threads.find((t) => t.id === activeId) || store.threads[0]

    if (!active) {
      active = createEmptyThread(now)
      store.threads.push(active)
    }

    if (Array.isArray(payload.messages)) {
      active.messages = payload.messages
        .map((item) => {
          try {
            return normalizeAiHistoryRecord(item)
          } catch {
            return null
          }
        })
        .filter((item): item is AiHistoryRecord => Boolean(item))
        .sort((a, b) => a.createdAt - b.createdAt)
    }

    active.title = active.customTitle || titleFromMessages(active.messages) || (payload.title || '').trim().slice(0, AI_HISTORY_TITLE_MAX)
    active.updatedAt = now

    const fresh = createEmptyThread(now)
    fresh.contextFiles = [...store.defaultContextFiles]
    store.threads.push(fresh)
    store.activeThreadId = fresh.id
    pruneEmptyThreads(store)
  }, limits)
}

/** Read the same decoded snapshot used by pruning without writing or collecting images. */
export async function previewAiHistoryPrune(limits: Partial<AiHistoryLimits>): Promise<AiHistoryPrunePreview> {
  const result: AiHistoryPrunePreview = { conversations: 0, messages: 0 }
  for (const key of getAppDatabase().listSingletonKeys('ai-session:')) {
    const sessionId = sessionIdFromAiKey(key)
    const counts = await runAiStoreTask(sessionId, async () => {
      const { store, rawThreadCount, rawMessageCount } = await readAiSessionStoreFromDatabase(sessionId, limits)
      return {
        conversations: Math.max(0, (rawThreadCount ?? 0) - store.threads.length),
        messages: Math.max(0, (rawMessageCount ?? 0) - store.threads.reduce((sum, thread) => sum + thread.messages.length, 0)),
      }
    })
    result.conversations += counts.conversations
    result.messages += counts.messages
  }
  return result
}

export async function pruneAllAiHistoryStores(limits?: Partial<AiHistoryLimits>): Promise<void> {
  const keys = getAppDatabase().listSingletonKeys('ai-session:')
  for (const key of keys) {
    const sessionId = sessionIdFromAiKey(key)
    try {
      await runAiStoreTask(sessionId, async () => {
        const { store } = await readAiSessionStoreFromDatabase(sessionId, limits)
        await writeAiSessionStoreUnlocked(sessionId, store, limits)
      })
    } catch (error) {
      console.warn(`Failed to prune AI history for ${sessionId}:`, error)
    }
  }
}
