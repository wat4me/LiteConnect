import { describe, expect, it } from 'vitest'
import { sshDisconnectDetailKey } from './sshDisconnectReason'

describe('sshDisconnectDetailKey', () => {
  it('maps keepalive / timeout / reset / close', () => {
    expect(sshDisconnectDetailKey('Keepalive timeout')).toBe(
      'terminal.disconnectedDetailUnresponsive',
    )
    expect(sshDisconnectDetailKey('Timed out while waiting for handshake')).toBe(
      'terminal.disconnectedDetailTimeout',
    )
    expect(sshDisconnectDetailKey('read ECONNRESET')).toBe('terminal.disconnectedDetailReset')
    expect(sshDisconnectDetailKey('Connection closed')).toBe('terminal.disconnectedDetailClosed')
    expect(sshDisconnectDetailKey('Connection lost')).toBe('terminal.disconnectedDetailClosed')
  })

  it('leaves auth / host-key / empty as unknown', () => {
    expect(sshDisconnectDetailKey('Host key mismatch')).toBeNull()
    expect(sshDisconnectDetailKey('All configured authentication methods failed')).toBeNull()
    expect(sshDisconnectDetailKey('')).toBeNull()
    expect(sshDisconnectDetailKey(undefined)).toBeNull()
  })
})
