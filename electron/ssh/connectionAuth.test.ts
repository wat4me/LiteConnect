import { describe, expect, it, vi } from 'vitest'
import { resolveSshKeepalive } from './keepalive'
import { jumpConnectConfig, targetConnectConfig } from './connectionAuth'
import type { Connection } from './types'
import type { KnownHostsStore } from './trust/knownHosts'

describe('SSH connect configuration', () => {
  it('keeps target and jump credentials and host verification separate', () => {
    const connection = {
      host: 'target.example', port: 2222, username: 'target-user', password: 'target-secret',
      jumpHost: 'jump.example', jumpPort: 2200, jumpUsername: 'jump-user', jumpPassword: 'jump-secret',
    } as Connection
    const knownHosts = {
      verifySync: vi.fn(() => ({ accepted: false, fingerprint: 'new' })),
      getFingerprint: vi.fn(() => ''),
    } as unknown as KnownHostsStore
    const rejected = vi.fn()
    const keepalive = resolveSshKeepalive(0)
    const target = targetConnectConfig(connection, knownHosts, keepalive, rejected)
    const jump = jumpConnectConfig(connection, knownHosts, keepalive, rejected)

    expect(target).toMatchObject({ host: 'target.example', port: 2222, username: 'target-user', password: 'target-secret' })
    expect(jump).toMatchObject({ host: 'jump.example', port: 2200, username: 'jump-user', password: 'jump-secret' })
    expect(target.hostVerifier?.(Buffer.from('key'))).toBe(false)
    expect(jump.hostVerifier?.(Buffer.from('key'))).toBe(false)
    expect(rejected.mock.calls.map(([info]) => info.role)).toEqual(['target', 'jump'])
  })
})
