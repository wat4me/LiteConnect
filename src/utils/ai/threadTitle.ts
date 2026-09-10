/**
 * Conversation titles are the user's own first message — verbatim.
 *
 * The model no longer rewrites titles: a generated summary hid what the user
 * actually asked, and the provisional fallback (raw first message) was what
 * people ended up reading anyway. Truncation is purely a display concern —
 * the sidebar clips with CSS ellipsis and the tooltip carries the full text.
 */
export const AI_THREAD_TITLE_MAX = 200

type TitleSourceMessage = { role?: string; content?: string } | null | undefined

/** First non-empty user message, flattened to one line and capped for storage. */
export function threadTitleFromMessages(messages: readonly TitleSourceMessage[]): string {
  for (const message of messages) {
    if (!message || message.role !== 'user') continue
    const text = String(message.content || '').trim()
    if (!text) continue
    return text.replace(/\s+/g, ' ').slice(0, AI_THREAD_TITLE_MAX)
  }
  return ''
}

/** Tooltip copy: the stored title plus an ellipsis when it hit the storage cap. */
export function threadTitleTooltip(title: string | null | undefined): string {
  const text = String(title || '').trim()
  if (!text) return ''
  return text.length >= AI_THREAD_TITLE_MAX ? `${text}…` : text
}
