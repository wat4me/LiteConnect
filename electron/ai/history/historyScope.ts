/**
 * Stable persistence identity for AI conversations. Runtime SSH session ids are
 * intentionally excluded so reconnecting to the same endpoint restores history.
 */
export function aiHistoryIdForHost(host: string, port = 22): string {
  let normalizedHost = host.trim().toLowerCase()
  if (normalizedHost.startsWith('[') && normalizedHost.endsWith(']')) {
    normalizedHost = normalizedHost.slice(1, -1)
  }
  if (normalizedHost.endsWith('.')) normalizedHost = normalizedHost.slice(0, -1)
  if (!normalizedHost) throw new Error('Invalid SSH host for AI history')

  const normalizedPort = Number.isInteger(port) && port > 0 && port <= 65535 ? port : 22
  return `host-v1:${normalizedPort}:${normalizedHost}`
}
