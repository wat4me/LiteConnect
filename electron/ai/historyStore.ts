import { app } from 'electron'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type {
  AiChatSegment,
  AiConversationThread,
  AiHistoryRecord,
  AiSessionStore,
  AiToolRun,
} from '../../shared/types/ai'
import { extractAiUsage } from './providerHttp'
import { abortTitleGeneration } from './titleAbort'

export type { AiConversationThread, AiHistoryRecord, AiSessionStore }

function getAiHistoryPath(sessionId: string): string {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Invalid AI session id')
  }
  const safeId = encodeURIComponent(sessionId).replace(/[()]/g, '')
  return join(app.getPath('userData'), 'ai-history', `${safeId}.jsonl`)
}

function getAiHistoryDir(): string {
  return join(app.getPath('userData'), 'ai-history')
}

export function createThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function titleFromMessages(messages: AiHistoryRecord[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim())
  if (!firstUser) return ''
  return firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 80)
}

export function createEmptyThread(now = Date.now()): AiConversationThread {
  return {
    id: createThreadId(),
    title: '',
    titleGenerated: false,
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}

export function createEmptyStore(): AiSessionStore {
  const thread = createEmptyThread()
  return {
    version: 1,
    activeThreadId: thread.id,
    threads: [thread],
  }
}

/**
 * Drop empty conversation shells that are not the active draft.
 * Keeps: every thread with messages + the current active thread (even if still empty).
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
  for (const item of raw.slice(0, 200)) {
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
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const name = typeof rec.name === 'string' ? rec.name.slice(0, 64) : ''
    if (!name) continue
    const status =
      rec.status === 'ask' ||
      rec.status === 'running' ||
      rec.status === 'done' ||
      rec.status === 'denied' ||
      rec.status === 'blocked'
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
    })
  }
  return out.length ? out : undefined
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
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    toolRuns: normalizeToolRuns(record.toolRuns),
    segments: normalizeSegments(record.segments),
  }
}

function normalizeThread(raw: any): AiConversationThread | null {
  if (!raw || typeof raw !== 'object') return null
  const messages = Array.isArray(raw.messages)
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
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : messages[0]?.createdAt || Date.now()
  const updatedAt =
    typeof raw.updatedAt === 'number'
      ? raw.updatedAt
      : messages[messages.length - 1]?.createdAt || createdAt
  const titleGenerated = raw.titleGenerated === true
  const title =
    typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim().slice(0, 80)
      : titleFromMessages(messages)
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createThreadId(),
    title,
    titleGenerated,
    createdAt,
    updatedAt,
    messages,
  }
}

export function normalizeSessionStore(raw: any): AiSessionStore {
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !Array.isArray(raw.threads)) {
    return createEmptyStore()
  }
  const threads = raw.threads
    .map((thread: any) => normalizeThread(thread))
    .filter((thread: AiConversationThread | null): thread is AiConversationThread => Boolean(thread))
  if (threads.length === 0) return createEmptyStore()
  const activeThreadId =
    typeof raw.activeThreadId === 'string' && threads.some((t: AiConversationThread) => t.id === raw.activeThreadId)
      ? raw.activeThreadId
      : threads[0].id
  const store: AiSessionStore = {
    version: 1,
    activeThreadId,
    threads,
  }
  pruneEmptyThreads(store)
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

async function readAiSessionStoreFromDisk(sessionId: string): Promise<{
  store: AiSessionStore
  rawThreadCount: number | null
}> {
  const historyPath = getAiHistoryPath(sessionId)
  if (!existsSync(historyPath)) {
    return { store: createEmptyStore(), rawThreadCount: null }
  }
  const data = await readFile(historyPath, 'utf-8')
  const trimmed = data.trim()
  if (!trimmed) {
    return { store: createEmptyStore(), rawThreadCount: null }
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && parsed.version === 1 && Array.isArray(parsed.threads)) {
      return {
        store: normalizeSessionStore(parsed),
        rawThreadCount: parsed.threads.length,
      }
    }
    if (parsed && typeof parsed === 'object' && (parsed.role === 'user' || parsed.role === 'assistant')) {
      return {
        store: storeFromLegacyMessages([normalizeAiHistoryRecord(parsed)]),
        rawThreadCount: 1,
      }
    }
  } catch {
    // fall through to JSONL migration
  }

  const legacy = storeFromLegacyMessages(parseLegacyMessageRecords(data))
  return { store: legacy, rawThreadCount: legacy.threads.length }
}

export async function readAiSessionStore(sessionId: string): Promise<AiSessionStore> {
  const { store } = await readAiSessionStoreFromDisk(sessionId)
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

async function writeAiSessionStoreUnlocked(sessionId: string, store: AiSessionStore): Promise<void> {
  const historyPath = getAiHistoryPath(sessionId)
  await mkdir(getAiHistoryDir(), { recursive: true })
  const normalized = normalizeSessionStore(store)
  await writeFile(historyPath, JSON.stringify(normalized, null, 0), 'utf-8')
}

export async function readAiSessionStoreAndGc(sessionId: string): Promise<AiSessionStore> {
  return runAiStoreTask(sessionId, async () => {
    const { store, rawThreadCount } = await readAiSessionStoreFromDisk(sessionId)
    if (rawThreadCount != null && store.threads.length < rawThreadCount) {
      await writeAiSessionStoreUnlocked(sessionId, store)
    }
    return store
  })
}

export async function writeAiSessionStore(sessionId: string, store: AiSessionStore): Promise<void> {
  let snapshot: AiSessionStore
  try {
    snapshot = JSON.parse(JSON.stringify(store))
  } catch {
    snapshot = normalizeSessionStore(store)
  }
  return runAiStoreTask(sessionId, () => writeAiSessionStoreUnlocked(sessionId, snapshot))
}

export async function mutateAiSessionStore(
  sessionId: string,
  mutator: (store: AiSessionStore) => void | Promise<void>,
): Promise<AiSessionStore> {
  return runAiStoreTask(sessionId, async () => {
    const store = await readAiSessionStore(sessionId)
    await mutator(store)
    await writeAiSessionStoreUnlocked(sessionId, store)
    return store
  })
}

export function getActiveThread(store: AiSessionStore): AiConversationThread {
  return store.threads.find((t) => t.id === store.activeThreadId) || store.threads[0]
}

export async function writeAiHistoryRecords(sessionId: string, records: AiHistoryRecord[]): Promise<void> {
  await mutateAiSessionStore(sessionId, (store) => {
    const active = getActiveThread(store)
    active.messages = records.map((r) => normalizeAiHistoryRecord(r)).sort((a, b) => a.createdAt - b.createdAt)
    if (!active.titleGenerated) {
      active.title = titleFromMessages(active.messages) || active.title
    }
    active.updatedAt = Date.now()
  })
}

export async function upsertAiHistoryRecord(sessionId: string, record: any): Promise<void> {
  const next = normalizeAiHistoryRecord(record)
  await mutateAiSessionStore(sessionId, (store) => {
    const active = getActiveThread(store)
    const idx = active.messages.findIndex((r) => r.id === next.id)
    if (idx >= 0) active.messages[idx] = next
    else active.messages.push(next)
    active.messages.sort((a, b) => a.createdAt - b.createdAt)
    if (!active.titleGenerated) {
      active.title = titleFromMessages(active.messages) || active.title
    }
    active.updatedAt = Date.now()
  })
}

export async function setThreadGeneratedTitle(
  sessionId: string,
  threadId: string,
  title: string,
): Promise<boolean> {
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 40)
  if (!clean) return false

  let updated = false
  await mutateAiSessionStore(sessionId, (store) => {
    const thread = store.threads.find((t) => t.id === threadId)
    if (!thread || thread.titleGenerated) return
    thread.title = clean
    thread.titleGenerated = true
    thread.updatedAt = Date.now()
    updated = true
  })
  return updated
}

export async function createNewConversationAtomic(
  sessionId: string,
  payload: {
    threadId?: string
    messages?: any[]
    title?: string
    titleGenerated?: boolean
  },
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

    if (payload.titleGenerated && typeof payload.title === 'string' && payload.title.trim()) {
      active.title = payload.title.trim().slice(0, 80)
      active.titleGenerated = true
    } else if (!active.titleGenerated) {
      active.title = titleFromMessages(active.messages) || active.title || ''
    }
    active.updatedAt = now

    abortTitleGeneration(sessionId, active.id)

    const fresh = createEmptyThread(now)
    store.threads.push(fresh)
    store.activeThreadId = fresh.id
    pruneEmptyThreads(store)
  })
}
