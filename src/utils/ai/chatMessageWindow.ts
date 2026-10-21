export const CHAT_TURNS_PER_PAGE = 5

/** A user message starts a turn; its replies and tool segments stay together. */
export function chatTurnStarts(messages: readonly { id: string; role: string }[]): Array<{ id: string; index: number }> {
  return messages.flatMap((message, index) => index === 0 || message.role === 'user' ? [{ id: message.id, index }] : [])
}
