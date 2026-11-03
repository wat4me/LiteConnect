import { AI_TOOL_DIFF_MAX_CHARS } from '../../../shared/aiToolDiff'
import { AI_QUESTION_ARGS_MAX, AI_QUESTION_TOOL } from '../../../shared/aiQuestions'
import { normalizeAiImages } from '../../../shared/aiImages'
import { t } from '../../i18n'
import { normalizeAiCompactionCount } from '../../../shared/aiCompaction'
import { aiToolGroupsFromHistory, normalizeAiToolGroups } from '../../../shared/aiToolCatalog'
import { isAiMarkdownFilePath } from '../../../shared/aiFixedContext'
import { limitAiMessagesPreservingToolProtocol } from '../../../shared/aiMessages'
import { MAX_AI_TOOL_CALLS_PER_TURN, MAX_AI_TURN_SEGMENTS } from '../../../shared/aiToolLimits'
import { normalizeAiUsage } from '../../../shared/aiUsage'
import { normalizeAiHistoryLimits, type AiHistoryLimits } from '../../../shared/aiHistoryLimits'
import type {
  AiChatMessage, AiChatSegment, AiConversationContextFile, AiConversationThread,
  AiContextCheckpoint, AiHistoryRecord, AiSessionStore, AiToolRun,
} from '../../../shared/types/ai'

export function createThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Retention and pruning work on full threads and on index entries alike. */
export type AiThreadLike<M> = {
  id: string
  pinned?: boolean
  updatedAt: number
  contextCheckpoint?: AiContextCheckpoint
  messages: M[]
}
export type AiStoreLike<M> = { activeThreadId: string; threads: AiThreadLike<M>[] }

/** Titles keep as much of the first user message as is worth storing. */
export const AI_HISTORY_TITLE_MAX = 200

/** Tool results keep one ceiling in the visible run and in the replayed transcript. */
export const AI_TOOL_RUN_CONTENT_MAX = 20_000

export function titleFromMessages(messages: AiHistoryRecord[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && (m.content.trim() || m.images?.length))
  if (!firstUser) return ''
  return (firstUser.content.trim() || firstUser.images?.map(image => image.name).join('、') || '').replace(/\s+/g, ' ').trim().slice(0, AI_HISTORY_TITLE_MAX)
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
export function pruneEmptyThreads<M>(
  store: AiStoreLike<M>,
  fresh: () => AiThreadLike<M> = createEmptyThread as unknown as () => AiThreadLike<M>,
): void {
  if (!Array.isArray(store.threads) || store.threads.length === 0) {
    const thread = fresh()
    store.threads = [thread]
    store.activeThreadId = thread.id
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
    const thread = fresh()
    store.threads = [thread]
    store.activeThreadId = thread.id
    return
  }

  if (!store.threads.some((t) => t.id === store.activeThreadId)) {
    const preferred =
      store.threads.find((t) => t.messages.length > 0) || store.threads[0]
    store.activeThreadId = preferred.id
  }
}

/**
 * A stored segment may carry `length` instead of `text`: the next span of the
 * record's own content or reasoning, so the body is never written twice.
 */
function normalizeSegments(raw: unknown, content: string, reasoning: string): AiChatSegment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: AiChatSegment[] = []
  const source = { content, reasoning }
  const cursor = { content: 0, reasoning: 0 }
  for (const item of raw.slice(0, MAX_AI_TURN_SEGMENTS)) {
    if (!item || typeof item !== 'object') continue
    const seg = item as Record<string, unknown>
    if (seg.kind === 'reasoning' || seg.kind === 'content') {
      let text = ''
      if (typeof seg.text === 'string') text = seg.text.slice(0, 200000)
      else if (typeof seg.length === 'number' && Number.isInteger(seg.length) && seg.length > 0) {
        text = source[seg.kind].slice(cursor[seg.kind], cursor[seg.kind] + seg.length)
        cursor[seg.kind] += seg.length
      }
      if (text) out.push({ kind: seg.kind, text })
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
      rec.status === 'question' ||
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
      args: typeof rec.args === 'string' ? rec.args.slice(0, name === AI_QUESTION_TOOL ? AI_QUESTION_ARGS_MAX : 4000) : '',
      content: typeof rec.content === 'string' ? rec.content.slice(0, AI_TOOL_RUN_CONTENT_MAX) : '',
      isError: rec.isError === true,
      status,
      risk,
      jobIds: Array.isArray(rec.jobIds) ? rec.jobIds.filter((id): id is string => typeof id === 'string' && id.length <= 100).slice(0, 20) : undefined,
      target: typeof rec.target === 'string' ? rec.target.slice(0, 500) : undefined,
      reason: typeof rec.reason === 'string' ? rec.reason.slice(0, 500) : undefined,
      diffSummary: typeof rec.diffSummary === 'string' ? rec.diffSummary.slice(0, 500) : undefined,
      diffPreview: typeof rec.diffPreview === 'string' ? rec.diffPreview.slice(0, AI_TOOL_DIFF_MAX_CHARS) : undefined,
    })
  }
  return out.length ? out : undefined
}

/**
 * Replayed tool results share the visible run's ceiling. Stored references are
 * filled before validation: `contentRef: 'toolRun'` from the matching run, and
 * assistant `contentSpan` / `reasoningSpan` from the record's own text in order.
 */
function expandApiMessages(raw: unknown[], toolRuns: AiToolRun[] | undefined, content: string, reasoning: string): unknown[] {
  const cursor = { content: 0, reasoning: 0 }
  return raw.map((item) => {
    if (!item || typeof item !== 'object') return item
    const message = item as Record<string, unknown>
    if (message.role === 'tool') {
      if (message.contentRef === 'toolRun') {
        const id = typeof message.toolCallId === 'string'
          ? message.toolCallId
          : typeof message.tool_call_id === 'string' ? message.tool_call_id : ''
        const { contentRef: _ref, ...rest } = message
        return { ...rest, content: toolRuns?.find((run) => run.id === id)?.content ?? '' }
      }
      if (typeof message.content === 'string' && message.content.length > AI_TOOL_RUN_CONTENT_MAX) {
        return { ...message, content: message.content.slice(0, AI_TOOL_RUN_CONTENT_MAX) }
      }
      return item
    }
    if (message.role === 'assistant' && (typeof message.contentSpan === 'number' || typeof message.reasoningSpan === 'number')) {
      const { contentSpan, reasoningSpan, ...rest } = message
      const next: Record<string, unknown> = rest
      if (typeof contentSpan === 'number' && Number.isInteger(contentSpan) && contentSpan >= 0) {
        next.content = content.slice(cursor.content, cursor.content + contentSpan)
        cursor.content += contentSpan
      }
      if (typeof reasoningSpan === 'number' && Number.isInteger(reasoningSpan) && reasoningSpan >= 0) {
        next.reasoningContent = reasoning.slice(cursor.reasoning, cursor.reasoning + reasoningSpan)
        cursor.reasoning += reasoningSpan
      }
      return next
    }
    return item
  })
}

function normalizeApiMessages(
  raw: unknown,
  toolRuns: AiToolRun[] | undefined,
  content: string,
  reasoning: string,
): AiChatMessage[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out = limitAiMessagesPreservingToolProtocol(expandApiMessages(raw, toolRuns, content, reasoning))
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
  const content: string = record.content.slice(0, 200000)
  const reasoningContent: string | undefined =
    typeof record.reasoningContent === 'string' ? record.reasoningContent.slice(0, 200000) : undefined
  const toolRuns = normalizeToolRuns(record.toolRuns)
  return {
    id: typeof record.id === 'string' && record.id ? record.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: record.role,
    content,
    backgroundNotice: typeof record.backgroundNotice === 'string' ? record.backgroundNotice.slice(0, 32000) : undefined,
    ...(record.role === 'user' && record.images?.length ? { images: normalizeAiImages(record.images, t) } : {}),
    reasoningContent,
    usage: normalizeAiUsage(record.usage),
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
    toolRuns,
    segments: normalizeSegments(record.segments, content, reasoningContent || ''),
    apiMessages: normalizeApiMessages(record.apiMessages, toolRuns, content, reasoningContent || ''),
  }
}

function limitThreadMessages<M extends { role: 'user' | 'assistant' }>(messages: M[], maxMessages: number): M[] {
  if (messages.length <= maxMessages) return messages
  const retained = messages.slice(-maxMessages)
  const firstUser = retained.findIndex((message) => message.role === 'user')
  return firstUser > 0 ? retained.slice(firstUser) : retained
}

export function normalizeContextCheckpoint(
  raw: unknown,
  messages: ReadonlyArray<{ id: string }>,
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
    compactionCount: normalizeAiCompactionCount(item.compactionCount) || 1,
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
  const messages = limitThreadMessages<AiHistoryRecord>(allMessages, limits.maxMessages)
  const toolGroups = normalizeAiToolGroups([...normalizeAiToolGroups(raw.toolGroups), ...aiToolGroupsFromHistory(allMessages)])
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : messages[0]?.createdAt || Date.now()
  const updatedAt =
    typeof raw.updatedAt === 'number'
      ? raw.updatedAt
      : messages[messages.length - 1]?.createdAt || createdAt
  const customTitle = typeof raw.customTitle === 'string'
    ? raw.customTitle.replace(/\s+/g, ' ').trim().slice(0, AI_HISTORY_TITLE_MAX)
    : ''
  const title = customTitle || titleFromMessages(messages) ||
    (typeof raw.title === 'string' ? raw.title.trim().slice(0, AI_HISTORY_TITLE_MAX) : '')
  const contextCheckpoint = normalizeContextCheckpoint(raw.contextCheckpoint, messages)
  const compactionCount = Math.max(normalizeAiCompactionCount(raw.compactionCount), normalizeAiCompactionCount((raw.contextCheckpoint as AiContextCheckpoint | undefined)?.compactionCount), contextCheckpoint ? 1 : 0)
  const contextFiles = normalizeAiContextFiles(raw.contextFiles)
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createThreadId(),
    title,
    ...(customTitle ? { customTitle } : {}),
    ...(raw.pinned === true ? { pinned: true } : {}),
    createdAt,
    updatedAt,
    messages,
    ...(toolGroups.length ? { toolGroups } : {}),
    ...(contextCheckpoint ? { contextCheckpoint } : {}),
    contextFiles,
    ...(compactionCount ? { compactionCount } : {}),
  }
}

export function applyAiHistoryLimits<M extends { id: string; role: 'user' | 'assistant' }>(
  store: AiStoreLike<M>,
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
        if (run.status === 'question') {
          run.status = 'aborted'
          run.content = 'QUESTION_CANCELLED: The application restarted before the user answered. No answer or approval was given.'
          changed = true
        } else if (run.status === 'ask' || run.status === 'running') {
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

export function getActiveThread(store: AiSessionStore): AiConversationThread {
  return store.threads.find((t) => t.id === store.activeThreadId) || store.threads[0]
}

/**
 * Storage form of a record. Segment text and the assistant transcript's text and
 * reasoning become spans of the record's own content/reasoning, and a tool result
 * identical to its run becomes a reference; `normalizeAiHistoryRecord` expands
 * all of them, so readers never see this shape.
 */
export function compactAiHistoryRecordForStorage(record: AiHistoryRecord): unknown {
  let stored: Record<string, unknown> = record as unknown as Record<string, unknown>
  if (record.segments?.length) {
    const joined = { content: '', reasoning: '' }
    for (const segment of record.segments) if (segment.kind !== 'tool') joined[segment.kind] += segment.text
    const spans = {
      content: joined.content === record.content,
      reasoning: joined.reasoning === (record.reasoningContent || ''),
    }
    if (spans.content || spans.reasoning) {
      stored = { ...stored, segments: record.segments.map((segment) =>
        segment.kind !== 'tool' && spans[segment.kind] ? { kind: segment.kind, length: segment.text.length } : segment) }
    }
  }
  if (record.apiMessages?.length) {
    const results = new Map((record.toolRuns || []).map((run) => [run.id, run.content]))
    const assistant = record.apiMessages.filter((message) => message.role === 'assistant')
    const contentSpans = record.content.length > 0 && assistant.map((message) => message.content).join('') === record.content
    const reasoningSpans = assistant.some((message) => message.reasoningContent) &&
      assistant.map((message) => message.reasoningContent || '').join('') === (record.reasoningContent || '')
    let changed = false
    const apiMessages = record.apiMessages.map((message) => {
      if (message.role === 'tool') {
        if (!message.toolCallId || results.get(message.toolCallId) !== message.content) return message
        changed = true
        return { role: 'tool', toolCallId: message.toolCallId, content: '', contentRef: 'toolRun' }
      }
      const spanContent = message.role === 'assistant' && contentSpans && message.content.length > 0
      const spanReasoning = message.role === 'assistant' && reasoningSpans && Boolean(message.reasoningContent)
      if (!spanContent && !spanReasoning) return message
      changed = true
      return {
        ...message,
        ...(spanContent ? { content: '', contentSpan: message.content.length } : {}),
        ...(spanReasoning ? { reasoningContent: undefined, reasoningSpan: message.reasoningContent!.length } : {}),
      }
    })
    if (changed) stored = { ...stored, apiMessages }
  }
  return stored
}

export function compactAiSessionStoreForStorage(store: AiSessionStore): unknown {
  return {
    ...store,
    threads: store.threads.map((thread) => ({ ...thread, messages: thread.messages.map(compactAiHistoryRecordForStorage) })),
  }
}
