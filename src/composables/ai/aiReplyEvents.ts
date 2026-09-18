const listeners = new Set<(sessionId: string) => void>()

/** Subscribe to AI reply completion without pulling in the chat composable. */
export function onAiReplyComplete(cb: (sessionId: string) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function notifyAiReplyComplete(sessionId: string): void {
  for (const listener of listeners) {
    try {
      listener(sessionId)
    } catch (err) {
      console.warn('[AI] reply complete listener error:', err)
    }
  }
}
