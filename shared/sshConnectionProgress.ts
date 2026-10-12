export type SshConnectionStage = 'connecting' | 'jump' | 'authenticating' | 'keyboard' | 'host-key' | 'shell' | 'connected' | 'failed' | 'cancelled'
export interface SshConnectionProgress {
  connectionId: string
  stage: SshConnectionStage
}
export const SSH_CONNECTION_CANCELLED = '[SSH_CONNECTION_CANCELLED]'
export const SSH_AUTH_PROMPT_TIMEOUT_MS = 120_000
export const SSH_HANDSHAKE_TIMEOUT_MS = 20_000
export function isSshConnectionCancelled(error: unknown): boolean {
  return String(error instanceof Error ? error.message : error ?? '').includes(SSH_CONNECTION_CANCELLED)
}
