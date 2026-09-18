/** SSH-level keepalive used both to prevent idle drops and to detect a dead peer. */
export const SSH_KEEPALIVE_MIN_MS = 5_000
export const SSH_KEEPALIVE_DETECT_MAX_MS = 10_000
export const SSH_KEEPALIVE_DEFAULT_MS = 10_000
export const SSH_KEEPALIVE_COUNT_MAX = 3

export type SshKeepaliveOptions = {
  keepaliveInterval: number
  keepaliveCountMax: number
}

/**
 * Cap the interval so a silent peer is declared dead within ~30s
 * (3 unanswered keepalives), even if the saved profile uses 30s+.
 */
export function resolveSshKeepalive(intervalMs?: number): SshKeepaliveOptions {
  const raw =
    typeof intervalMs === 'number' && Number.isFinite(intervalMs) && intervalMs > 0
      ? intervalMs
      : SSH_KEEPALIVE_DEFAULT_MS
  const keepaliveInterval = Math.min(
    Math.max(Math.round(raw), SSH_KEEPALIVE_MIN_MS),
    SSH_KEEPALIVE_DETECT_MAX_MS,
  )
  return { keepaliveInterval, keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX }
}

export function applySocketKeepalive(client: object, initialDelayMs: number): void {
  try {
    const sock = (client as { _sock?: { setKeepAlive?: (enable: boolean, initialDelay: number) => void } })
      ._sock
    sock?.setKeepAlive?.(true, initialDelayMs)
  } catch {
    // ssh2 does not expose the socket; ignore if the private field moves
  }
}
