import type { AiChatMessage, AiFunctionToolCall } from './types/ai'

export const AI_MESSAGE_CONTENT_MAX = 200_000
export const AI_TURN_API_MESSAGES_MAX = 40

export function normalizeToolCalls(raw: unknown): AiFunctionToolCall[] {
  if (!Array.isArray(raw)) return []
  const out: AiFunctionToolCall[] = []
  for (const item of raw.slice(0, 32)) {
    if (!item || typeof item !== 'object') continue
    const rec = item as {
      id?: unknown
      type?: unknown
      function?: { name?: unknown; arguments?: unknown }
    }
    const name = typeof rec.function?.name === 'string' ? rec.function.name.slice(0, 64) : ''
    if (!name) continue
    const id = typeof rec.id === 'string' && rec.id ? rec.id.slice(0, 128) : `call_${out.length}`
    const args = typeof rec.function?.arguments === 'string' ? rec.function.arguments : '{}'
    out.push({
      id,
      type: 'function',
      function: { name, arguments: args.slice(0, AI_MESSAGE_CONTENT_MAX) },
    })
  }
  return out
}

export function normalizeAiChatMessage(raw: unknown): AiChatMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const role = m.role
  if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') return null

  const rawContent = m.content
  let content = ''
  if (typeof rawContent === 'string') content = rawContent.slice(0, AI_MESSAGE_CONTENT_MAX)
  else if (rawContent !== null && rawContent !== undefined) return null

  if (role === 'tool') {
    const toolCallId =
      typeof m.toolCallId === 'string'
        ? m.toolCallId
        : typeof m.tool_call_id === 'string'
          ? m.tool_call_id
          : ''
    if (!toolCallId.trim()) return null
    return { role: 'tool', content, toolCallId: toolCallId.slice(0, 128) }
  }

  if (role === 'user' || role === 'system') {
    if (!content.trim()) return null
    return { role, content }
  }

  const toolCalls = normalizeToolCalls(m.toolCalls ?? m.tool_calls)
  const reasoningRaw =
    typeof m.reasoningContent === 'string'
      ? m.reasoningContent
      : typeof m.reasoning_content === 'string'
        ? m.reasoning_content
        : ''
  const reasoning = reasoningRaw.slice(0, AI_MESSAGE_CONTENT_MAX)
  if (!content.trim() && !reasoning.trim() && !toolCalls.length) return null
  const out: AiChatMessage = { role: 'assistant', content }
  if (reasoning.trim()) out.reasoningContent = reasoning
  if (toolCalls.length) out.toolCalls = toolCalls
  return out
}

export function validateAiMessages(messages: unknown): AiChatMessage[] {
  if (!Array.isArray(messages)) throw new Error('Invalid AI messages')
  return messages.map((message) => {
    const next = normalizeAiChatMessage(message)
    if (!next) throw new Error('Invalid AI message')
    return next
  })
}

/** Map packed messages onto the Chat Completions wire. CoT is only sent when `tools` is present. */
export function toApiChatMessages(messages: unknown[], withTools: boolean): unknown[] {
  if (!Array.isArray(messages)) return []
  const out: unknown[] = []
  for (const raw of messages) {
    const m = normalizeAiChatMessage(raw)
    if (!m) continue
    if (m.role === 'tool') {
      if (!withTools) continue
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
      continue
    }
    if (m.role === 'system' || m.role === 'user') {
      out.push({ role: m.role, content: m.content })
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

export function flattenConversationForApi(
  items: Array<{
    role: string
    content?: string | null
    error?: boolean
    streaming?: boolean
    reasoningContent?: string
    apiMessages?: AiChatMessage[]
  }>,
): AiChatMessage[] {
  const out: AiChatMessage[] = []
  for (const item of items) {
    if (item.error || item.streaming) continue
    if (item.role === 'user') {
      const content = typeof item.content === 'string' ? item.content : ''
      if (!content.trim()) continue
      out.push({ role: 'user', content })
      continue
    }
    if (item.role !== 'assistant') continue
    if (Array.isArray(item.apiMessages) && item.apiMessages.length) {
      for (const msg of item.apiMessages.slice(0, AI_TURN_API_MESSAGES_MAX)) {
        const next = normalizeAiChatMessage(msg)
        if (next) out.push(next)
      }
      continue
    }
    const content = typeof item.content === 'string' ? item.content : ''
    const reasoning = typeof item.reasoningContent === 'string' ? item.reasoningContent : ''
    if (!content.trim() && !reasoning.trim()) continue
    const row: AiChatMessage = { role: 'assistant', content }
    if (reasoning.trim()) row.reasoningContent = reasoning
    out.push(row)
  }
  return out
}

/** After a tool loop, append the final assistant text if it is not already on the transcript. */
export function appendFinalAssistantTurn(
  generated: AiChatMessage[],
  lastRound: { content: string; reasoningContent?: string },
): AiChatMessage[] {
  const last = generated[generated.length - 1]
  const hasFinalAssistant = last?.role === 'assistant' && !last.toolCalls?.length
  if (hasFinalAssistant) return generated
  const content = lastRound.content || ''
  const reasoning = lastRound.reasoningContent || ''
  if (!content.trim() && !reasoning.trim()) return generated
  const row: AiChatMessage = { role: 'assistant', content }
  if (reasoning.trim()) row.reasoningContent = reasoning
  return [...generated, row]
}
