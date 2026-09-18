export type ChatTimelineTurn = {
  id: string
  preview: string
  index: number
}

export const TIMELINE_PREVIEW_MAX = 56

export function previewChatTurn(content: string, maxLen = TIMELINE_PREVIEW_MAX): string {
  const text = String(content || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  if (text.length <= maxLen) return text
  return `${text.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`
}

export function collectChatTimelineTurns(
  messages: Array<{ id: string; role: string; content: string }>,
): ChatTimelineTurn[] {
  const turns: ChatTimelineTurn[] = []
  for (const message of messages) {
    if (message.role !== 'user') continue
    const preview = previewChatTurn(message.content)
    if (!preview) continue
    turns.push({ id: message.id, preview, index: turns.length })
  }
  return turns
}

/** Last user turn whose top has reached the viewport (with a small lead). */
export function activeTimelineTurnId(
  turns: Array<{ id: string; top: number }>,
  scrollTop: number,
  leadPx = 32,
): string {
  if (!turns.length) return ''
  let active = turns[0].id
  const threshold = scrollTop + leadPx
  for (const turn of turns) {
    if (turn.top <= threshold) active = turn.id
    else break
  }
  return active
}
