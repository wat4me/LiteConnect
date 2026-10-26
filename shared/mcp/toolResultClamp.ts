import { sharedT, type SharedTranslate } from '../i18n'
import { MCP_AI_RESULT_MAX_CHARS, MCP_AI_RESULT_MAX_LINES } from './limits'

export const AI_TOOL_TRUNCATION_NOTICE = sharedT('sharedText.promptTruncation')

export function clampTextWindow(
  text: string,
  maxChars = MCP_AI_RESULT_MAX_CHARS,
  maxLines = MCP_AI_RESULT_MAX_LINES,
): { text: string; truncated: boolean } {
  if (!text) return { text, truncated: false }
  const lines = text.split('\n')
  let next = text
  let truncated = false
  if (lines.length > maxLines) {
    next = lines.slice(0, maxLines).join('\n')
    truncated = true
  }
  if (next.length > maxChars) {
    next = next.slice(0, maxChars)
    truncated = true
  }
  return { text: next, truncated }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function clampStructured(raw: unknown, translate: SharedTranslate): { value: unknown; truncated: boolean } {
  const rec = asRecord(raw)
  if (!rec) return { value: raw, truncated: false }
  let truncated = rec.truncated === true
  const next: Record<string, unknown> = { ...rec }

  if (typeof rec.stdout === 'string') {
    const cap = clampTextWindow(rec.stdout)
    next.stdout = cap.text
    truncated = truncated || cap.truncated
  }
  if (typeof rec.stderr === 'string') {
    const cap = clampTextWindow(rec.stderr, Math.floor(MCP_AI_RESULT_MAX_CHARS / 4), 80)
    next.stderr = cap.text
    truncated = truncated || cap.truncated
  }
  if (typeof rec.content === 'string') {
    const cap = clampTextWindow(rec.content)
    next.content = cap.text
    truncated = truncated || cap.truncated
  }

  if (truncated) {
    next.truncated = true
    next.notice = translate('sharedText.promptTruncation')
  }
  return { value: next, truncated }
}

type ToolResultLike = {
  isError: boolean
  content: string
  structuredContent?: unknown
}

/** Shrink a tool result before the model sees it. */
export function clampToolResultForModel(result: ToolResultLike, translate: SharedTranslate = sharedT): ToolResultLike {
  const structured = clampStructured(result.structuredContent, translate)
  let content = result.content || ''
  let truncated = structured.truncated

  if (structured.truncated && asRecord(structured.value)) {
    content = JSON.stringify(structured.value, null, 2)
  }

  const body = clampTextWindow(content)
  content = body.text
  truncated = truncated || body.truncated

  if (!truncated) return result
  const notice = translate('sharedText.promptTruncation')
  if (!content.includes(notice) && !content.includes(AI_TOOL_TRUNCATION_NOTICE)) {
    content = `${content.replace(/\s+$/, '')}\n\n${notice}`
  }
  return {
    isError: result.isError,
    content,
    structuredContent: structured.value,
  }
}
