import { normalizeAnthropicContent } from '../../../shared/anthropicContent'
import { sanitizeAiToolProtocol } from '../../../shared/aiMessages'
import { validateAiRequestImages } from '../../../shared/aiImages'
import { aiTokenCount, normalizeAiUsage } from '../../../shared/aiUsage'
import { DEFAULT_OUTPUT_RESERVE_TOKENS } from '../../../shared/aiContext'
import type { AiAnthropicContentBlock, AiChatMessage, AiResolvedConfig, AiUsage } from '../../../shared/types/ai'
import { normalizeAiBaseUrl, readAiStream } from './http'
import { parseProviderModels } from './modelMetadata'
import type { AiProviderAdapter, AiProviderDelta } from './types'

export function getAnthropicMessagesUrl(baseUrl: string): string {
  const url = normalizeAiBaseUrl(baseUrl)
  if (url.endsWith('/messages')) return url
  return `${url}${new URL(url).pathname === '/' ? '/v1' : ''}/messages`
}

function anthropicHeaders(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-api-key': apiKey.trim(), 'anthropic-version': '2023-06-01' }
}

function toAnthropicMessages(messages: AiChatMessage[], withTools: boolean) {
  const wire: { role: 'user' | 'assistant'; content: Record<string, unknown>[] }[] = []
  const validMessages = sanitizeAiToolProtocol(messages)
  validateAiRequestImages(validMessages)
  for (const message of validMessages) {
    if (message.role === 'system') continue
    const role: 'user' | 'assistant' = message.role === 'assistant' ? 'assistant' : 'user'
    let content: Record<string, unknown>[] = []
    if (message.role === 'tool') {
      if (!withTools) continue
      content = [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }]
    } else if (message.role === 'assistant') {
      if (message.anthropicContent?.length && (withTools || !message.toolCalls?.length)) content = normalizeAnthropicContent(message.anthropicContent)!
      else {
        if (message.content) content.push({ type: 'text', text: message.content })
        if (withTools) for (const call of message.toolCalls || []) {
          const input = JSON.parse(call.function.arguments)
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid Claude tool input')
          content.push({ type: 'tool_use', id: call.id, name: call.function.name, input })
        }
      }
    } else {
      if (message.content) content.push({ type: 'text', text: message.content })
      for (const image of message.images || []) {
        const data = image.dataUrl!.slice(image.dataUrl!.indexOf(',') + 1)
        content.push({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data } })
      }
    }
    if (!content.length) continue
    const previous = wire.at(-1)
    if (previous?.role === role) previous.content.push(...content)
    else wire.push({ role, content })
  }
  return wire
}

export function extractAnthropicUsage(raw: any): AiUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const input = aiTokenCount(raw.input_tokens)
  const cached = aiTokenCount(raw.cache_read_input_tokens)
  const creation = aiTokenCount(raw.cache_creation_input_tokens)
  return normalizeAiUsage({
    promptTokens: input === undefined ? undefined : input + (cached ?? 0) + (creation ?? 0),
    cachedPromptTokens: cached,
    uncachedPromptTokens: input !== undefined && creation !== undefined ? input + creation : undefined,
    cacheCreationPromptTokens: creation,
    ...(cached === undefined || creation === undefined ? { cacheUsageIncomplete: true } : {}),
    completionTokens: raw.output_tokens,
    reasoningTokens: raw.output_tokens_details?.thinking_tokens,
  })
}

function parseAnthropicResponse(data: any) {
  if (data?.type === 'error') throw new Error(data.error?.message || 'Claude request failed')
  const blocks = normalizeAnthropicContent(data?.content) || []
  const content = blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
  const reasoningContent = blocks.flatMap(block => block.type === 'thinking' ? [block.thinking] : []).join('') || undefined
  return {
    content, reasoningContent, usage: extractAnthropicUsage(data?.usage), finishReason: data?.stop_reason,
    apiMessages: [{ role: 'assistant' as const, content, reasoningContent, anthropicContent: blocks }],
  }
}

async function readAnthropicStream(_settings: AiResolvedConfig, response: Response, onDelta: (delta: AiProviderDelta) => void): Promise<AiChatMessage> {
  const blocks = new Map<number, AiAnthropicContentBlock>()
  const inputs = new Map<number, string>()
  const openBlocks = new Set<number>()
  let usage: Record<string, unknown> = {}
  let started = false
  let stopped = false
  let finishReason = ''
  await readAiStream(response, event => {
    if (event?.type === 'error') throw new Error(event.error?.message || 'Claude stream failed')
    if (event?.type === 'message_start') {
      started = true
      usage = { ...event.message?.usage }
      onDelta({ usage: extractAnthropicUsage(usage) })
    } else if (event?.type === 'message_delta') {
      usage = { ...usage, ...event.usage }
      finishReason = event.delta?.stop_reason || finishReason
      onDelta({ usage: extractAnthropicUsage(usage) })
    } else if (event?.type === 'message_stop') stopped = true
    else if (event?.type === 'content_block_start') {
      const block = normalizeAnthropicContent([event.content_block])![0]
      if (!Number.isSafeInteger(event.index) || event.index < 0 || blocks.has(event.index)) throw new Error('Invalid Claude stream block index')
      blocks.set(event.index, block)
      openBlocks.add(event.index)
      if (block.type === 'text') onDelta({ content: block.text })
      if (block.type === 'thinking') onDelta({ reasoning: block.thinking })
      if (block.type === 'tool_use') onDelta({ toolCalls: [{ index: event.index, id: block.id, function: { name: block.name, arguments: '' } }] })
    } else if (event?.type === 'content_block_delta') {
      const block = blocks.get(event.index)
      if (!block || !openBlocks.has(event.index)) throw new Error('Invalid Claude stream block delta')
      const delta = event.delta
      if (block.type === 'text' && delta?.type === 'text_delta') { block.text += delta.text; onDelta({ content: delta.text }) }
      if (block.type === 'thinking' && delta?.type === 'thinking_delta') { block.thinking += delta.thinking; onDelta({ reasoning: delta.thinking }) }
      if (block.type === 'thinking' && delta?.type === 'signature_delta') block.signature += delta.signature
      if (block.type === 'tool_use' && delta?.type === 'input_json_delta') inputs.set(event.index, (inputs.get(event.index) || '') + delta.partial_json)
    } else if (event?.type === 'content_block_stop') {
      const block = blocks.get(event.index)
      if (!block || !openBlocks.delete(event.index)) throw new Error('Invalid Claude stream block stop')
      if (block.type === 'tool_use') {
        const json = inputs.get(event.index)
        if (json !== undefined) block.input = JSON.parse(json)
        if (!block.input || typeof block.input !== 'object' || Array.isArray(block.input)) throw new Error('Invalid Claude tool input')
        onDelta({ toolCalls: [{ index: event.index, function: { arguments: JSON.stringify(block.input) } }] })
      }
    }
  }, true)
  if (!started || !stopped || openBlocks.size) throw new Error('Claude stream ended before completion')
  if (finishReason === 'max_tokens' && [...blocks.values()].some(block => block.type === 'tool_use')) throw new Error('Claude tool response reached its output limit; retry the request')
  return parseAnthropicResponse({ content: [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block) }).apiMessages[0]
}

export const anthropicProvider: AiProviderAdapter = {
  supportsStreamUsageOption: false,
  allowsCompletionFallback: false,
  buildRequest(settings, messages, options = {}) {
    const withTools = Boolean(options.tools)
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
    return {
      url: getAnthropicMessagesUrl(settings.baseUrl),
      headers: anthropicHeaders(settings.apiKey),
      body: JSON.stringify({
        model: settings.model,
        max_tokens: options.maxTokens ?? DEFAULT_OUTPUT_RESERVE_TOKENS,
        stream: options.stream === true,
        messages: toAnthropicMessages(messages, withTools),
        ...(system ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] } : {}),
        ...(withTools ? {
          tools: options.tools!.map(tool => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters })),
          tool_choice: { type: 'auto' },
        } : {}),
      }),
    }
  },
  parseResponse: (_settings, data) => parseAnthropicResponse(data),
  readStream: readAnthropicStream,
  modelsRequest(provider, cursor) {
    const url = new URL(getAnthropicMessagesUrl(provider.baseUrl).replace(/\/messages$/, '/models'))
    if (cursor) url.searchParams.set('after_id', cursor)
    const headers = anthropicHeaders(provider.apiKey)
    delete headers['Content-Type']
    return { url: url.toString(), headers }
  },
  parseModelsPage(data) {
    const models = parseProviderModels(data, ['max_input_tokens', 'context_length', 'context_window', 'max_model_len'])
    if (data.has_more === true) {
      if (typeof data.last_id !== 'string' || !data.last_id) throw new Error('Invalid Claude model pagination')
      return { models, nextCursor: data.last_id }
    }
    return { models }
  },
}
