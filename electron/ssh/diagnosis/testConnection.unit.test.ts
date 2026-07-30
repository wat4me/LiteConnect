import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => 'D:\\tmp\\LiteConnect-test-userdata' },
}))

import { classifyAuthError, type SshTestConnectionResult, type SshTestStage } from './testConnection'
import { classifyDiagnosisClientError } from './diagnosis'

describe('testConnection stage classification', () => {
  it('maps auth failures', () => {
    expect(classifyAuthError('All configured authentication methods failed')).toBe('auth')
    expect(classifyAuthError('Permission denied')).toBe('auth')
  })

  it('maps host key failures', () => {
    expect(classifyAuthError('Host key verification failed')).toBe('host_key')
  })

  it('defaults other SSH errors to handshake', () => {
    expect(classifyAuthError('Timed out while waiting for handshake')).toBe('ssh_handshake')
  })

  it('reports target credential failures as authentication failures in connection diagnostics', () => {
    expect(
      classifyDiagnosisClientError('All configured authentication methods failed', 'ssh_handshake'),
    ).toBe('auth')
    expect(classifyDiagnosisClientError('Connection reset', 'ssh_handshake')).toBe('ssh_handshake')
    expect(classifyDiagnosisClientError('Permission denied', 'jump')).toBe('jump')
  })

  it('result shape documents stages used by UI', () => {
    const stages: SshTestStage[] = [
      'tcp',
      'ssh_handshake',
      'host_key',
      'auth',
      'jump',
      'shell',
    ]
    const sample: SshTestConnectionResult = {
      ok: false,
      stage: 'host_key',
      error: 'x',
      latency: 12,
    }
    expect(stages).toContain(sample.stage!)
  })
})
