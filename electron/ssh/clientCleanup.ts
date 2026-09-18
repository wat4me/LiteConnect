import type { Client, ClientChannel } from 'ssh2'

/**
 * Dispose an ssh2 client without leaving a late `error` event unhandled.
 *
 * ssh2 owns a handshake timer. That timer can already be queued when an outer
 * timeout tears the client down, so removing every listener and then destroying
 * the client creates a small window where Node treats the late error as an
 * uncaught exception. Remove application callbacks, but keep an error sink for
 * the remainder of the client's lifetime.
 */
export function disposeSshClient(client: Client | undefined): void {
  if (!client) return

  try {
    client.removeAllListeners()
    client.on('error', () => {})
  } catch {}

  try {
    client.end()
  } catch {}

  try {
    client.destroy()
  } catch {}
}

/** Apply the same late-error guard when closing an SSH shell/channel. */
export function disposeSshChannel(channel: ClientChannel | undefined): void {
  if (!channel) return

  try {
    channel.removeAllListeners()
    channel.on('error', () => {})
  } catch {}

  try {
    channel.close()
  } catch {}
}
