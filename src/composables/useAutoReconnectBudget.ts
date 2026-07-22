/**
 * 按「连接」累计自动重连次数（跨 TerminalTab 重建仍有效）。
 * 达到上限后停止自动重试；手动重连或成功连上后清零。
 */
const attemptsByConnection = new Map<string, number>()

export function noteAutoReconnectAttempt(
  connectionId: string,
  maxRetries: number,
): { ok: boolean; attempt: number } {
  const max = Math.max(0, Math.round(maxRetries))
  if (max <= 0) {
    return { ok: false, attempt: 0 }
  }
  const next = (attemptsByConnection.get(connectionId) || 0) + 1
  if (next > max) {
    return { ok: false, attempt: max }
  }
  attemptsByConnection.set(connectionId, next)
  return { ok: true, attempt: next }
}

export function getAutoReconnectAttempt(connectionId: string): number {
  return attemptsByConnection.get(connectionId) || 0
}

export function clearAutoReconnectAttempts(connectionId: string): void {
  attemptsByConnection.delete(connectionId)
}
