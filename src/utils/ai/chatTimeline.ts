export type ChatTimelineTurn = {
  id: string
  preview: string
  index: number
}

export const TIMELINE_PREVIEW_MAX = 56
export const TIMELINE_OVERVIEW_MAX = 12

/** Evenly spaced overview, always retaining both ends and the active user turn. */
export function overviewChatTimelineTurns(turns: ChatTimelineTurn[], activeId: string, capacity = TIMELINE_OVERVIEW_MAX): ChatTimelineTurn[] {
  const limit = Math.max(3, Math.min(TIMELINE_OVERVIEW_MAX, Math.floor(capacity) || 3))
  if (turns.length <= limit) return turns
  const indices = Array.from({ length: limit }, (_, index) => Math.round(index * (turns.length - 1) / (limit - 1)))
  const activeIndex = turns.findIndex(turn => turn.id === activeId)
  if (activeIndex > 0 && activeIndex < turns.length - 1 && !indices.includes(activeIndex)) {
    let closest = 1
    for (let index = 2; index < indices.length - 1; index++) {
      if (Math.abs(indices[index] - activeIndex) < Math.abs(indices[closest] - activeIndex)) closest = index
    }
    indices[closest] = activeIndex
  }
  return indices.sort((a, b) => a - b).map(index => turns[index])
}

export function previewChatTurn(content: string, maxLen = TIMELINE_PREVIEW_MAX): string {
  const text = String(content || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  if (text.length <= maxLen) return text
  return `${text.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`
}

export function collectChatTimelineTurns(
  messages: Array<{ id: string; role: string; content: string; images?: Array<{ name: string }> }>,
): ChatTimelineTurn[] {
  const turns: ChatTimelineTurn[] = []
  for (const message of messages) {
    if (message.role !== 'user') continue
    const preview = previewChatTurn(message.content || message.images?.map(image => image.name).join('、') || '')
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
