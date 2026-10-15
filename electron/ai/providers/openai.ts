import { aiTokenCount, normalizeAiUsage } from '../../../shared/aiUsage'
import { normalizeAiChatMessage, sanitizeAiToolProtocol } from '../../../shared/aiMessages'
import { validateAiRequestImages } from '../../../shared/aiImages'
import type { AiChatMessage, AiUsage } from '../../../shared/types/ai'
import { normalizeAiBaseUrl, readAiStream } from './http'
import { parseProviderModels } from './modelMetadata'
import type { AiProviderAdapter } from './types'
import { t } from '../../i18n'

export function getAiChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeAiBaseUrl(baseUrl)
  if (normalized.endsWith('/chat/completions')) return normalized
  return `${normalized}/chat/completions`
}

export function getAiModelsUrl(baseUrl: string): string {
  return `${normalizeAiBaseUrl(baseUrl).replace(/\/chat\/completions$/, '')}/models`
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
  return normalizeAiUsage({
    promptTokens: usage.prompt_tokens,
    cachedPromptTokens: aiTokenCount(usage.prompt_tokens_details?.cached_tokens) ?? aiTokenCount(usage.prompt_cache_hit_tokens),
    uncachedPromptTokens: usage.prompt_cache_miss_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    reasoningTokens: aiTokenCount(usage.completion_tokens_details?.reasoning_tokens) ?? aiTokenCount(usage.reasoning_tokens),
  })
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

/** Map packed messages onto the Chat Completions wire. CoT is only sent when `tools` is present. */
export function toApiChatMessages(messages: unknown[], withTools: boolean): unknown[] {
  if (!Array.isArray(messages)) return []
  const out: unknown[] = []
  const validMessages = withTools
    ? sanitizeAiToolProtocol(messages)
    : messages.map(normalizeAiChatMessage).filter((message): message is AiChatMessage => message !== null)
  validateAiRequestImages(validMessages)
  for (const m of validMessages) {
    if (m.role === 'tool') {
      if (!withTools) continue
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
      continue
    }
    if (m.role === 'system' || m.role === 'user') {
      if (m.role === 'user' && m.images?.length) {
        const parts: unknown[] = m.content ? [{ type: 'text', text: m.content }] : []
        for (const image of m.images) {
          parts.push({ type: 'image_url', image_url: { url: image.dataUrl, detail: 'auto' } })
        }
        out.push({ role: m.role, content: parts })
      } else out.push({ role: m.role, content: m.content })
      continue
    }
    const hadToolCalls = Boolean(m.toolCalls?.length)
    if (!withTools && hadToolCalls && !m.content.trim()) continue
    const toolCalls = withTools ? m.toolCalls : undefined
    const next: Record<string, unknown> = {
      role: 'assistant',
      content: toolCalls?.length && !m.content.trim() ? null : m.content,
    }
    if (withTools && m.reasoningContent?.trim()) {
      next.reasoning_content = m.reasoningContent
    }
    if (toolCalls?.length) next.tool_calls = toolCalls
    out.push(next)
  }
  return out
}

export const openaiProvider: AiProviderAdapter = {
  supportsStreamUsageOption: true,
  allowsCompletionFallback: true,
  buildRequest(settings, messages, options = {}) {
    const withTools = Boolean(options.tools)
    return {
      url: getAiChatCompletionsUrl(settings.baseUrl),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey.trim()}` },
      body: JSON.stringify({
        model: settings.model,
        temperature: options.temperature ?? settings.temperature ?? 0.7,
        messages: toApiChatMessages(messages, withTools),
        ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
        ...(options.stream !== undefined ? { stream: options.stream } : {}),
        ...(options.stream && options.includeUsage ? { stream_options: { include_usage: true } } : {}),
        ...(withTools ? { tools: options.tools, tool_choice: 'auto' } : {}),
      }),
    }
  },
  parseResponse(_settings, data) {
    const choice = data?.choices?.[0]
    return {
      content: normalizeAiContent(choice?.message?.content ?? choice?.text),
      reasoningContent: extractAiReasoningFromChoice(choice) || getFirstString(data?.reasoning_content, data?.reasoning) || undefined,
      usage: extractAiUsage(data?.usage),
      finishReason: choice?.finish_reason,
    }
  },
  async readStream(_settings, response, onDelta) {
    const message: AiChatMessage = { role: 'assistant', content: '' }
    let finishReason = ''
    const stopped = await readAiStream(response, chunk => {
      const choice = chunk?.choices?.[0]
      const delta = choice?.delta || {}
      if (chunk?.error) throw new Error(chunk.error.message || 'AI stream failed')
      if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason || finishReason
      const content = normalizeAiContent(delta.content ?? choice?.text)
      const reasoning = extractAiReasoningFromChoice(choice)
      message.content += content
      if (reasoning) message.reasoningContent = (message.reasoningContent || '') + reasoning
      onDelta({ content, reasoning, usage: extractAiUsage(chunk?.usage), toolCalls: delta.tool_calls || choice?.message?.tool_calls })
    })
    if (!stopped && !finishReason) throw new Error(t('ai.streamIncomplete'))
    if (finishReason === 'length' || finishReason === 'content_filter') throw new Error(t('ai.responseIncomplete'))
    return message
  },
  modelsRequest(provider) {
    return { url: getAiModelsUrl(provider.baseUrl), headers: { Authorization: `Bearer ${provider.apiKey.trim()}` } }
  },
  parseModelsPage(data) {
    return { models: parseProviderModels(data, ['context_length', 'context_window', 'max_model_len']) }
  },
}
