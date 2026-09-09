import { MCP_AI_RESULT_MAX_CHARS, MCP_AI_RESULT_MAX_LINES } from './limits'

export const AI_TOOL_TRUNCATION_NOTICE = [
  '[截断] 工具输出过长，LiteConnect 已截断，没有把全文交给你。',
  '不要用 cat / head / tail / sed 继续灌文件。',
  '请用 grep 精确定位，或 read_file(startLine, limit) 分段读取。',
].join(' ')

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

function clampStructured(raw: unknown): { value: unknown; truncated: boolean } {
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
    next.notice = AI_TOOL_TRUNCATION_NOTICE
  }
  return { value: next, truncated }
}

type ToolResultLike = {
  isError: boolean
  content: string
  structuredContent?: unknown
}

/** Shrink a tool result before the model sees it. */
export function clampToolResultForModel(result: ToolResultLike): ToolResultLike {
  const structured = clampStructured(result.structuredContent)
  let content = result.content || ''
  let truncated = structured.truncated

  if (structured.truncated && asRecord(structured.value)) {
    content = JSON.stringify(structured.value, null, 2)
  }

  const body = clampTextWindow(content)
  content = body.text
  truncated = truncated || body.truncated

  if (!truncated) return result
  if (!content.includes('[截断]')) {
    content = `${content.replace(/\s+$/, '')}\n\n${AI_TOOL_TRUNCATION_NOTICE}`
  }
  return {
    isError: result.isError,
    content,
    structuredContent: structured.value,
  }
}
