/**
 * 按连接与终端累计重试次数（跨 TerminalTab 重建仍有效）；省略终端时兼容旧调用。
 * 达到上限后停止自动重试；手动重连或成功连上后清零。
 */
const attemptsByConnection = new Map<string, number>()
const sessionKeys = new Map<string, Set<string>>()
function budgetKey(connectionId: string, sessionId?: string): string {
  if (!sessionId) return connectionId
  const key = JSON.stringify([connectionId, sessionId])
  const keys = sessionKeys.get(connectionId) || new Set<string>()
  keys.add(key)
  sessionKeys.set(connectionId, keys)
  return key
}
export function autoReconnectDelayMs(attempt: number, random = Math.random()): number {
  const base = Math.min(1000 * Math.pow(2, Math.max(0, attempt - 1)), 15000)
  return Math.min(15000, Math.round(base * (1 + Math.max(0, Math.min(1, random)) * 0.25)))
}

export function noteAutoReconnectAttempt(
  connectionId: string,
  maxRetries: number,
  sessionId?: string,
): { ok: boolean; attempt: number } {
  const max = Math.max(0, Math.round(maxRetries))
  if (max <= 0) {
    return { ok: false, attempt: 0 }
  }
  const key = budgetKey(connectionId, sessionId)
  const next = (attemptsByConnection.get(key) || 0) + 1
  if (next > max) {
    return { ok: false, attempt: max }
  }
  attemptsByConnection.set(key, next)
  return { ok: true, attempt: next }
}

export function getAutoReconnectAttempt(connectionId: string, sessionId?: string): number {
  return attemptsByConnection.get(budgetKey(connectionId, sessionId)) || 0
}

export function clearAutoReconnectAttempts(connectionId: string, sessionId?: string): void {
  if (sessionId) {
    const key = JSON.stringify([connectionId, sessionId])
    attemptsByConnection.delete(key)
    sessionKeys.get(connectionId)?.delete(key)
    if (!sessionKeys.get(connectionId)?.size) sessionKeys.delete(connectionId)
    return
  }
  attemptsByConnection.delete(connectionId)
  for (const key of sessionKeys.get(connectionId) || []) attemptsByConnection.delete(key)
  sessionKeys.delete(connectionId)
}
