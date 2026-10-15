import type { AiChatMessage, AiChatResult, AiChatSegment, AiHistoryRecord, AiToolRun, AiUsage } from '@shared/types/ai'
import type { ChatItem } from '@/domain/ai/chat'
import { normalizeAiUsage } from '@shared/aiUsage'
import { t } from '@/i18n'

export function sanitizeAiErrorMessage(raw: string): string {
  return String(raw || '')
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

export function createMessage(
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
export function plainUsage(usage: AiUsage | undefined): AiUsage | undefined {
  return normalizeAiUsage(usage)
}

export function toHistoryRecord(message: ChatItem): AiHistoryRecord {
  const record: AiHistoryRecord = {
    id: String(message.id),
    role: message.role as 'user' | 'assistant',
    content: String(message.content ?? ''),
    backgroundNotice: message.backgroundNotice,
    createdAt: Number(message.createdAt) || Date.now(),
  }
  if (typeof message.completedAt === 'number' && Number.isFinite(message.completedAt)) {
    record.completedAt = message.completedAt
  }
  if (message.role === 'user' && message.images?.length) record.images = JSON.parse(JSON.stringify(message.images))
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

export function fromHistoryRecord(record: AiHistoryRecord): ChatItem {
  return {
    id: record.id,
    role: record.role,
    content: record.content || (record.role === 'assistant' && record.status === 'aborted' ? t('ai.stopped') : ''),
    backgroundNotice: record.backgroundNotice,
    images: record.images,
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

export function plainToolRuns(runs: AiToolRun[] | undefined): AiToolRun[] | undefined {
  if (!runs?.length) return undefined
  return runs.map((run) => ({
    id: String(run.id || ''),
    name: String(run.name || ''),
    args: String(run.args || ''),
    content: String(run.content || ''),
    isError: run.isError === true,
    status: run.status,
    risk: run.risk,
    jobIds: run.jobIds ? [...run.jobIds] : undefined,
    target: run.target,
    reason: run.reason,
    diffSummary: run.diffSummary,
    diffPreview: run.diffPreview,
  }))
}

export function plainSegments(segments: AiChatSegment[] | undefined): AiChatSegment[] | undefined {
  if (!segments?.length) return undefined
  return segments.map((seg) =>
    seg.kind === 'tool' ? { kind: 'tool' as const, runId: String(seg.runId) } : { kind: seg.kind, text: String(seg.text) },
  )
}

export function plainApiMessages(messages: AiChatMessage[] | undefined): AiChatMessage[] | undefined {
  if (!messages?.length) return undefined
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool' as const, content: String(m.content ?? ''), toolCallId: String(m.toolCallId || '') }
    }
    if (m.role === 'user' || m.role === 'system') {
      return { role: m.role, content: String(m.content ?? ''), ...(m.images?.length ? { images: JSON.parse(JSON.stringify(m.images)) } : {}) }
    }
    const row: AiChatMessage = { role: 'assistant', content: String(m.content ?? '') }
    if (m.anthropicContent?.length) row.anthropicContent = JSON.parse(JSON.stringify(m.anthropicContent))
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

/** Deep-clone via JSON so Vue Proxies never cross Electron IPC. */
export function cloneForIpc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
