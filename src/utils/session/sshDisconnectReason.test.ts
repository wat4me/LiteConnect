import { describe, expect, it } from 'vitest'
import { sshConnectFailureKey, sshDisconnectDetailKey } from './sshDisconnectReason'

describe('initial connection failures', () => {
  it.each([
    ["Error invoking remote method 'ssh:connect': Error: Connection error: Timed out while waiting for handshake", 'terminal.connectTimeoutHint'],
    ['connect ECONNREFUSED 10.2.5.223:22', 'terminal.connectRefusedHint'],
    ['getaddrinfo ENOTFOUND server.test', 'terminal.connectDnsHint'],
    ['connect EHOSTUNREACH', 'terminal.connectUnreachableHint'],
    ['All configured authentication methods failed', 'terminal.connectAuthHint'],
    ['Authentication prompt timed out', 'terminal.connectPromptTimeoutHint'],
  ])('describes %s', (message, key) => expect(sshConnectFailureKey(message)).toBe(key))
  it('preserves unknown diagnostic messages', () => expect(sshConnectFailureKey('Host key mismatch')).toBeNull())
})

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
