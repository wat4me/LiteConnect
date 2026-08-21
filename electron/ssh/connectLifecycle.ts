/**
 * ssh2 often emits `close` without `error` (OpenSSH BY_APPLICATION disconnect,
 * banner-then-drop, etc.). Handshake must reject; a live session must notify.
 */
export type ClientCloseOutcome = 'notify-close' | 'reject-handshake' | 'ignore'

export function clientCloseOutcome(opts: {
  hasSession: boolean
  settled: boolean
}): ClientCloseOutcome {
  if (opts.hasSession) return 'notify-close'
  if (!opts.settled) return 'reject-handshake'
  return 'ignore'
}
