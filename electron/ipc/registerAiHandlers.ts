import { ipcMain, app } from 'electron'
import { existsSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { SettingsStore } from '../store/settingsStore'
import { t } from '../i18n'
import {
  clampContextWindowTokens,
  isContextLengthError,
  packAiMessages,
  parseAiModels,
  resolveContextWindowTokens,
  type AiContextMessage,
} from '../../shared/aiContext'
import {
  accumulateToolCallDeltas,
  bindSessionArgs,
  looksLikeToolsUnsupported,
  MAX_SSH_TOOL_ROUNDS,
  parseToolCallArguments,
  sshToolsForChat,
  sshToolSystemAddendum,
  type AccumulatedToolCall,
} from '../ai/sshToolChat'
import type { SshMcpRuntime } from '../mcp/runtime'
import { isValidUUID } from '../utils/validation'

type AiChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function normalizeAiBaseUrl(baseUrl: string): string {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw new Error('Invalid AI base URL')
  }

  let parsed: URL
  try {
    parsed = new URL(baseUrl.trim())
  } catch {
    throw new Error('Invalid AI base URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AI base URL must use http or https')
  }

  return parsed.toString().replace(/\/$/, '')
}

function getAiChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeAiBaseUrl(baseUrl)
  if (normalized.endsWith('/chat/completions')) return normalized
  return `${normalized}/chat/completions`
}

async function testAiProviderConfig(provider: any): Promise<void> {
  if (!provider || typeof provider !== 'object') throw new Error('Invalid AI provider')
  const baseUrl = normalizeAiBaseUrl(provider.baseUrl)
  const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey.trim() : ''
  const model = typeof provider.model === 'string' ? provider.model.trim() : ''
  if (!apiKey) throw new Error('AI API key is required')
  if (!model) throw new Error('AI model is required')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(getAiChatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    })
    if (response.ok) return
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 300)
    throw new Error(`AI provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('AI provider connection timed out')
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

function clampTemperature(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isNaN(n)) return 0.7
  return Math.max(0, Math.min(2, Math.round(n * 100) / 100))
}

function validateAiSettings(settings: any): {
  providers: any[]
  activeProviderId: string | null
  activeModel: string
  systemPrompt: string
  temperature: number
  contextWindowTokens?: number
} {
  if (!settings || typeof settings !== 'object') {
    throw new Error('Invalid AI settings')
  }
  const rawProviders = Array.isArray(settings.providers) ? settings.providers : []
  const providers = rawProviders.map((p: any, i: number) => {
    if (!p || typeof p !== 'object') throw new Error(`Invalid AI provider at index ${i}`)
    const baseUrl = normalizeAiBaseUrl(p.baseUrl)
    return {
      id: typeof p.id === 'string' && p.id ? p.id : `provider-${Date.now()}-${i}`,
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : t('common.unnamedProvider'),
      baseUrl,
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
      models: parseAiModels(p.models),
    }
  })
  return {
    providers,
    activeProviderId: typeof settings.activeProviderId === 'string' ? settings.activeProviderId : (providers[0]?.id ?? null),
    activeModel: typeof settings.activeModel === 'string' ? settings.activeModel.trim() : '',
    systemPrompt: typeof settings.systemPrompt === 'string' ? settings.systemPrompt : '',
    temperature: clampTemperature(settings.temperature),
    contextWindowTokens: clampContextWindowTokens(settings.contextWindowTokens),
  }
}

function validateAiMessages(messages: any): AiChatMessage[] {
  if (!Array.isArray(messages)) throw new Error('Invalid AI messages')
  const validRoles = new Set(['system', 'user', 'assistant'])
  return messages.map((message) => {
    if (!message || typeof message !== 'object') throw new Error('Invalid AI message')
    if (!validRoles.has(message.role)) throw new Error('Invalid AI message role')
    if (typeof message.content !== 'string' || !message.content.trim()) {
      throw new Error('Invalid AI message content')
    }
    return {
      role: message.role,
      // Hard cap only as a DoS guard; packAiMessages does the real windowing.
      content: message.content.slice(0, 200_000),
    }
  })
}

function packRequestMessages(
  settings: { systemPrompt: string; model: string; contextWindowTokens?: number },
  incoming: AiChatMessage[],
  budgetTokens?: number,
  extraSystem?: string,
): AiContextMessage[] {
  const systemPrompt = [settings.systemPrompt, extraSystem].filter((s) => s && s.trim()).join('\n\n')
  return packAiMessages({
    systemPrompt,
    messages: incoming.filter((m) => m.role !== 'system'),
    model: settings.model,
    budgetTokens,
    contextWindowTokens: settings.contextWindowTokens,
  }).messages
}

async function readHttpErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json()
    return data?.error?.message || data?.message || fallback
  } catch {
    return fallback
  }
}

function getFirstString(...values: any[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function normalizeAiContent(content: any): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object') {
        return getFirstString(part.text, part.content)
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractAiUsage(usage: any): {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  reasoningTokens?: number
} | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const result = {
    promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
    completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
    totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
    reasoningTokens: typeof usage.completion_tokens_details?.reasoning_tokens === 'number'
      ? usage.completion_tokens_details.reasoning_tokens
      : typeof usage.reasoning_tokens === 'number'
        ? usage.reasoning_tokens
        : undefined,
  }
  if (Object.values(result).every((value) => value === undefined)) return undefined
  return result
}

type AiToolRunRecord = {
  id: string
  name: string
  args: string
  content: string
  isError: boolean
}

type AiHistoryRecord = {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoningContent?: string
  usage?: ReturnType<typeof extractAiUsage>
  error?: boolean
  createdAt: number
  toolRuns?: AiToolRunRecord[]
}

type AiConversationThread = {
  id: string
  title: string
  /** Model-generated title; when true, first-user-message fallback must not overwrite. */
  titleGenerated?: boolean
  createdAt: number
  updatedAt: number
  messages: AiHistoryRecord[]
}

type AiSessionStore = {
  version: 1
  activeThreadId: string
  threads: AiConversationThread[]
}

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

function createThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function titleFromMessages(messages: AiHistoryRecord[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim())
  if (!firstUser) return ''
  return firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** Clean model output into a short history title. Never throws. */
function sanitizeGeneratedTitle(raw: string): string {
  let s = String(raw || '').trim()
  if (!s) return ''

  // Drop fenced code / markdown noise common in model replies
  s = s.replace(/^```[\w]*\s*/g, '').replace(/```$/g, '').trim()
  s = s.replace(/^(标题|Title|会话标题|主题)\s*[:：]\s*/i, '')
  s = s.replace(/^#+\s+/, '')
  s = s.replace(/^\*\*(.+)\*\*$/s, '$1').trim()
  s = s.replace(/^["'`「『《【\[]+|["'`」』》】\]]+$/g, '').trim()

  // Prefer first non-empty line; skip pure punctuation lines
  const line =
    s
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !/^[\s\-—–·.•|:/\\]+$/.test(l)) || ''
  s = line.replace(/\s+/g, ' ').trim()
  if (s.length > 40) s = s.slice(0, 40).trim()

  // Reject empty / too generic
  if (!s || s === '新对话' || /^new\s*chat$/i.test(s)) return ''
  // Reject if model dumped a whole paragraph (no spaces and super long CJK is ok up to 40)
  if (s.length < 2) return ''
  return s
}

/** Pull any usable string from a chat completion choice for title purposes. */
function extractTitleCandidateFromChoice(choice: any, data: any): string {
  const message = choice?.message || {}
  const fromContent = normalizeAiContent(message.content ?? choice?.text)
  if (fromContent.trim()) return fromContent

  // Some providers put a short answer only in reasoning fields when max_tokens is tight
  const fromReasoning = getFirstString(
    message.reasoning_content,
    message.reasoning,
    message.thinking,
    choice?.reasoning_content,
    choice?.reasoning,
    data?.reasoning_content,
    data?.reasoning,
  )
  if (fromReasoning.trim()) {
    // Reasoning is often long — take last short line that looks like a title
    const lines = fromReasoning
      .split(/\r?\n/)
      .map((l: string) => l.trim())
      .filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      const cleaned = sanitizeGeneratedTitle(lines[i])
      if (cleaned && cleaned.length <= 40) return cleaned
    }
  }
  return ''
}

function createEmptyThread(now = Date.now()): AiConversationThread {
  return {
    id: createThreadId(),
    title: '',
    titleGenerated: false,
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}

function createEmptyStore(): AiSessionStore {
  const thread = createEmptyThread()
  return {
    version: 1,
    activeThreadId: thread.id,
    threads: [thread],
  }
}

/**
 * Drop empty conversation shells that are not the active draft.
 * Users may open AI / 新开对话 without sending; those empty threads must not pile up in history.
 * Keeps: every thread with messages + the current active thread (even if still empty).
 */
function pruneEmptyThreads(store: AiSessionStore): void {
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

  // Multiple empties should never share activeId; still collapse stray empties defensively
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
    // Prefer a non-empty thread as active if active empty was dropped
    const preferred =
      store.threads.find((t) => t.messages.length > 0) || store.threads[0]
    store.activeThreadId = preferred.id
  }
}

function normalizeAiHistoryRecord(record: any): AiHistoryRecord {
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
  }
}

function normalizeToolRuns(raw: unknown): AiToolRunRecord[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: AiToolRunRecord[] = []
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const name = typeof rec.name === 'string' ? rec.name.slice(0, 64) : ''
    if (!name) continue
    out.push({
      id: typeof rec.id === 'string' && rec.id ? rec.id : `${Date.now()}-${out.length}`,
      name,
      args: typeof rec.args === 'string' ? rec.args.slice(0, 4000) : '',
      content: typeof rec.content === 'string' ? rec.content.slice(0, 20000) : '',
      isError: rec.isError === true,
    })
  }
  return out.length ? out : undefined
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

function normalizeSessionStore(raw: any): AiSessionStore {
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
  /** Raw thread count before prune — used to decide whether to rewrite disk. */
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
    // Single legacy message object
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

async function readAiSessionStore(sessionId: string): Promise<AiSessionStore> {
  const { store } = await readAiSessionStoreFromDisk(sessionId)
  return store
}

/**
 * Load store and rewrite disk if empty non-active threads were pruned.
 * Called when the renderer opens AI / loads history so old junk is cleaned without waiting for a send.
 */
async function readAiSessionStoreAndGc(sessionId: string): Promise<AiSessionStore> {
  return runAiStoreTask(sessionId, async () => {
    const { store, rawThreadCount } = await readAiSessionStoreFromDisk(sessionId)
    if (rawThreadCount != null && store.threads.length < rawThreadCount) {
      await writeAiSessionStoreUnlocked(sessionId, store)
    }
    return store
  })
}

/**
 * Serialize all AI session-store mutations per sessionId.
 * Prevents races like: title-gen get→set overwriting a concurrent "新开对话"
 * that added a new empty thread.
 */
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

async function writeAiSessionStore(sessionId: string, store: AiSessionStore): Promise<void> {
  // Snapshot so a later mutation of the caller's object cannot change what we write
  // once this task is queued behind other session-store work.
  let snapshot: AiSessionStore
  try {
    snapshot = JSON.parse(JSON.stringify(store))
  } catch {
    snapshot = normalizeSessionStore(store)
  }
  return runAiStoreTask(sessionId, () => writeAiSessionStoreUnlocked(sessionId, snapshot))
}

/** Read-modify-write under the per-session lock. */
async function mutateAiSessionStore(
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

function getActiveThread(store: AiSessionStore): AiConversationThread {
  return store.threads.find((t) => t.id === store.activeThreadId) || store.threads[0]
}

async function readAiHistoryRecords(sessionId: string): Promise<AiHistoryRecord[]> {
  const store = await readAiSessionStore(sessionId)
  return getActiveThread(store).messages.slice()
}

async function writeAiHistoryRecords(sessionId: string, records: AiHistoryRecord[]): Promise<void> {
  await mutateAiSessionStore(sessionId, (store) => {
    const active = getActiveThread(store)
    active.messages = records.map((r) => normalizeAiHistoryRecord(r)).sort((a, b) => a.createdAt - b.createdAt)
    if (!active.titleGenerated) {
      active.title = titleFromMessages(active.messages) || active.title
    }
    active.updatedAt = Date.now()
  })
}

async function upsertAiHistoryRecord(sessionId: string, record: any): Promise<void> {
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

/**
 * Patch one thread's title without replacing the whole store from a stale snapshot.
 * Safe to call after the user already opened a new conversation.
 */
async function setThreadGeneratedTitle(
  sessionId: string,
  threadId: string,
  title: string,
): Promise<boolean> {
  // Trust caller (already sanitized); only normalize whitespace / length.
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

/** In-flight title HTTP requests — aborted when user starts a new conversation. */
const titleGenAbortByKey = new Map<string, AbortController>()

function titleGenAbortKey(sessionId: string, threadId: string): string {
  return `${sessionId}::${threadId}`
}

function abortTitleGeneration(sessionId: string, threadId?: string): void {
  if (threadId) {
    const key = titleGenAbortKey(sessionId, threadId)
    const c = titleGenAbortByKey.get(key)
    if (c) {
      c.abort()
      titleGenAbortByKey.delete(key)
    }
    return
  }
  for (const [key, c] of titleGenAbortByKey) {
    if (key.startsWith(`${sessionId}::`)) {
      c.abort()
      titleGenAbortByKey.delete(key)
    }
  }
}

/**
 * Atomically: flush current thread messages + open a fresh empty thread.
 * Avoids renderer full-store replace racing with title-gen / append.
 */
async function createNewConversationAtomic(
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

    // Flush latest messages from renderer into the thread being left
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

    // Abort any in-flight title HTTP for the thread we just left
    abortTitleGeneration(sessionId, active.id)

    const fresh = createEmptyThread(now)
    store.threads.push(fresh)
    store.activeThreadId = fresh.id
    // Drop any other empty shells (including a left thread that ended up with 0 messages)
    pruneEmptyThreads(store)
  })
}

function extractAiReasoningFromMessage(message: any): string {
  return getFirstString(
    message?.reasoning_content,
    message?.reasoning,
    message?.thinking
  )
}

function extractAiReasoningFromChoice(choice: any): string {
  return getFirstString(
    extractAiReasoningFromMessage(choice?.delta),
    extractAiReasoningFromMessage(choice?.message),
    choice?.reasoning_content,
    choice?.reasoning,
    choice?.thinking
  )
}

async function readAiStream(response: Response, onEvent: (event: any) => void): Promise<void> {
  if (!response.body) throw new Error(t('ai.noStreamBody'))
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() || ''

    for (const event of events) {
      const dataLines = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
      if (dataLines.length === 0) continue
      const payload = dataLines.join('\n')
      if (payload === '[DONE]') return
      try {
        onEvent(JSON.parse(payload))
      } catch {}
    }
  }
}

const activeAiStreams = new Map<string, AbortController>()

export function registerAiHandlers(settingsStore: SettingsStore, sshMcpRuntime?: SshMcpRuntime): void {
  const ensureSettingsReady = () => settingsStore.init().then(() => settingsStore.initMigrations())

  ipcMain.handle('settings:getAiSettings', async () => {
    await ensureSettingsReady()
    return settingsStore.getAiSettings()
  })

  ipcMain.handle('settings:setAiSettings', async (_event, settings: any) => {
    await ensureSettingsReady()
    await settingsStore.setAiSettings(validateAiSettings(settings))
  })

  ipcMain.handle('settings:switchAiModel', async (_event, providerId: string, model: string) => {
    await ensureSettingsReady()
    if (typeof providerId !== 'string' || typeof model !== 'string') {
      throw new Error('Invalid provider id or model')
    }
    return await settingsStore.switchAiModel(providerId, model)
  })

  ipcMain.handle('ai:testProvider', async (_event, provider: any) => {
    await testAiProviderConfig(provider)
    return { ok: true }
  })

  ipcMain.handle('ai:getSessionHistory', async (_event, sessionId: string) => {
    // GC empty shells when history is loaded
    const store = await readAiSessionStoreAndGc(sessionId)
    return getActiveThread(store).messages.slice()
  })

  ipcMain.handle('ai:getSessionStore', async (_event, sessionId: string) => {
    // GC empty shells whenever the AI panel loads / refreshes store
    return await readAiSessionStoreAndGc(sessionId)
  })

  ipcMain.handle('ai:setSessionStore', async (_event, sessionId: string, store: any) => {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid AI session id')
    }
    await writeAiSessionStore(sessionId, normalizeSessionStore(store))
  })

  ipcMain.handle(
    'ai:setThreadTitle',
    async (_event, sessionId: string, threadId: string, title: string) => {
      if (!sessionId || typeof sessionId !== 'string') return { ok: false }
      if (!threadId || typeof threadId !== 'string') return { ok: false }
      if (typeof title !== 'string') return { ok: false }
      try {
        const ok = await setThreadGeneratedTitle(sessionId, threadId, title)
        return { ok }
      } catch {
        return { ok: false }
      }
    },
  )

  ipcMain.handle('ai:createConversation', async (_event, sessionId: string, payload: any) => {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid AI session id')
    }
    try {
      const store = await createNewConversationAtomic(sessionId, payload && typeof payload === 'object' ? payload : {})
      return store
    } catch (err: any) {
      throw new Error(err?.message || 'Failed to create conversation')
    }
  })

  ipcMain.handle('ai:appendSessionHistory', async (_event, sessionId: string, record: any) => {
    // Upsert by id so streaming checkpoints update the same assistant message
    await upsertAiHistoryRecord(sessionId, record)
  })

  ipcMain.handle('ai:clearSessionHistory', async (_event, sessionId: string) => {
    await writeAiHistoryRecords(sessionId, [])
  })

  ipcMain.handle('ai:chat', async (_event, messages: any) => {
    await ensureSettingsReady()
    const settings = settingsStore.getAiResolvedConfig()
    const chatMessages = validateAiMessages(messages)
    if (!settings.apiKey.trim()) {
      throw new Error(t('ai.apiKeyRequired'))
    }

    const postChat = (packed: AiContextMessage[]) =>
      fetch(getAiChatCompletionsUrl(settings.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.model,
          temperature: settings.temperature ?? 0.7,
          messages: packed,
        }),
      })

    let packed = packRequestMessages(settings, chatMessages)
    let response = await postChat(packed)
    if (!response.ok) {
      const message = await readHttpErrorMessage(
        response,
        t('ai.requestFailed', { status: response.status }),
      )
      if (!isContextLengthError(message)) throw new Error(message)
      packed = packRequestMessages(
        settings,
        chatMessages,
        Math.max(4_096, Math.floor(resolveContextWindowTokens(settings.model, settings.contextWindowTokens) / 2)),
      )
      response = await postChat(packed)
      if (!response.ok) {
        throw new Error(await readHttpErrorMessage(response, message))
      }
    }

    const data = await response.json()
    const choice = data?.choices?.[0]
    const message = choice?.message || {}
    const content = normalizeAiContent(message.content ?? choice?.text)
    if (!content) {
      throw new Error(t('ai.noMessageContent'))
    }
    const reasoningContent = getFirstString(
      message.reasoning_content,
      message.reasoning,
      message.thinking,
      choice?.reasoning_content,
      choice?.reasoning,
      choice?.thinking,
      data?.reasoning_content,
      data?.reasoning
    )
    return {
      content,
      reasoningContent: reasoningContent || undefined,
      usage: extractAiUsage(data?.usage),
    }
  })

  ipcMain.handle('ai:chatStream', async (event, requestId: string, messages: any, opts?: { sessionId?: string }) => {
    if (!requestId || typeof requestId !== 'string') {
      throw new Error('Invalid AI request id')
    }
    await ensureSettingsReady()
    const settings = settingsStore.getAiResolvedConfig()
    const chatMessages = validateAiMessages(messages)
    if (!settings.apiKey.trim()) {
      throw new Error(t('ai.apiKeyRequired'))
    }

    const send = (payload: any) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(`ai:chatStream:${requestId}`, payload)
      }
    }

    const boundSessionId =
      typeof opts?.sessionId === 'string' && isValidUUID(opts.sessionId) ? opts.sessionId : ''
    let extraSystem = ''
    let useTools = Boolean(sshMcpRuntime && boundSessionId)
    if (useTools && sshMcpRuntime) {
      const listed = await sshMcpRuntime.call('list_sessions', {})
      const sessions =
        (listed.structuredContent as {
          sessions?: Array<{ sessionId: string; host?: string; username?: string; connectionName?: string }>
        })?.sessions || []
      const snap = sessions.find((s) => s.sessionId === boundSessionId)
      extraSystem = sshToolSystemAddendum({
        sessionId: boundSessionId,
        host: snap?.host,
        username: snap?.username,
        connectionName: snap?.connectionName,
      })
    }

    let packedMessages = packRequestMessages(settings, chatMessages, undefined, extraSystem)
    const tools = useTools ? sshToolsForChat() : undefined

    const createBody = (includeUsage: boolean, msgs: any[], withTools: boolean) => ({
      model: settings.model,
      temperature: settings.temperature ?? 0.7,
      messages: msgs,
      stream: true,
      ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
      ...(withTools && tools ? { tools, tool_choice: 'auto' as const } : {}),
    })

    const abortController = new AbortController()
    activeAiStreams.set(requestId, abortController)
    const cleanupStream = () => {
      activeAiStreams.delete(requestId)
    }

    const requestStream = (includeUsage: boolean, msgs: any[], withTools: boolean) =>
      fetch(getAiChatCompletionsUrl(settings.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(createBody(includeUsage, msgs, withTools)),
        signal: abortController.signal,
      })

    const openStream = async (msgs: any[], withTools: boolean) => {
      let response = await requestStream(true, msgs, withTools)
      if (!response.ok) response = await requestStream(false, msgs, withTools)
      return response
    }

    try {
      let apiMessages: any[] = packedMessages
      const contentParts: string[] = []
      let reasoningContent = ''
      let usage: ReturnType<typeof extractAiUsage> | undefined
      const toolRuns: AiToolRunRecord[] = []
      let toolsEnabled = Boolean(useTools && tools)

      for (let round = 0; round < (toolsEnabled ? MAX_SSH_TOOL_ROUNDS : 1); round++) {
        if (abortController.signal.aborted) break

        let response = await openStream(apiMessages, toolsEnabled)
        if (!response.ok) {
          const message = await readHttpErrorMessage(response, `AI request failed (${response.status})`)
          if (toolsEnabled && looksLikeToolsUnsupported(message)) {
            toolsEnabled = false
            response = await openStream(apiMessages, false)
          } else if (isContextLengthError(message) && round === 0) {
            packedMessages = packRequestMessages(
              settings,
              chatMessages,
              Math.max(4_096, Math.floor(resolveContextWindowTokens(settings.model, settings.contextWindowTokens) / 2)),
              extraSystem,
            )
            apiMessages = packedMessages
            response = await openStream(apiMessages, toolsEnabled)
          }
          if (!response.ok) {
            throw new Error(await readHttpErrorMessage(response, message))
          }
        }

        let roundContent = ''
        const toolAcc = new Map<number, AccumulatedToolCall>()
        await readAiStream(response, (chunk) => {
          if (abortController.signal.aborted) return
          const choice = chunk?.choices?.[0]
          const delta = choice?.delta || {}
          const contentDelta = normalizeAiContent(delta.content ?? choice?.text)
          const reasoningDelta = extractAiReasoningFromChoice(choice)
          const chunkUsage = extractAiUsage(chunk?.usage)
          accumulateToolCallDeltas(toolAcc, delta.tool_calls || choice?.message?.tool_calls)

          if (reasoningDelta) {
            reasoningContent += reasoningDelta
            send({ type: 'reasoning', value: reasoningDelta })
          }
          if (contentDelta) {
            roundContent += contentDelta
            send({ type: 'content', value: contentDelta })
          }
          if (chunkUsage) {
            usage = chunkUsage
            send({ type: 'usage', value: chunkUsage })
          }
        })

        if (roundContent.trim()) contentParts.push(roundContent)

        const calls = [...toolAcc.values()].filter((c) => c.name)
        if (!calls.length || !toolsEnabled || !sshMcpRuntime || abortController.signal.aborted) break

        const assistantToolCalls = calls.map((c, i) => ({
          id: c.id || `call_${round}_${i}`,
          type: 'function' as const,
          function: { name: c.name, arguments: c.arguments || '{}' },
        }))
        apiMessages = [
          ...apiMessages,
          {
            role: 'assistant',
            content: roundContent || null,
            tool_calls: assistantToolCalls,
          },
        ]

        for (const call of assistantToolCalls) {
          send({
            type: 'tool',
            value: { phase: 'start', id: call.id, name: call.function.name, args: call.function.arguments },
          })
          const result = await sshMcpRuntime.call(
            call.function.name,
            bindSessionArgs(parseToolCallArguments(call.function.arguments), boundSessionId),
          )
          const run: AiToolRunRecord = {
            id: call.id,
            name: call.function.name,
            args: call.function.arguments.slice(0, 4000),
            content: result.content.slice(0, 20000),
            isError: result.isError,
          }
          toolRuns.push(run)
          send({
            type: 'tool',
            value: {
              phase: 'done',
              id: run.id,
              name: run.name,
              args: run.args,
              content: run.content,
              isError: run.isError,
            },
          })
          apiMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: result.content,
          })
        }
      }

      const content = contentParts.join('\n\n')
      if (abortController.signal.aborted) {
        send({ type: 'done' })
        return {
          content,
          reasoningContent: reasoningContent || undefined,
          usage,
          toolRuns,
          aborted: true,
        }
      }

      send({ type: 'done' })
      return {
        content,
        reasoningContent: reasoningContent || undefined,
        usage,
        toolRuns,
      }
    } catch (err: any) {
      if (abortController.signal.aborted || err?.name === 'AbortError') {
        send({ type: 'done' })
        return { content: '', aborted: true }
      }
      throw err
    } finally {
      cleanupStream()
    }
  })

  ipcMain.handle('ai:abortChatStream', async (_event, requestId: string) => {
    if (!requestId || typeof requestId !== 'string') return false
    const controller = activeAiStreams.get(requestId)
    if (!controller) return false
    controller.abort()
    activeAiStreams.delete(requestId)
    return true
  })

  /**
   * Short non-streaming request to name a conversation.
   * Always resolves with `{ title }` (possibly empty) — never throws, so Electron
   * will not log "Error occurred in handler for 'ai:generateConversationTitle'".
   * Pass sessionId+threadId to allow abort when user opens a new conversation.
   */
  ipcMain.handle('ai:generateConversationTitle', async (_event, payload: any) => {
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : ''
    const threadId = typeof payload?.threadId === 'string' ? payload.threadId : ''
    const abortKey = sessionId && threadId ? titleGenAbortKey(sessionId, threadId) : ''

    try {
      await ensureSettingsReady()
      const settings = settingsStore.getAiResolvedConfig()
      if (!settings.apiKey.trim()) return { title: '' }

      const userText = typeof payload?.userText === 'string' ? payload.userText.trim() : ''
      const assistantText = typeof payload?.assistantText === 'string' ? payload.assistantText.trim() : ''
      if (!userText) return { title: '' }

      const userSlice = userText.slice(0, 400)
      const asstSlice = assistantText.slice(0, 400)
      const context = asstSlice
        ? `用户：${userSlice}\n助手：${asstSlice}`
        : `用户：${userSlice}`

      // Replace any previous in-flight title request for this thread
      if (abortKey) abortTitleGeneration(sessionId, threadId)

      const controller = new AbortController()
      if (abortKey) titleGenAbortByKey.set(abortKey, controller)
      const timeout = setTimeout(() => controller.abort(), 20_000)
      try {
        const response = await fetch(getAiChatCompletionsUrl(settings.baseUrl), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.apiKey}`,
          },
          body: JSON.stringify({
            model: settings.model,
            temperature: 0.2,
            max_tokens: 128,
            stream: false,
            messages: [
              {
                role: 'user',
                content:
                  '请根据下面的对话写一个简短中文标题。\n' +
                  '规则：不超过16个字；不要引号/书名号/序号/「标题：」前缀；不要解释；只输出标题一行。\n\n' +
                  context,
              },
            ],
          }),
          signal: controller.signal,
        })

        if (!response.ok) return { title: '' }

        const data = await response.json()
        const choice = data?.choices?.[0]
        const raw = extractTitleCandidateFromChoice(choice, data)
        const title = sanitizeGeneratedTitle(raw)
        return { title: title || '' }
      } catch {
        // Abort / network / parse — soft fail
        return { title: '' }
      } finally {
        clearTimeout(timeout)
        if (abortKey && titleGenAbortByKey.get(abortKey) === controller) {
          titleGenAbortByKey.delete(abortKey)
        }
      }
    } catch {
      return { title: '' }
    }
  })
}
