export type ChatTimelineTurn = {
  id: string
  preview: string
  index: number
}

export const TIMELINE_NEARBY_RADIUS = 2
export const TIMELINE_FLYOUT_ROW_PX = 48
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

export function timelineTickRatio(index: number, count: number): number {
  if (count <= 1) return 0.5
  if (index <= 0) return 0
  if (index >= count - 1) return 1
  return index / (count - 1)
}

export function nearestTimelineIndex(count: number, y: number, trackHeight: number): number {
  if (count <= 0) return 0
  if (count === 1 || trackHeight <= 0) return 0
  const t = Math.min(1, Math.max(0, y / trackHeight))
  return Math.round(t * (count - 1))
}

export function nearbyTimelineIndices(
  center: number,
  count: number,
  radius = TIMELINE_NEARBY_RADIUS,
): number[] {
  if (count <= 0) return []
  const i = Math.min(count - 1, Math.max(0, center))
  const start = Math.max(0, i - radius)
  const end = Math.min(count - 1, i + radius)
  const out: number[] = []
  for (let n = start; n <= end; n++) out.push(n)
  return out
}

export function clampTimelineFlyoutTop(
  preferredTop: number,
  flyoutHeight: number,
  trackHeight: number,
): number {
  const max = Math.max(0, trackHeight - Math.max(0, flyoutHeight))
  return Math.min(max, Math.max(0, preferredTop))
}

export function timelineFlyoutTop(opts: {
  tickRatio: number
  trackHeight: number
  flyoutHeight: number
  hoveredLocalIndex: number
  rowHeight?: number
}): number {
  const row = opts.rowHeight ?? TIMELINE_FLYOUT_ROW_PX
  const tickY = opts.tickRatio * opts.trackHeight
  const preferred = tickY - opts.hoveredLocalIndex * row - row / 2
  return clampTimelineFlyoutTop(preferred, opts.flyoutHeight, opts.trackHeight)
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
