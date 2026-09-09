import { lookupModelsDevContext } from './modelsDevContext'
import type { AiChatMessage, AiUsage } from './types/ai'

export type AiContextRole = AiChatMessage['role']
export type AiContextMessage = AiChatMessage

export type AiContextPack = {
  messages: AiContextMessage[]
  /** Estimated tokens of the packed prompt (system + kept turns). */
  promptTokens: number
  /** Prompt budget after reserving output tokens. */
  budgetTokens: number
  /** Conversation turns omitted because they did not fit. */
  droppedCount: number
  /** Messages shortened to fit the per-message / remaining budget. */
  truncatedCount: number
}

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 300_000
export const DEFAULT_OUTPUT_RESERVE_TOKENS = 4_000
export const DEFAULT_MAX_MESSAGE_TOKENS = 8_000
export const MIN_CONTEXT_WINDOW_TOKENS = 4_096
export const MAX_CONTEXT_WINDOW_TOKENS = 4_000_000

const TRUNCATE_MARKER = '\n…\n'

/** CJK ≈ 1 token; other scripts ≈ 4 chars / token. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0
    if (isCjkCodePoint(code)) cjk += 1
    else other += 1
  }
  return cjk + Math.ceil(other / 4)
}

function isCjkCodePoint(code: number): boolean {
  return (
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xff00 && code <= 0xffef)
  )
}

export function messageTokens(message: AiContextMessage): number {
  let n = estimateTokens(message.content || '') + estimateTokens(message.reasoningContent || '') + 6
  if (message.role === 'tool' && message.toolCallId) n += 4
  for (const call of message.toolCalls || []) {
    n += estimateTokens(call.function?.name || '') + estimateTokens(call.function?.arguments || '') + 8
  }
  return n
}

function clonePackedMessage(message: AiContextMessage): AiContextMessage {
  const out: AiContextMessage = { role: message.role, content: message.content || '' }
  if (message.role === 'assistant' && message.reasoningContent?.trim()) {
    out.reasoningContent = message.reasoningContent
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    out.toolCalls = message.toolCalls
  }
  if (message.role === 'tool' && message.toolCallId) {
    out.toolCallId = message.toolCallId
  }
  return out
}

function keepableMessage(message: AiContextMessage): boolean {
  if (message.role === 'user') return Boolean(message.content?.trim())
  if (message.role === 'tool') return Boolean(message.toolCallId)
  if (message.role === 'assistant') {
    return Boolean(
      message.content?.trim() ||
        message.reasoningContent?.trim() ||
        message.toolCalls?.length,
    )
  }
  return false
}

/** User message plus the following assistant / tool messages, so a tool loop is dropped as a unit. */
export function groupConversationTurns(messages: AiContextMessage[]): AiContextMessage[][] {
  const groups: AiContextMessage[][] = []
  let current: AiContextMessage[] = []
  for (const message of messages) {
    if (message.role === 'user' && current.length) {
      groups.push(current)
      current = [clonePackedMessage(message)]
    } else {
      current.push(clonePackedMessage(message))
    }
  }
  if (current.length) groups.push(current)
  return groups
}

function groupTokens(group: AiContextMessage[]): number {
  return group.reduce((sum, message) => sum + messageTokens(message), 0)
}

function fitLatestGroup(
  group: AiContextMessage[],
  room: number,
  maxMessageTokens: number,
): { group: AiContextMessage[]; truncatedCount: number } {
  if (groupTokens(group) <= room) return { group, truncatedCount: 0 }
  const fitted: AiContextMessage[] = []
  let used = 0
  let truncatedCount = 0
  for (const message of group) {
    const tokens = messageTokens(message)
    if (used + tokens <= room) {
      fitted.push(message)
      used += tokens
      continue
    }
    if (fitted.length === 0 && message.role === 'user') {
      const cap = Math.min(maxMessageTokens, Math.max(32, room - 6))
      let content = message.content || ''
      if (estimateTokens(content) > cap) {
        content = truncateToTokenBudget(content, cap)
        truncatedCount += 1
      }
      const next: AiContextMessage = { role: 'user', content }
      fitted.push(next)
      used += messageTokens(next)
    }
    break
  }
  return { group: fitted.length ? fitted : [group[group.length - 1]], truncatedCount }
}

export function formatTokenCount(n: number): string {
  const v = Math.max(0, Math.round(n))
  if (v < 1000) return String(v)
  if (v < 10_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${Math.round(v / 1000)}k`
}

/** Provider-billed tokens for a completed turn (`total`, else prompt + completion). */
export function billedConversationTokens(usage?: AiUsage | null): number {
  if (!usage) return 0
  if (typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens) && usage.totalTokens > 0) {
    return Math.round(usage.totalTokens)
  }
  const prompt = typeof usage.promptTokens === 'number' && Number.isFinite(usage.promptTokens) ? usage.promptTokens : 0
  const completion =
    typeof usage.completionTokens === 'number' && Number.isFinite(usage.completionTokens) ? usage.completionTokens : 0
  const n = prompt + completion
  return n > 0 ? Math.round(n) : 0
}

/** Latest successful assistant usage on the thread (skip errors / in-flight turns without usage). */
export function lastBilledConversationUsage(
  messages: Array<{ role?: string; error?: boolean; usage?: AiUsage | null }>,
): AiUsage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'assistant' || message.error) continue
    if (billedConversationTokens(message.usage) > 0) return message.usage || undefined
  }
  return undefined
}

/**
 * Default context window for a model id.
 * models.dev snapshot first, then an explicit Nk/Nm suffix in the name, else 300000.
 */
export function inferContextWindowTokens(model?: string): number {
  const fromCatalog = lookupModelsDevContext(model)
  if (fromCatalog) return clampWindow(fromCatalog)
  const fromName = inferContextWindowFromName(model)
  if (fromName) return clampWindow(fromName)
  return DEFAULT_CONTEXT_WINDOW_TOKENS
}

function inferContextWindowFromName(model?: string): number | undefined {
  const m = (model || '').toLowerCase()
  const named = m.match(/\b(\d+(?:\.\d+)?)(k|m)\b/)
  if (named) {
    const n = Number(named[1])
    if (!Number.isFinite(n) || n <= 0) return undefined
    const mul = named[2] === 'm' ? 1_000_000 : 1_000
    return Math.round(n * mul)
  }
  if (/\b1048576\b/.test(m)) return 1_048_576
  if (m.includes('gpt-3.5') || m.includes('gpt-35')) return 16_384
  return undefined
}

function clampWindow(n: number): number {
  return Math.max(MIN_CONTEXT_WINDOW_TOKENS, Math.min(MAX_CONTEXT_WINDOW_TOKENS, Math.round(n)))
}

/** Empty / 0 / invalid → auto. Otherwise clamp to a safe token window. */
export function clampContextWindowTokens(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return clampWindow(n)
}

export function resolveContextWindowTokens(model?: string, override?: number | null): number {
  return clampContextWindowTokens(override) ?? inferContextWindowTokens(model)
}

export type AiModelSpec = {
  id: string
  contextWindowTokens?: number
}

export function parseAiModel(raw: unknown): AiModelSpec | null {
  if (typeof raw === 'string') {
    const id = raw.trim()
    return id ? { id } : null
  }
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as { id?: unknown; name?: unknown; contextWindowTokens?: unknown }
  const id =
    typeof rec.id === 'string' && rec.id.trim()
      ? rec.id.trim()
      : typeof rec.name === 'string' && rec.name.trim()
        ? rec.name.trim()
        : ''
  if (!id) return null
  const contextWindowTokens = clampContextWindowTokens(rec.contextWindowTokens)
  return contextWindowTokens ? { id, contextWindowTokens } : { id }
}

export function parseAiModels(raw: unknown): AiModelSpec[] {
  if (!Array.isArray(raw)) return []
  const out: AiModelSpec[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const model = parseAiModel(item)
    if (!model || seen.has(model.id)) continue
    seen.add(model.id)
    out.push(model)
  }
  return out
}

export function firstAiModelId(models: unknown): string {
  return parseAiModels(models)[0]?.id || ''
}

export function aiModelId(raw: unknown): string {
  return parseAiModel(raw)?.id || ''
}

/** Per-model override, then leftover global fallback, then infer from the name. */
export function resolveModelContextWindow(opts: {
  model?: string
  models?: unknown
  fallback?: number | null
}): number {
  const model = (opts.model || '').trim()
  const found = parseAiModels(opts.models).find((m) => m.id === model)
  return resolveContextWindowTokens(model, found?.contextWindowTokens ?? opts.fallback)
}

export function isContextLengthError(message?: string | null): boolean {
  const m = (message || '').toLowerCase()
  if (!m.trim()) return false
  return (
    /context.?length/.test(m) ||
    /maximum context/.test(m) ||
    /too many tokens/.test(m) ||
    /token.?limit/.test(m) ||
    /prompt is too long/.test(m) ||
    /exceeds?\s+(the\s+)?(context|token|maximum)/.test(m) ||
    /range of input length/.test(m) ||
    /max context/.test(m)
  )
}

export function sliceToTokens(text: string, maxTokens: number, fromEnd = false): string {
  if (maxTokens <= 0 || !text) return ''
  if (estimateTokens(text) <= maxTokens) return text
  const chars = [...text]
  if (!fromEnd) {
    let out = ''
    for (const ch of chars) {
      const next = out + ch
      if (estimateTokens(next) > maxTokens) break
      out = next
    }
    return out
  }
  let out = ''
  for (let i = chars.length - 1; i >= 0; i--) {
    const next = chars[i] + out
    if (estimateTokens(next) > maxTokens) break
    out = next
  }
  return out
}

export function truncateToTokenBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return ''
  if (estimateTokens(text) <= maxTokens) return text
  const markerTokens = estimateTokens(TRUNCATE_MARKER)
  const room = Math.max(8, maxTokens - markerTokens)
  const headBudget = Math.max(4, Math.floor(room * 0.7))
  const tailBudget = Math.max(4, room - headBudget)
  const head = sliceToTokens(text, headBudget, false)
  const tail = sliceToTokens(text, tailBudget, true)
  if (!head && !tail) return sliceToTokens(text, maxTokens, false)
  return `${head}${TRUNCATE_MARKER}${tail}`
}

export function packAiMessages(opts: {
  systemPrompt?: string
  messages: AiContextMessage[]
  model?: string
  /** Full model window. Prompt budget = window - reserveOutputTokens. */
  budgetTokens?: number
  /** User override; ignored when budgetTokens is set. 0/empty = infer from model. */
  contextWindowTokens?: number | null
  reserveOutputTokens?: number
  maxMessageTokens?: number
}): AiContextPack {
  const windowTokens = Math.max(
    1024,
    opts.budgetTokens ?? resolveContextWindowTokens(opts.model, opts.contextWindowTokens),
  )
  const reserve = Math.max(0, opts.reserveOutputTokens ?? DEFAULT_OUTPUT_RESERVE_TOKENS)
  const promptBudget = Math.max(512, windowTokens - reserve)
  const maxMessageTokens = Math.max(
    64,
    Math.min(opts.maxMessageTokens ?? DEFAULT_MAX_MESSAGE_TOKENS, Math.floor(promptBudget * 0.75)),
  )

  const systemRaw = (opts.systemPrompt || '').trim()
  const packed: AiContextMessage[] = []
  let used = 0
  let truncatedCount = 0

  if (systemRaw) {
    const sysBudget = Math.min(2_000, Math.floor(promptBudget * 0.25), maxMessageTokens)
    let content = systemRaw
    if (estimateTokens(content) > sysBudget) {
      content = truncateToTokenBudget(content, sysBudget)
      truncatedCount += 1
    }
    const sys: AiContextMessage = { role: 'system', content }
    packed.push(sys)
    used += messageTokens(sys)
  }

  const conv = (opts.messages || []).filter(keepableMessage)
  const groups = groupConversationTurns(conv)
  const keptGroups: AiContextMessage[][] = []
  let droppedCount = 0

  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i]
    const tokens = groupTokens(group)
    if (used + tokens <= promptBudget) {
      keptGroups.push(group)
      used += tokens
      continue
    }
    if (keptGroups.length === 0) {
      const fitted = fitLatestGroup(group, Math.max(32, promptBudget - used), maxMessageTokens)
      keptGroups.push(fitted.group)
      used += groupTokens(fitted.group)
      truncatedCount += fitted.truncatedCount
      droppedCount += groups.slice(0, i).reduce((sum, g) => sum + g.length, 0)
      droppedCount += Math.max(0, group.length - fitted.group.length)
    } else {
      droppedCount += groups.slice(0, i + 1).reduce((sum, g) => sum + g.length, 0)
    }
    break
  }

  keptGroups.reverse()
  return {
    messages: [...packed, ...keptGroups.flat()],
    promptTokens: used,
    budgetTokens: promptBudget,
    droppedCount,
    truncatedCount,
  }
}
