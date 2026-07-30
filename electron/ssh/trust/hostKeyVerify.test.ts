import { describe, expect, it, vi } from 'vitest'
import { createHostVerifier, hostKeyRoleLabel } from './hostKeyVerify'
import type { KnownHostsStore } from './knownHosts'

function mockKnownHosts(opts: {
  accepted?: boolean
  fingerprint?: string
  existing?: string
  unknown?: boolean
  error?: string
}): KnownHostsStore {
  return {
    verifySync: vi.fn(() => ({
      accepted: opts.accepted ?? false,
      fingerprint: opts.fingerprint || 'SHA256:new',
      unknown: opts.unknown,
      error: opts.error,
    })),
    getFingerprint: vi.fn(() => opts.existing),
  } as unknown as KnownHostsStore
}

describe('hostKeyVerify', () => {
  it('labels jump vs target', () => {
    expect(hostKeyRoleLabel('jump')).toBe('jump host')
    expect(hostKeyRoleLabel('target')).toBe('target host')
  })

  it('accepts when knownHosts accepts', () => {
    const kh = mockKnownHosts({ accepted: true, fingerprint: 'SHA256:ok' })
    const onReject = vi.fn()
    const verifier = createHostVerifier(kh, 'example.com', 22, 'target', onReject)
    expect(verifier(Buffer.from('key-bytes'))).toBe(true)
    expect(onReject).not.toHaveBeenCalled()
  })

  it('rejects unknown key and reports jump role', () => {
    const kh = mockKnownHosts({
      accepted: false,
      unknown: true,
      fingerprint: 'SHA256:abc',
      error: 'Unknown host key',
    })
    const onReject = vi.fn()
    const verifier = createHostVerifier(kh, 'bastion.local', 2222, 'jump', onReject)
    const key = Buffer.from('jump-key')
    expect(verifier(key)).toBe(false)
    expect(onReject).toHaveBeenCalledTimes(1)
    const info = onReject.mock.calls[0][0]
    expect(info.role).toBe('jump')
    expect(info.host).toBe('bastion.local')
    expect(info.port).toBe(2222)
    expect(info.fingerprint).toBe('SHA256:abc')
    expect(info.unknown).toBe(true)
    expect(info.error).toContain('jump host')
    expect(Buffer.isBuffer(info.keyBuffer)).toBe(true)
  })

  it('rejects changed key with existing fingerprint', () => {
    const kh = mockKnownHosts({
      accepted: false,
      fingerprint: 'SHA256:new',
      existing: 'SHA256:old',
      error: 'Host key mismatch',
    })
    const onReject = vi.fn()
    const verifier = createHostVerifier(kh, '10.0.0.1', 22, 'target', onReject)
    expect(verifier(Buffer.from('x'))).toBe(false)
    const info = onReject.mock.calls[0][0]
    expect(info.existingFingerprint).toBe('SHA256:old')
    expect(info.fingerprint).toBe('SHA256:new')
    expect(info.role).toBe('target')
  })
})
