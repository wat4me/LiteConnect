import { normalizeAiImages } from '../../../shared/aiImages'
import { normalizeAiCompactionCount } from '../../../shared/aiCompaction'
import { aiToolGroupsFromHistory, normalizeAiToolGroups } from '../../../shared/aiToolCatalog'
import { externalizeAiImages, hydrateAiImages, pruneAiImageFiles } from './imageStore'
import { t } from '../../i18n/index'
import type {
  AiContextCheckpoint, AiConversationSummary, AiConversationThread, AiHistoryRecord,
  AiSaveConversationPayload, AiSaveConversationResult, AiSessionStore,
} from '../../../shared/types/ai'
import { getAppDatabase, sessionIdFromAiKey } from '../../store/appDatabase'
import type { AiHistoryLimits, AiHistoryPrunePreview } from '../../../shared/aiHistoryLimits'
import {
  applyAiHistoryIndexLimits, deleteAiHistoryStorage, deleteAiHistoryThread, indexEntry, indexThread,
  readAiHistoryIndex, readAiHistoryStore, readAiHistoryThread, replaceAiHistoryThreadMessages,
  writeAiHistoryIndex, writeAiHistoryMessage, writeAiHistoryStore,
  type AiHistoryIndex,
} from './historyRepository'
import {
  AI_HISTORY_TITLE_MAX, createEmptyThread, getActiveThread,
  normalizeAiContextFiles, normalizeAiHistoryRecord, normalizeContextCheckpoint,
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

export function deleteAiHistory(historyId: string): void {
  deleteAiHistoryStorage(getAppDatabase(), historyId)
}

function readAiSessionStoreFromDatabase(sessionId: string, limits?: Partial<AiHistoryLimits>) {
  return readAiHistoryStore(getAppDatabase(), sessionId, limits)
}

export async function readAiSessionStore(
  sessionId: string,
  limits?: Partial<AiHistoryLimits>,
): Promise<AiSessionStore> {
  const { store } = readAiSessionStoreFromDatabase(sessionId, limits)
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

/** Records written with their attachment bytes externalized; message rows stay compact. */
async function externalizeRecords(historyId: string, records: AiHistoryRecord[]): Promise<AiHistoryRecord[]> {
  if (!records.some((record) => record.images?.length)) return records
  const scope: AiSessionStore = {
    version: 1, activeThreadId: 'attachment-scope', defaultContextFiles: [],
    threads: [{ id: 'attachment-scope', title: '', createdAt: 0, updatedAt: 0, contextFiles: [], messages: records }],
  }
  return (await externalizeAiImages(historyId, scope)).threads[0].messages
}

async function writeAiSessionStoreUnlocked(
  sessionId: string,
  store: AiSessionStore,
  limits?: Partial<AiHistoryLimits>,
): Promise<AiSessionStore> {
  const database = getAppDatabase()
  const normalized = normalizeSessionStore(store, limits)
  const snapshot = await externalizeAiImages(sessionId, normalized)
  // A timed-out shutdown may seal storage while attachment I/O is still pending.
  if (database.isOpen === false) return snapshot
  writeAiHistoryStore(database, sessionId, snapshot)
  try { await pruneAiImageFiles(sessionId, snapshot) } catch (error) { console.warn('Failed to prune AI image attachments:', error) }
  return snapshot
}

export async function readAiSessionStoreAndGc(
  sessionId: string,
  limits?: Partial<AiHistoryLimits>,
): Promise<AiSessionStore> {
  return runAiStoreTask(sessionId, async () => {
    const { store, rawThreadCount, rawMessageCount, created } = readAiSessionStoreFromDatabase(sessionId, limits)
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
  // The store already crossed IPC as plain data; normalization inside the task
  // builds the stored copy, so no second deep clone of the whole history is needed.
  await runAiStoreTask(sessionId, () => writeAiSessionStoreUnlocked(sessionId, store, limits))
}

export async function mutateAiSessionStore(
  sessionId: string,
  mutator: (store: AiSessionStore) => void | Promise<void>,
  limits?: Partial<AiHistoryLimits>,
): Promise<AiSessionStore> {
  return runAiStoreTask(sessionId, async () => {
    const { store } = readAiSessionStoreFromDatabase(sessionId, limits)
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

/**
 * Upsert one message: only its row plus the host index are rewritten, so streaming
 * checkpoints never parse or serialize the other conversations of the host.
 */
export async function upsertAiHistoryRecord(sessionId: string, record: any, threadId?: string, limits?: Partial<AiHistoryLimits>): Promise<void> {
  const next = normalizeAiHistoryRecord(record)
  await runAiStoreTask(sessionId, async () => {
    const database = getAppDatabase()
    const stored = (await externalizeRecords(sessionId, [next]))[0]
    if (database.isOpen === false) return
    database.transaction(() => {
      const { index } = readAiHistoryIndex(database, sessionId)
      const now = Date.now()
      let current = index
      if (!current) {
        const fresh = createEmptyThread(now)
        current = { version: 1, storageVersion: 2, activeThreadId: fresh.id, defaultContextFiles: [], threads: [indexThread(fresh)] }
      }
      let thread = threadId
        ? current.threads.find((item) => item.id === threadId)
        : current.threads.find((item) => item.id === current!.activeThreadId) || current.threads[0]
      if (!thread && threadId) {
        const hasAnyMessages = current.threads.some((item) => item.messages.length > 0)
        if (hasAnyMessages) throw new Error('AI conversation no longer exists')
        for (const other of current.threads) deleteAiHistoryThread(database, sessionId, other.id)
        const at = next.createdAt || now
        thread = { ...indexThread(createEmptyThread(at)), id: threadId, createdAt: at, updatedAt: at }
        current.threads = [thread]
        current.activeThreadId = threadId
      }
      if (!thread) throw new Error('AI conversation no longer exists')
      const position = thread.messages.findIndex((entry) => entry.id === next.id)
      if (position >= 0) {
        const checkpointPosition = thread.contextCheckpoint
          ? thread.messages.findIndex((entry) => entry.id === thread!.contextCheckpoint!.throughMessageId)
          : -1
        if (checkpointPosition >= 0 && position <= checkpointPosition) delete thread.contextCheckpoint
        thread.messages[position] = indexEntry(next)
      } else {
        thread.messages.push(indexEntry(next))
      }
      thread.messages.sort((a, b) => a.createdAt - b.createdAt)
      if (!thread.customTitle) {
        const firstUser = thread.messages.find((entry) => entry.role === 'user')
        if (firstUser?.id === next.id) thread.title = titleFromMessages([next]) || thread.title
      }
      const toolGroups = normalizeAiToolGroups([...normalizeAiToolGroups(thread.toolGroups), ...aiToolGroupsFromHistory([next])])
      if (toolGroups.length) thread.toolGroups = toolGroups
      thread.updatedAt = now
      writeAiHistoryMessage(database, sessionId, thread.id, stored)
      applyAiHistoryIndexLimits(database, sessionId, current, limits)
      writeAiHistoryIndex(database, sessionId, current)
    })
  })
}

/** Checkpoints live in the index; no message row is read or written. */
export async function writeAiContextCheckpoint(
  sessionId: string,
  threadId: string,
  checkpoint: AiContextCheckpoint,
  _limits?: Partial<AiHistoryLimits>,
): Promise<void> {
  await runAiStoreTask(sessionId, async () => {
    const database = getAppDatabase()
    if (database.isOpen === false) return
    database.transaction(() => {
      const { index } = readAiHistoryIndex(database, sessionId)
      const thread = index?.threads.find((item) => item.id === threadId)
      if (!index || !thread) throw new Error('AI conversation no longer exists')
      const normalized = normalizeContextCheckpoint(checkpoint, thread.messages)
      if (!normalized) throw new Error('Invalid or stale AI context checkpoint')
      const previousCount = normalizeAiCompactionCount(thread.compactionCount)
      const unchanged = thread.contextCheckpoint?.throughMessageId === normalized.throughMessageId && thread.contextCheckpoint?.summary === normalized.summary
      normalized.compactionCount = Math.max(normalizeAiCompactionCount(normalized.compactionCount), previousCount + (unchanged ? 0 : 1))
      thread.compactionCount = normalized.compactionCount
      thread.contextCheckpoint = normalized
      thread.updatedAt = Date.now()
      writeAiHistoryIndex(database, sessionId, index)
    })
  })
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
    store.threads.push(fresh)
    store.activeThreadId = fresh.id
    pruneEmptyThreads(store)
  }, limits)
}

export function summarizeAiSessionStore(store: AiSessionStore): AiConversationSummary {
  return {
    activeThreadId: store.activeThreadId,
    defaultContextFiles: store.defaultContextFiles,
    threads: store.threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      ...(thread.customTitle ? { customTitle: thread.customTitle } : {}),
      ...(thread.pinned ? { pinned: true } : {}),
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messageCount: thread.messages.length,
      active: thread.id === store.activeThreadId,
    })),
  }
}

function summarizeIndex(index: AiHistoryIndex): AiConversationSummary {
  return {
    activeThreadId: index.activeThreadId,
    defaultContextFiles: index.defaultContextFiles,
    threads: index.threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      ...(thread.customTitle ? { customTitle: thread.customTitle } : {}),
      ...(thread.pinned ? { pinned: true } : {}),
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messageCount: thread.messages.length,
      active: thread.id === index.activeThreadId,
    })),
  }
}

/**
 * Replace one conversation's messages instead of rewriting the whole host history.
 * The saved conversation becomes active unless `selectThreadId` names another one;
 * when that one no longer exists nothing is written.
 */
export async function saveAiConversation(
  historyId: string,
  threadId: string,
  payload: AiSaveConversationPayload,
  limits?: Partial<AiHistoryLimits>,
): Promise<AiSaveConversationResult> {
  if (typeof threadId !== 'string' || !threadId) throw new Error('Invalid AI thread id')
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.messages)) throw new Error('Invalid AI conversation payload')
  const selectId = payload.selectThreadId
  if (selectId !== undefined && (typeof selectId !== 'string' || !selectId)) throw new Error('Invalid AI thread id')
  return runAiStoreTask(historyId, async () => {
    const database = getAppDatabase()
    const records = payload.messages
      .map((item) => { try { return normalizeAiHistoryRecord(item) } catch { return null } })
      .filter((item): item is AiHistoryRecord => Boolean(item))
      .sort((a, b) => a.createdAt - b.createdAt)
    const { index } = readAiHistoryIndex(database, historyId)
    if (selectId !== undefined && index && !index.threads.some((thread) => thread.id === selectId)) {
      return summarizeIndex(index)
    }
    const stored = await externalizeRecords(historyId, records)
    if (database.isOpen === false) {
      return summarizeIndex(index ?? { version: 1, storageVersion: 2, activeThreadId: threadId, defaultContextFiles: [], threads: [] })
    }
    let pruneImages = false
    const current = database.transaction(() => {
      let next = index
      if (!next) {
        const fresh = createEmptyThread()
        next = { version: 1, storageVersion: 2, activeThreadId: fresh.id, defaultContextFiles: [], threads: [indexThread(fresh)] }
      }
      const priorThreadIds = next.threads.map((thread) => thread.id)
      let thread = next.threads.find((item) => item.id === threadId)
      if (!thread) {
        const at = records[0]?.createdAt || Date.now()
        thread = { ...indexThread(createEmptyThread(at)), id: threadId, createdAt: at, updatedAt: at, contextFiles: normalizeAiContextFiles(payload.contextFiles) }
        next.threads.push(thread)
      }
      const previous = thread.messages
      pruneImages = previous.some((entry) => entry.role === 'user') && previous.some((entry) => !records.some((record) => record.id === entry.id))
      replaceAiHistoryThreadMessages(database, historyId, thread.id, stored)
      thread.messages = records.map(indexEntry)
      const toolGroups = normalizeAiToolGroups([
        ...normalizeAiToolGroups(thread.toolGroups), ...normalizeAiToolGroups(payload.toolGroups), ...aiToolGroupsFromHistory(records),
      ])
      if (toolGroups.length) thread.toolGroups = toolGroups
      else delete thread.toolGroups
      const compactionCount = Math.max(normalizeAiCompactionCount(payload.compactionCount), normalizeAiCompactionCount(thread.compactionCount))
      if (compactionCount) thread.compactionCount = compactionCount
      if (payload.invalidateContextCheckpoint) delete thread.contextCheckpoint
      thread.title = thread.customTitle || titleFromMessages(records) || thread.title
      thread.updatedAt = Date.now()
      next.activeThreadId = selectId ?? threadId
      pruneEmptyThreads(next, () => indexThread(createEmptyThread()))
      const kept = new Set(next.threads.map((item) => item.id))
      kept.add(threadId)
      for (const gone of priorThreadIds) if (!kept.has(gone)) deleteAiHistoryThread(database, historyId, gone)
      applyAiHistoryIndexLimits(database, historyId, next, limits)
      writeAiHistoryIndex(database, historyId, next)
      return next
    })
    if (pruneImages) {
      const { store } = readAiHistoryStore(database, historyId, limits)
      try { await pruneAiImageFiles(historyId, store) } catch (error) { console.warn('Failed to prune AI image attachments:', error) }
    }
    const result: AiSaveConversationResult = summarizeIndex(current)
    if (selectId !== undefined) {
      const thread = readAiHistoryThread(database, historyId, current, selectId, limits)
      if (thread) {
        const scope: AiSessionStore = { version: 1, activeThreadId: selectId, defaultContextFiles: current.defaultContextFiles, threads: [thread] }
        result.thread = (await hydrateAiImages(historyId, scope, selectId)).threads[0]
      }
    }
    return result
  })
}

/** Read the same decoded snapshot used by pruning without writing or collecting images. */
export async function previewAiHistoryPrune(limits: Partial<AiHistoryLimits>): Promise<AiHistoryPrunePreview> {
  const result: AiHistoryPrunePreview = { conversations: 0, messages: 0 }
  for (const key of getAppDatabase().listSingletonKeys('ai-session:')) {
    const sessionId = sessionIdFromAiKey(key)
    const counts = await runAiStoreTask(sessionId, async () => {
      const { store, rawThreadCount, rawMessageCount } = readAiSessionStoreFromDatabase(sessionId, limits)
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
        const { store } = readAiSessionStoreFromDatabase(sessionId, limits)
        await writeAiSessionStoreUnlocked(sessionId, store, limits)
      })
    } catch (error) {
      console.warn(`Failed to prune AI history for ${sessionId}:`, error)
    }
  }
}
