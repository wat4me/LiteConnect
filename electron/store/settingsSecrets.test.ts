import { describe, expect, it, vi } from 'vitest'
import { EncryptionUnavailableError } from '../utils/secretCrypto'

const safeStorageState = vi.hoisted(() => ({ available: true }))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => safeStorageState.available,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`),
    decryptString: (value: Buffer) => {
      const text = value.toString()
      if (!text.startsWith('sealed:')) throw new Error('bad ciphertext')
      return text.slice('sealed:'.length)
    },
  },
}))

import { decryptSettingsSecret, decryptSettingsSecretOrEmpty, encryptSettingsSecret } from './settingsSecrets'

describe('settings secrets', () => {
  it('round trips a stored API key and handles corrupt ciphertext without exposing it', () => {
    safeStorageState.available = true
    const ciphertext = encryptSettingsSecret('secret')
    expect(ciphertext).not.toContain('secret')
    expect(decryptSettingsSecret(ciphertext)).toBe('secret')
    expect(decryptSettingsSecretOrEmpty('not-ciphertext')).toBe('')
  })

  it('refuses to persist plaintext when encryption is unavailable', () => {
    safeStorageState.available = false
    expect(() => encryptSettingsSecret('secret')).toThrow(EncryptionUnavailableError)
    expect(encryptSettingsSecret('')).toBe('')
    safeStorageState.available = true
  })
})
