import type { AiAnthropicContentBlock } from './types/ai'

/** Opaque signatures must survive IPC and storage exactly, never be truncated. */
export function normalizeAnthropicContent(raw: unknown): AiAnthropicContentBlock[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined
  const json = JSON.stringify(raw)
  if (json.length > 2_000_000 || raw.length > 256) throw new Error('Claude message content exceeds the history limit')
  const blocks = JSON.parse(json) as AiAnthropicContentBlock[]
  for (const block of blocks) {
    if (!block || typeof block !== 'object') throw new Error('Invalid Claude content block')
    const valid = (block.type === 'text' && typeof block.text === 'string')
      || (block.type === 'thinking' && typeof block.thinking === 'string' && typeof block.signature === 'string')
      || (block.type === 'redacted_thinking' && typeof block.data === 'string')
      || (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string'
        && block.input !== null && typeof block.input === 'object' && !Array.isArray(block.input))
    if (!valid) throw new Error('Unsupported Claude content block')
  }
  return blocks
}
