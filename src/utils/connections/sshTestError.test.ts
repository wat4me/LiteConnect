import { describe, expect, it } from 'vitest'
import { sshTestErrorKey } from './sshTestError'

describe('sshTestErrorKey', () => {
  it('wraps handshake timeout details', () => {
    expect(sshTestErrorKey('Timed out while waiting for handshake', 'ssh_handshake')).toBe(
      'connections.testErrorHandshakeTimeout',
    )
  })

  it('distinguishes common network failures', () => {
    expect(sshTestErrorKey('connect ETIMEDOUT', 'tcp')).toBe('connections.testErrorTcpTimeout')
    expect(sshTestErrorKey('connect ECONNREFUSED', 'tcp')).toBe('connections.testErrorRefused')
    expect(sshTestErrorKey('getaddrinfo ENOTFOUND host', 'tcp')).toBe('connections.testErrorDns')
    expect(sshTestErrorKey('connect EHOSTUNREACH', 'tcp')).toBe(
      'connections.testErrorUnreachable',
    )
  })

  it('uses the failure stage for authentication, jump host, and shell failures', () => {
    expect(sshTestErrorKey('anything', 'auth')).toBe('connections.testErrorAuth')
    expect(sshTestErrorKey('anything', 'jump')).toBe('connections.testErrorJump')
    expect(sshTestErrorKey('anything', 'shell')).toBe('connections.testErrorShell')
    expect(sshTestErrorKey('unexpected', 'ssh_handshake')).toBeNull()
  })
})
