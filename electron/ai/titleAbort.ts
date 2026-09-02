const titleGenAbortByKey = new Map<string, AbortController>()

export function titleGenAbortKey(sessionId: string, threadId: string): string {
  return `${sessionId}::${threadId}`
}

export function abortTitleGeneration(sessionId: string, threadId?: string): void {
  if (threadId) {
    const key = titleGenAbortKey(sessionId, threadId)
    const c = titleGenAbortByKey.get(key)
    if (c) {
      c.abort()
      titleGenAbortByKey.delete(key)
    }
    return
  }
  for (const [key, c] of titleGenAbortByKey) {
    if (key.startsWith(`${sessionId}::`)) {
      c.abort()
      titleGenAbortByKey.delete(key)
    }
  }
}

export function registerTitleAbort(key: string, controller: AbortController): void {
  titleGenAbortByKey.set(key, controller)
}

export function clearTitleAbort(key: string, controller: AbortController): void {
  if (titleGenAbortByKey.get(key) === controller) {
    titleGenAbortByKey.delete(key)
  }
}
