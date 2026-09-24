import { AI_TOOL_DIFF_MAX_CHARS } from '../../shared/aiToolDiff'
import { isAiMarkdownFilePath } from '../../shared/aiFixedContext'
import { t } from '../i18n'
import { limitAiMessagesPreservingToolProtocol } from '../../shared/aiMessages'
import { MAX_AI_TOOL_CALLS_PER_TURN, MAX_AI_TURN_SEGMENTS } from '../../shared/aiToolLimits'
import type {
  AiChatMessage,
  AiChatSegment,
  AiConversationContextFile,
  AiConversationThread,
  AiContextCheckpoint,
  AiHistoryRecord,
  AiSessionStore,
  AiToolRun,
} from '../../shared/types/ai'
import { extractAiUsage } from './providerHttp'
import {
  aiSessionKey,
  getAppDatabase,
  sessionIdFromAiKey,
} from '../store/appDatabase'
import {
  normalizeAiHistoryLimits,
  type AiHistoryLimits,
} from '../../shared/aiHistoryLimits'

export type { AiConversationThread, AiHistoryRecord, AiSessionStore }

export function createThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Titles keep as much of the first user message as is worth storing. */
const TITLE_MAX = 200

export function titleFromMessages(messages: AiHistoryRecord[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim())
  if (!firstUser) return ''
  return firstUser.content.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)
}

export function createEmptyThread(now = Date.now()): AiConversationThread {
  return {
    id: createThreadId(),
    title: '',
    createdAt: now,
    updatedAt: now,
    messages: [],
    contextFiles: [],
  }
}

export function createEmptyStore(): AiSessionStore {
  const thread = createEmptyThread()
  return {
    version: 1,
    activeThreadId: thread.id,
    threads: [thread],
    defaultContextFiles: [],
  }
}

/**
 * Drop empty conversation shells that are not the active draft. The host-level
 * default retains reference files independently of empty drafts.
 */
export function pruneEmptyThreads(store: AiSessionStore): void {
  if (!Array.isArray(store.threads) || store.threads.length === 0) {
    const fresh = createEmptyThread()
    store.threads = [fresh]
    store.activeThreadId = fresh.id
    return
  }

  const activeId = store.activeThreadId
  store.threads = store.threads.filter(
    (t) => (Array.isArray(t.messages) && t.messages.length > 0) || t.id === activeId,
  )

  const emptyIds = store.threads.filter((t) => !t.messages?.length).map((t) => t.id)
  if (emptyIds.length > 1) {
    store.threads = store.threads.filter(
      (t) => t.messages?.length > 0 || t.id === activeId,
    )
  }

  if (store.threads.length === 0) {
    const fresh = createEmptyThread()
    store.threads = [fresh]
    store.activeThreadId = fresh.id
    return
  }

  if (!store.threads.some((t) => t.id === store.activeThreadId)) {
    const preferred =
      store.threads.find((t) => t.messages.length > 0) || store.threads[0]
    store.activeThreadId = preferred.id
  }
}

function normalizeSegments(raw: unknown): AiChatSegment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: AiChatSegment[] = []
  for (const item of raw.slice(0, MAX_AI_TURN_SEGMENTS)) {
    if (!item || typeof item !== 'object') continue
    const seg = item as Record<string, unknown>
    if (seg.kind === 'reasoning' || seg.kind === 'content') {
      if (typeof seg.text === 'string' && seg.text) {
        out.push({ kind: seg.kind, text: seg.text.slice(0, 200000) })
      }
    } else if (seg.kind === 'tool' && typeof seg.runId === 'string' && seg.runId) {
      out.push({ kind: 'tool', runId: seg.runId.slice(0, 128) })
    }
  }
  return out.length ? out : undefined
}

function normalizeToolRuns(raw: unknown): AiToolRun[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: AiToolRun[] = []
  for (const item of raw.slice(0, MAX_AI_TOOL_CALLS_PER_TURN)) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const name = typeof rec.name === 'string' ? rec.name.slice(0, 64) : ''
    if (!name) continue
    const status =
      rec.status === 'ask' ||
      rec.status === 'running' ||
      rec.status === 'done' ||
      rec.status === 'denied' ||
      rec.status === 'blocked' ||
      rec.status === 'reclassify' ||
      rec.status === 'aborted'
        ? rec.status
        : undefined
    const risk =
      rec.risk === 'read' ||
      rec.risk === 'write' ||
      rec.risk === 'destructive' ||
      rec.risk === 'privileged' ||
      rec.risk === 'forbidden'
        ? rec.risk
        : undefined
    out.push({
      id: typeof rec.id === 'string' && rec.id ? rec.id : `${Date.now()}-${out.length}`,
      name,
      args: typeof rec.args === 'string' ? rec.args.slice(0, 4000) : '',
      content: typeof rec.content === 'string' ? rec.content.slice(0, 20000) : '',
      isError: rec.isError === true,
      status,
      risk,
      reason: typeof rec.reason === 'string' ? rec.reason.slice(0, 500) : undefined,
      diffSummary: typeof rec.diffSummary === 'string' ? rec.diffSummary.slice(0, 500) : undefined,
      diffPreview: typeof rec.diffPreview === 'string' ? rec.diffPreview.slice(0, AI_TOOL_DIFF_MAX_CHARS) : undefined,
    })
  }
  return out.length ? out : undefined
}

function normalizeApiMessages(raw: unknown): AiChatMessage[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out = limitAiMessagesPreservingToolProtocol(raw)
  return out.length ? out : undefined
}

export const AI_CONTEXT_FILE_MAX_BYTES = 32 * 1024
export const AI_CONTEXT_FILES_MAX = 5

export function normalizeAiContextFile(value: unknown): AiConversationContextFile | undefined {
  if (!value || typeof value !== 'object') return undefined
  const file = value as Record<string, unknown>
  if (file.source !== 'local' && file.source !== 'ssh') return undefined
  if (typeof file.path !== 'string' || !file.path.trim() || file.path.length > 1024 || /[\0\r\n]/.test(file.path) || !isAiMarkdownFilePath(file.path)) return undefined
  if (typeof file.content !== 'string' || !file.content.trim() || file.content.includes('\0')) return undefined
  if (Buffer.byteLength(file.content, 'utf8') > AI_CONTEXT_FILE_MAX_BYTES) return undefined
  return { source: file.source, path: file.path.trim(), content: file.content }
}

export function normalizeAiContextFiles(value: unknown): AiConversationContextFile[] {
  if (!Array.isArray(value)) return []
  const files: AiConversationContextFile[] = []
  for (const item of value) {
    const file = normalizeAiContextFile(item)
    if (!file || files.some(existing => existing.source === file.source && existing.path === file.path)) continue
    if (files.length === AI_CONTEXT_FILES_MAX) break
    files.push(file)
  }
  return files
}

export function normalizeAiHistoryRecord(record: any): AiHistoryRecord {
  if (!record || typeof record !== 'object') {
    throw new Error('Invalid AI history record')
  }
  if (record.role !== 'user' && record.role !== 'assistant') {
    throw new Error('Invalid AI history role')
  }
  if (typeof record.content !== 'string') {
    throw new Error('Invalid AI history content')
  }
  return {
    id: typeof record.id === 'string' && record.id ? record.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: record.role,
    content: record.content.slice(0, 200000),
    reasoningContent: typeof record.reasoningContent === 'string' ? record.reasoningContent.slice(0, 200000) : undefined,
    usage: extractAiUsage({
      prompt_tokens: record.usage?.promptTokens,
      completion_tokens: record.usage?.completionTokens,
      total_tokens: record.usage?.totalTokens,
      reasoning_tokens: record.usage?.reasoningTokens,
    }),
    error: record.error === true,
    status:
      record.status === 'running' ||
      record.status === 'completed' ||
      record.status === 'aborted' ||
      record.status === 'error'
        ? record.status
        : record.error === true
          ? 'error'
          : undefined,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    completedAt:
      typeof record.completedAt === 'number' && Number.isFinite(record.completedAt)
        ? record.completedAt
        : undefined,
    toolRuns: normalizeToolRuns(record.toolRuns),
    segments: normalizeSegments(record.segments),
    apiMessages: normalizeApiMessages(record.apiMessages),
  }
}

function limitThreadMessages(messages: AiHistoryRecord[], maxMessages: number): AiHistoryRecord[] {
  if (messages.length <= maxMessages) return messages
  const retained = messages.slice(-maxMessages)
  const firstUser = retained.findIndex((message) => message.role === 'user')
  return firstUser > 0 ? retained.slice(firstUser) : retained
}

function normalizeContextCheckpoint(
  raw: unknown,
  messages: readonly AiHistoryRecord[],
): AiContextCheckpoint | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const item = raw as Record<string, unknown>
  if (item.version !== 1 || typeof item.summary !== 'string' || !item.summary.trim() ||
    typeof item.throughMessageId !== 'string' || !item.throughMessageId ||
    !messages.some(message => message.id === item.throughMessageId)) return undefined
  const sourceTokens = Number(item.sourceTokens)
  const summaryTokens = Number(item.summaryTokens)
  if (!Number.isFinite(sourceTokens) || sourceTokens <= 0 ||
    !Number.isFinite(summaryTokens) || summaryTokens <= 0 || summaryTokens >= sourceTokens) return undefined
  return {
    version: 1,
    summary: item.summary.slice(0, 100_000),
    throughMessageId: item.throughMessageId.slice(0, 256),
    createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)
      ? item.createdAt
      : Date.now(),
    sourceTokens: Math.floor(sourceTokens),
    summaryTokens: Math.floor(summaryTokens),
    model: typeof item.model === 'string' && item.model.trim()
      ? item.model.trim().slice(0, 256)
      : undefined,
  }
}

function normalizeThread(raw: any, limits: AiHistoryLimits): AiConversationThread | null {
  if (!raw || typeof raw !== 'object') return null
  const allMessages = Array.isArray(raw.messages)
    ? raw.messages
        .map((item: any) => {
          try {
            return normalizeAiHistoryRecord(item)
          } catch {
            return null
          }
        })
        .filter((item: AiHistoryRecord | null): item is AiHistoryRecord => Boolean(item))
        .sort((a: AiHistoryRecord, b: AiHistoryRecord) => a.createdAt - b.createdAt)
    : []
  const messages = limitThreadMessages(allMessages, limits.maxMessages)
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : messages[0]?.createdAt || Date.now()
  const updatedAt =
    typeof raw.updatedAt === 'number'
      ? raw.updatedAt
      : messages[messages.length - 1]?.createdAt || createdAt
  const customTitle = typeof raw.customTitle === 'string'
    ? raw.customTitle.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)
    : ''
  const title = customTitle || titleFromMessages(messages) ||
    (typeof raw.title === 'string' ? raw.title.trim().slice(0, TITLE_MAX) : '')
  const contextCheckpoint = normalizeContextCheckpoint(raw.contextCheckpoint, messages)
  const contextFiles = normalizeAiContextFiles(raw.contextFiles)
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createThreadId(),
    title,
    ...(customTitle ? { customTitle } : {}),
    ...(raw.pinned === true ? { pinned: true } : {}),
    createdAt,
    updatedAt,
    messages,
    ...(contextCheckpoint ? { contextCheckpoint } : {}),
    contextFiles,
  }
}

export function applyAiHistoryLimits(
  store: AiSessionStore,
  rawLimits?: Partial<AiHistoryLimits>,
): void {
  const limits = normalizeAiHistoryLimits(rawLimits)
  for (const thread of store.threads) {
    thread.messages = limitThreadMessages(thread.messages, limits.maxMessages)
    if (thread.contextCheckpoint &&
      !thread.messages.some(message => message.id === thread.contextCheckpoint?.throughMessageId)) {
      delete thread.contextCheckpoint
    }
  }
  if (store.threads.length <= limits.maxThreads) return

  const active = store.threads.find((thread) => thread.id === store.activeThreadId)
  const activeCountsTowardLimit = Boolean(active?.messages.length)
  const protectedThreads = store.threads.filter(thread => thread.pinned && thread.id !== active?.id)
  const kept = [...store.threads]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((thread) => thread.id !== active?.id && !thread.pinned)
    .slice(0, Math.max(0, limits.maxThreads - protectedThreads.length - (activeCountsTowardLimit ? 1 : 0)))
  const keptIds = new Set([...(active ? [active.id] : []), ...protectedThreads.map(thread => thread.id), ...kept.map((thread) => thread.id)])
  store.threads = store.threads.filter((thread) => keptIds.has(thread.id))
}

export function recoverInterruptedAiSessionStore(store: AiSessionStore): boolean {
  let changed = false
  for (const thread of store.threads) {
    for (const message of thread.messages) {
      if (message.role !== 'assistant') continue
      if (message.status === 'running') {
        message.status = 'aborted'
        changed = true
      }
      for (const run of message.toolRuns || []) {
        if (run.status === 'ask' || run.status === 'running') {
          run.status = 'aborted'
          changed = true
        }
      }
    }
  }
  return changed
}

export function normalizeSessionStore(
  raw: any,
  rawLimits?: Partial<AiHistoryLimits>,
): AiSessionStore {
  const limits = normalizeAiHistoryLimits(rawLimits)
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !Array.isArray(raw.threads)) {
    return createEmptyStore()
  }
  const threads = raw.threads
    .map((thread: any) => normalizeThread(thread, limits))
    .filter((thread: AiConversationThread | null): thread is AiConversationThread => Boolean(thread))
  if (threads.length === 0) {
    const store = createEmptyStore()
    const files = normalizeAiContextFiles(raw.defaultContextFiles)
    store.defaultContextFiles = files
    store.threads[0].contextFiles = [...files]
    return store
  }
  const activeThreadId =
    typeof raw.activeThreadId === 'string' && threads.some((t: AiConversationThread) => t.id === raw.activeThreadId)
      ? raw.activeThreadId
      : threads[0].id
  const defaultContextFiles = normalizeAiContextFiles(raw.defaultContextFiles)
  const store: AiSessionStore = {
    version: 1,
    activeThreadId,
    threads,
    defaultContextFiles,
  }
  pruneEmptyThreads(store)
  applyAiHistoryLimits(store, limits)
  return store
}

/** Parse JSONL; tolerate multi-line / broken records by brace-scanning objects. */
function parseJsonlObjects(text: string): any[] {
  const records: any[] = []
  let i = 0
  const s = text
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++
    if (i >= s.length) break
    if (s[i] !== '{') {
      const n = s.indexOf('\n{', i)
      if (n < 0) break
      i = n + 1
      continue
    }
    let depth = 0
    let inStr = false
    let esc = false
    const start = i
    for (; i < s.length; i++) {
      const c = s[i]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') {
        inStr = true
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          i++
          try {
            records.push(JSON.parse(s.slice(start, i)))
          } catch {
            /* skip bad object */
          }
          break
        }
      }
    }
    if (depth !== 0) break
  }
  return records
}

function parseLegacyMessageRecords(data: string): AiHistoryRecord[] {
  const lineRecords = data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return normalizeAiHistoryRecord(JSON.parse(line))
      } catch {
        return null
      }
    })
    .filter((record): record is AiHistoryRecord => Boolean(record))

  if (lineRecords.length > 0) {
    const byId = new Map<string, AiHistoryRecord>()
    for (const r of lineRecords) byId.set(r.id, r)
    return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt)
  }

  const robust = parseJsonlObjects(data)
    .map((obj) => {
      try {
        return normalizeAiHistoryRecord(obj)
      } catch {
        return null
      }
    })
    .filter((record): record is AiHistoryRecord => Boolean(record))
  const byId = new Map<string, AiHistoryRecord>()
  for (const r of robust) byId.set(r.id, r)
  return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt)
}

function storeFromLegacyMessages(messages: AiHistoryRecord[]): AiSessionStore {
  if (messages.length === 0) return createEmptyStore()
  const now = Date.now()
  const thread: AiConversationThread = {
    id: createThreadId(),
    title: titleFromMessages(messages),
    titleGenerated: false,
    createdAt: messages[0]?.createdAt || now,
    updatedAt: messages[messages.length - 1]?.createdAt || now,
    messages,
  }
  return {
    version: 1,
    activeThreadId: thread.id,
    threads: [thread],
  }
}

async function readAiSessionStoreFromDatabase(
  sessionId: string,
  limits?: Partial<AiHistoryLimits>,
): Promise<{
  store: AiSessionStore
  rawThreadCount: number | null
  rawMessageCount: number | null
  created?: boolean
}> {
  const stored = getAppDatabase().getSingleton<unknown>(aiSessionKey(sessionId))
  if (stored === undefined) {
    return { store: createEmptyStore(), rawThreadCount: null, rawMessageCount: null, created: true }
  }
  const data = typeof stored === 'string' ? stored : JSON.stringify(stored)
  const trimmed = data.trim()
  if (!trimmed) {
    return { store: createEmptyStore(), rawThreadCount: null, rawMessageCount: null, created: true }
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && parsed.version === 1 && Array.isArray(parsed.threads)) {
      return {
        store: normalizeSessionStore(parsed, limits),
        rawThreadCount: parsed.threads.length,
        rawMessageCount: parsed.threads.reduce(
          (sum: number, thread: any) => sum + (Array.isArray(thread?.messages) ? thread.messages.length : 0),
          0,
        ),
      }
    }
    if (parsed && typeof parsed === 'object' && (parsed.role === 'user' || parsed.role === 'assistant')) {
      return {
        store: normalizeSessionStore(storeFromLegacyMessages([normalizeAiHistoryRecord(parsed)]), limits),
        rawThreadCount: 1,
        rawMessageCount: 1,
      }
    }
  } catch {
    // fall through to JSONL migration
  }

  const legacy = storeFromLegacyMessages(parseLegacyMessageRecords(data))
  return {
    store: normalizeSessionStore(legacy, limits),
    rawThreadCount: legacy.threads.length,
    rawMessageCount: legacy.threads.reduce((sum, thread) => sum + thread.messages.length, 0),
  }
}

export async function readAiSessionStore(
  sessionId: string,
  limits?: Partial<AiHistoryLimits>,
): Promise<AiSessionStore> {
  const { store } = await readAiSessionStoreFromDatabase(sessionId, limits)
  return store
}

const aiStoreWriteChains = new Map<string, Promise<unknown>>()

function runAiStoreTask<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const prev = aiStoreWriteChains.get(sessionId) ?? Promise.resolve()
  const next = prev.then(task, task)
  aiStoreWriteChains.set(
    sessionId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

async function writeAiSessionStoreUnlocked(
  sessionId: string,
  store: AiSessionStore,
  limits?: Partial<AiHistoryLimits>,
): Promise<void> {
  const normalized = normalizeSessionStore(store, limits)
  getAppDatabase().setSingleton(aiSessionKey(sessionId), normalized)
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
    return store
  })
}

export async function writeAiSessionStore(
  sessionId: string,
  store: AiSessionStore,
  limits?: Partial<AiHistoryLimits>,
): Promise<void> {
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
    const store = await readAiSessionStore(sessionId, limits)
    await mutator(store)
    await writeAiSessionStoreUnlocked(sessionId, store, limits)
    return store
  })
}

export function getActiveThread(store: AiSessionStore): AiConversationThread {
  return store.threads.find((t) => t.id === store.activeThreadId) || store.threads[0]
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
      const title = (patch.customTitle || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)
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

    active.title = active.customTitle || titleFromMessages(active.messages) || (payload.title || '').trim().slice(0, TITLE_MAX)
    active.updatedAt = now

    const fresh = createEmptyThread(now)
    fresh.contextFiles = [...store.defaultContextFiles]
    store.threads.push(fresh)
    store.activeThreadId = fresh.id
    pruneEmptyThreads(store)
  }, limits)
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
