import { safeStorage } from 'electron'
import { DecryptionError } from '../utils/validation'
import { sealSecret } from '../utils/secretCrypto'
import { t } from '../i18n'

export function settingsEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function encryptSettingsSecret(value: string): string {
  if (!value) return value
  return sealSecret(value, {
    available: settingsEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    unavailableMessage: t('crypto.encryptionUnavailable'),
  }).value
}

export function decryptSettingsSecret(value: string): string {
  if (!value) return value
  if (settingsEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    } catch {
      throw new DecryptionError(t('crypto.apiKeyDecryptFailed'), 'apiKey')
    }
  }
  return value
}

export function decryptSettingsSecretOrEmpty(value: string): string {
  try {
    return decryptSettingsSecret(value)
  } catch {
    return ''
  }
}
