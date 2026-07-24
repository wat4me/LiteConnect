/**
 * SSH reconnect policy for Docker workspace list loads.
 * Reconnect must only re-probe; list load is owned by the "Docker available" watcher
 * so one reconnect cannot produce a double list request.
 */
export function onDockerSshReconnected(actions: {
  probe: () => void | Promise<void>
  refreshList?: () => void
}): void {
  void actions.probe()
  // Do NOT call refreshList here — availability key change triggers a single load.
}

/**
 * Load list when availability key becomes a non-null "session:available" token.
 * Key change (including reconnect → available again) loads once per key value.
 */
export function onDockerAvailabilityKeyChange(
  key: string | null,
  prevKey: string | null | undefined,
  loadList: () => void,
): void {
  if (!key) return
  if (key === prevKey) return
  loadList()
}

/**
 * Simulate reconnect orchestration for tests:
 * events in order; returns how many times list would load.
 */
export function countListLoadsForReconnect(events: Array<'reconnect' | 'available'>): number {
  let loads = 0
  let availableKey: string | null = null
  const loadList = () => {
    loads += 1
  }
  for (const e of events) {
    if (e === 'reconnect') {
      onDockerSshReconnected({
        probe: () => {
          /* probe only */
        },
        refreshList: () => {
          loads += 1
        },
      })
      // After reconnect, available is not yet known; key cleared until probe returns
      availableKey = null
    } else {
      const prev = availableKey
      const next = 'sess:available'
      onDockerAvailabilityKeyChange(next, prev, loadList)
      availableKey = next
    }
  }
  return loads
}
