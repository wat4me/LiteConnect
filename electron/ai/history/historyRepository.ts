import { aiSessionKey, type AppDatabase } from '../../store/appDatabase'
import { MAX_AI_HISTORY_MAX_MESSAGES, MAX_AI_HISTORY_MAX_THREADS, type AiHistoryLimits } from '../../../shared/aiHistoryLimits'
import type { AiConversationContextFile, AiConversationThread, AiHistoryRecord, AiSessionStore } from '../../../shared/types/ai'
import { decodeAiSessionStore } from './historyCodec'
import { applyAiHistoryLimits, compactAiHistoryRecordForStorage, createEmptyStore, normalizeSessionStore } from './historyModel'

/**
 * Storage layout v2. The `ai-session:*` singleton is an index: thread metadata plus
 * the ordered `{ id, createdAt, role }` of each message. Message bodies live one row
 * each in a per-thread `documents` collection, so a checkpoint rewrites one row and
 * the index instead of the whole host history.
 */
export const AI_HISTORY_STORAGE_VERSION = 2
const MESSAGE_COLLECTION_PREFIX = 'ai-msg-v2:'

export type AiIndexMessage = { id: string; createdAt: number; role: 'user' | 'assistant' }
export type AiIndexThread = Omit<AiConversationThread, 'messages'> & { messages: AiIndexMessage[] }
export type AiHistoryIndex = {
  version: 1
  storageVersion: typeof AI_HISTORY_STORAGE_VERSION
  activeThreadId: string
  defaultContextFiles: AiConversationContextFile[]
  threads: AiIndexThread[]
}

export type HistoryDatabase = Pick<AppDatabase,
  'getSingleton' | 'setSingleton' | 'deleteSingleton' | 'hasSingleton' | 'transaction' |
  'getCollection' | 'setDocument' | 'deleteDocument' | 'replaceCollection' | 'listCollections' | 'deleteCollection'>

/** The pre-split blob is kept for recovery; its key is outside the `ai-session:` listing prefix. */
export const aiHistoryBackupKey = (historyId: string) => `ai-session-v1-backup:${historyId}`
export const aiHistoryCollectionPrefix = (historyId: string) => `${MESSAGE_COLLECTION_PREFIX}${historyId}:`
export const aiThreadCollection = (historyId: string, threadId: string) => `${aiHistoryCollectionPrefix(historyId)}${threadId}`

export const indexEntry = (record: Pick<AiHistoryRecord, 'id' | 'createdAt' | 'role'>): AiIndexMessage =>
  ({ id: record.id, createdAt: record.createdAt, role: record.role })

export function indexThread(thread: AiConversationThread): AiIndexThread {
  const { messages, ...meta } = thread
  return { ...meta, messages: messages.map(indexEntry) }
}

export function indexFromStore(store: AiSessionStore): AiHistoryIndex {
  return {
    version: 1,
    storageVersion: AI_HISTORY_STORAGE_VERSION,
    activeThreadId: store.activeThreadId,
    defaultContextFiles: store.defaultContextFiles,
    threads: store.threads.map(indexThread),
  }
}

export function isAiHistoryIndex(raw: unknown): raw is AiHistoryIndex {
  const value = raw as Partial<AiHistoryIndex> | null
  return Boolean(value && typeof value === 'object' && value.storageVersion === AI_HISTORY_STORAGE_VERSION &&
    Array.isArray(value.threads) && typeof value.activeThreadId === 'string')
}

/** The index for a history. A v1 blob or legacy JSONL is split into rows the first time it is read. */
export function readAiHistoryIndex(db: HistoryDatabase, historyId: string): { index?: AiHistoryIndex; migrated: boolean } {
  const raw = db.getSingleton<unknown>(aiSessionKey(historyId))
  if (raw === undefined) return { migrated: false }
  if (isAiHistoryIndex(raw)) return { index: raw, migrated: false }
  // Widest limits: migration never discards history; configured retention applies on the next read.
  const { store } = decodeAiSessionStore(raw, { maxThreads: MAX_AI_HISTORY_MAX_THREADS, maxMessages: MAX_AI_HISTORY_MAX_MESSAGES })
  const index = db.transaction(() => {
    const next = writeAiHistoryStore(db, historyId, store)
    if (!db.hasSingleton(aiHistoryBackupKey(historyId))) db.setSingleton(aiHistoryBackupKey(historyId), raw)
    return next
  })
  return { index, migrated: true }
}

/** A thread with its stored (compact) rows in index order; rows missing from storage are skipped. */
function materializeThread(db: HistoryDatabase, historyId: string, thread: AiIndexThread) {
  const rows = new Map<string, unknown>()
  for (const row of db.getCollection<{ id?: unknown }>(aiThreadCollection(historyId, thread.id))) {
    if (row && typeof row === 'object' && typeof row.id === 'string') rows.set(row.id, row)
  }
  const { messages, ...meta } = thread
  const entries = Array.isArray(messages) ? messages : []
  return { ...meta, messages: entries.map((entry) => rows.get(entry.id)).filter((row) => row !== undefined) }
}

export function readAiHistoryStore(
  db: HistoryDatabase,
  historyId: string,
  limits?: Partial<AiHistoryLimits>,
): { store: AiSessionStore; rawThreadCount: number | null; rawMessageCount: number | null; created?: boolean } {
  const { index } = readAiHistoryIndex(db, historyId)
  if (!index) return { store: createEmptyStore(), rawThreadCount: null, rawMessageCount: null, created: true }
  const raw = {
    version: 1,
    activeThreadId: index.activeThreadId,
    defaultContextFiles: index.defaultContextFiles,
    threads: index.threads.map((thread) => materializeThread(db, historyId, thread)),
  }
  return {
    store: normalizeSessionStore(raw, limits),
    rawThreadCount: index.threads.length,
    rawMessageCount: index.threads.reduce((sum, thread) => sum + thread.messages.length, 0),
  }
}

/** One conversation with its messages, normalized like a full read but without loading the others. */
export function readAiHistoryThread(
  db: HistoryDatabase,
  historyId: string,
  index: AiHistoryIndex,
  threadId: string,
  limits?: Partial<AiHistoryLimits>,
): AiConversationThread | undefined {
  const thread = index.threads.find((item) => item.id === threadId)
  if (!thread) return undefined
  const raw = { version: 1, activeThreadId: threadId, defaultContextFiles: index.defaultContextFiles, threads: [materializeThread(db, historyId, thread)] }
  return normalizeSessionStore(raw, limits).threads.find((item) => item.id === threadId)
}

/** Full replace. Unchanged rows are skipped by replaceCollection; collections of removed threads are dropped. */
export function writeAiHistoryStore(db: HistoryDatabase, historyId: string, store: AiSessionStore): AiHistoryIndex {
  const index = indexFromStore(store)
  db.transaction(() => {
    const keep = new Set(store.threads.map((thread) => aiThreadCollection(historyId, thread.id)))
    for (const collection of db.listCollections(aiHistoryCollectionPrefix(historyId))) {
      if (!keep.has(collection)) db.deleteCollection(collection)
    }
    for (const thread of store.threads) replaceAiHistoryThreadMessages(db, historyId, thread.id, thread.messages)
    db.setSingleton(aiSessionKey(historyId), index)
  })
  return index
}

export function writeAiHistoryIndex(db: HistoryDatabase, historyId: string, index: AiHistoryIndex): void {
  db.setSingleton(aiSessionKey(historyId), index)
}

export function writeAiHistoryMessage(db: HistoryDatabase, historyId: string, threadId: string, record: AiHistoryRecord): void {
  db.setDocument(aiThreadCollection(historyId, threadId), record.id, compactAiHistoryRecordForStorage(record), record.createdAt)
}

export function replaceAiHistoryThreadMessages(db: HistoryDatabase, historyId: string, threadId: string, records: AiHistoryRecord[]): void {
  db.replaceCollection(aiThreadCollection(historyId, threadId), records.map(compactAiHistoryRecordForStorage), (_row, position) => records[position].id)
}

export function deleteAiHistoryThread(db: HistoryDatabase, historyId: string, threadId: string): void {
  db.deleteCollection(aiThreadCollection(historyId, threadId))
}

/** Apply retention to the index and drop the rows it no longer references. */
export function applyAiHistoryIndexLimits(db: HistoryDatabase, historyId: string, index: AiHistoryIndex, limits?: Partial<AiHistoryLimits>): void {
  const before = new Map(index.threads.map((thread) => [thread.id, thread.messages.map((message) => message.id)]))
  applyAiHistoryLimits(index, limits)
  const kept = new Map(index.threads.map((thread) => [thread.id, new Set(thread.messages.map((message) => message.id))]))
  for (const [threadId, ids] of before) {
    const remaining = kept.get(threadId)
    if (!remaining) {
      deleteAiHistoryThread(db, historyId, threadId)
      continue
    }
    for (const id of ids) if (!remaining.has(id)) db.deleteDocument(aiThreadCollection(historyId, threadId), id)
  }
}

export function deleteAiHistoryStorage(db: HistoryDatabase, historyId: string): void {
  db.transaction(() => {
    for (const collection of db.listCollections(aiHistoryCollectionPrefix(historyId))) db.deleteCollection(collection)
    db.deleteSingleton(aiSessionKey(historyId))
    db.deleteSingleton(aiHistoryBackupKey(historyId))
  })
}
