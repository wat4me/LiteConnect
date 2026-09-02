import {
  clampContextWindowTokens,
  packAiMessages,
  parseAiModels,
  type AiContextMessage,
} from '../../shared/aiContext'
import { sanitizeAiToolPermission } from '../../shared/aiToolPolicy'
import type { AiChatMessage, AiUsage } from '../../shared/types/ai'
import { t } from '../i18n'

export type { AiChatMessage }

export function normalizeAiBaseUrl(baseUrl: string): string {
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

export function getAiChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeAiBaseUrl(baseUrl)
  if (normalized.endsWith('/chat/completions')) return normalized
  return `${normalized}/chat/completions`
}

export async function testAiProviderConfig(provider: any): Promise<void> {
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

export function clampTemperature(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isNaN(n)) return 0.7
  return Math.max(0, Math.min(2, Math.round(n * 100) / 100))
}

export function validateAiSettings(settings: any): {
  providers: any[]
  activeProviderId: string | null
  activeModel: string
  systemPrompt: string
  temperature: number
  contextWindowTokens?: number
  toolPermission: ReturnType<typeof sanitizeAiToolPermission>
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
    toolPermission: sanitizeAiToolPermission(settings.toolPermission),
  }
}

export function validateAiMessages(messages: any): AiChatMessage[] {
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
      content: message.content.slice(0, 200_000),
    }
  })
}

export function packRequestMessages(
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

export async function readHttpErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json()
    return data?.error?.message || data?.message || fallback
  } catch {
    return fallback
  }
}

export function getFirstString(...values: any[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

export function normalizeAiContent(content: any): string {
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

export function extractAiUsage(usage: any): AiUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const result: AiUsage = {
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

export function extractAiReasoningFromMessage(message: any): string {
  return getFirstString(
    message?.reasoning_content,
    message?.reasoning,
    message?.thinking,
  )
}

export function extractAiReasoningFromChoice(choice: any): string {
  return getFirstString(
    extractAiReasoningFromMessage(choice?.delta),
    extractAiReasoningFromMessage(choice?.message),
    choice?.reasoning_content,
    choice?.reasoning,
    choice?.thinking,
  )
}

export async function readAiStream(response: Response, onEvent: (event: any) => void): Promise<void> {
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

/** Clean model output into a short history title. Never throws. */
export function sanitizeGeneratedTitle(raw: string): string {
  let s = String(raw || '').trim()
  if (!s) return ''

  s = s.replace(/^```[\w]*\s*/g, '').replace(/```$/g, '').trim()
  s = s.replace(/^(标题|Title|会话标题|主题)\s*[:：]\s*/i, '')
  s = s.replace(/^#+\s+/, '')
  s = s.replace(/^\*\*(.+)\*\*$/s, '$1').trim()
  s = s.replace(/^["'`「『《【\[]+|["'`」』》】\]]+$/g, '').trim()

  const line =
    s
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !/^[\s\-—–·.•|:/\\]+$/.test(l)) || ''
  s = line.replace(/\s+/g, ' ').trim()
  if (s.length > 40) s = s.slice(0, 40).trim()

  if (!s || s === '新对话' || /^new\s*chat$/i.test(s)) return ''
  if (s.length < 2) return ''
  return s
}

/** Pull any usable string from a chat completion choice for title purposes. */
export function extractTitleCandidateFromChoice(choice: any, data: any): string {
  const message = choice?.message || {}
  const fromContent = normalizeAiContent(message.content ?? choice?.text)
  if (fromContent.trim()) return fromContent

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
