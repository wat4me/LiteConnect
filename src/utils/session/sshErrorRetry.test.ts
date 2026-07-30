import { describe, expect, it } from 'vitest'
import { isNonRetryableSshError } from '@/utils/session/sshErrorRetry'

describe('isNonRetryableSshError', () => {
  it('flags host key failures', () => {
    expect(isNonRetryableSshError('[jump host] Host key mismatch')).toBe(true)
    expect(isNonRetryableSshError('Unknown host key for a:22')).toBe(true)
    expect(isNonRetryableSshError('Connection error: hostkey verification failed')).toBe(true)
  })

  it('flags authentication failures', () => {
    expect(isNonRetryableSshError('All configured authentication methods failed')).toBe(true)
    expect(isNonRetryableSshError('Permission denied (publickey)')).toBe(true)
    expect(isNonRetryableSshError('No more auth methods available')).toBe(true)
  })

  it('allows network drops for auto-reconnect', () => {
    expect(isNonRetryableSshError('read ECONNRESET')).toBe(false)
    expect(isNonRetryableSshError('Connection closed')).toBe(false)
    expect(isNonRetryableSshError('Timed out while waiting for handshake')).toBe(false)
  })

  it('handles empty input', () => {
    expect(isNonRetryableSshError('')).toBe(false)
    expect(isNonRetryableSshError(null)).toBe(false)
    expect(isNonRetryableSshError(undefined)).toBe(false)
  })
})
