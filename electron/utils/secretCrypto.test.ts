import { describe, expect, it } from 'vitest'
import { EncryptionUnavailableError, sealSecret } from './secretCrypto'

describe('sealSecret', () => {
  it('keeps empty values unencrypted', () => {
    expect(
      sealSecret('', {
        available: false,
        encrypt: () => 'nope',
        unavailableMessage: 'no enc',
      }),
    ).toEqual({ value: '', encrypted: false })
  })

  it('encrypts when available', () => {
    expect(
      sealSecret('secret', {
        available: true,
        encrypt: (v) => `enc:${v}`,
        unavailableMessage: 'no enc',
      }),
    ).toEqual({ value: 'enc:secret', encrypted: true })
  })

  it('refuses plaintext when encryption is unavailable', () => {
    expect(() =>
      sealSecret('secret', {
        available: false,
        encrypt: (v) => v,
        unavailableMessage: 'no enc',
      }),
    ).toThrow(EncryptionUnavailableError)
  })
})
