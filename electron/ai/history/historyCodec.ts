import type { AiConversationThread, AiHistoryRecord, AiSessionStore } from '../../../shared/types/ai'
import type { AiHistoryLimits } from '../../../shared/aiHistoryLimits'
import { createEmptyStore, createThreadId, normalizeAiHistoryRecord, normalizeSessionStore, titleFromMessages } from './historyModel'

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
    createdAt: messages[0]?.createdAt || now,
    updatedAt: messages[messages.length - 1]?.createdAt || now,
    messages,
    contextFiles: [],
  }
  return {
    version: 1,
    activeThreadId: thread.id,
    threads: [thread],
    defaultContextFiles: [],
  }
}

export function decodeAiSessionStore(
  stored: unknown,
  limits?: Partial<AiHistoryLimits>,
): {
  store: AiSessionStore
  rawThreadCount: number | null
  rawMessageCount: number | null
  created?: boolean
} {
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
