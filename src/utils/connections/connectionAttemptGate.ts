export function createConnectionAttemptGate<T>() {
  const inFlight = new Map<string, Promise<T>>()

  function run(
    connectionId: string,
    start: () => Promise<T>,
    onPendingChange?: (connectionId: string, pending: boolean) => void,
  ): Promise<T> {
    const existing = inFlight.get(connectionId)
    if (existing) return existing

    onPendingChange?.(connectionId, true)
    const attempt = Promise.resolve()
      .then(start)
      .finally(() => {
        if (inFlight.get(connectionId) !== attempt) return
        inFlight.delete(connectionId)
        onPendingChange?.(connectionId, false)
      })
    inFlight.set(connectionId, attempt)
    return attempt
  }

  return {
    run,
    isPending: (connectionId: string) => inFlight.has(connectionId),
  }
}
