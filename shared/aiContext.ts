import { lookupModelsDevContext } from './modelsDevContext'

export type AiContextRole = 'system' | 'user' | 'assistant'

export type AiContextMessage = {
  role: AiContextRole
  content: string
}

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
  return estimateTokens(message.content) + 6
}

export function formatTokenCount(n: number): string {
  const v = Math.max(0, Math.round(n))
  if (v < 1000) return String(v)
  if (v < 10_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${Math.round(v / 1000)}k`
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

  const conv = (opts.messages || []).filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim(),
  )

  const kept: AiContextMessage[] = []
  let droppedCount = 0

  for (let i = conv.length - 1; i >= 0; i--) {
    let content = conv[i].content
    if (estimateTokens(content) > maxMessageTokens) {
      content = truncateToTokenBudget(content, maxMessageTokens)
      truncatedCount += 1
    }
    let tokens = estimateTokens(content) + 6
    if (used + tokens > promptBudget) {
      if (kept.length === 0) {
        const room = Math.max(32, promptBudget - used - 6)
        content = truncateToTokenBudget(content, room)
        truncatedCount += 1
        tokens = estimateTokens(content) + 6
        kept.push({ role: conv[i].role, content })
        used += tokens
        droppedCount += i
        break
      }
      droppedCount += i + 1
      break
    }
    kept.push({ role: conv[i].role, content })
    used += tokens
  }

  kept.reverse()
  return {
    messages: [...packed, ...kept],
    promptTokens: used,
    budgetTokens: promptBudget,
    droppedCount,
    truncatedCount,
  }
}
