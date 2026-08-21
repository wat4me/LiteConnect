export const ENCRYPTION_UNAVAILABLE_CODE = 'ENCRYPTION_UNAVAILABLE'

export class EncryptionUnavailableError extends Error {
  readonly code = ENCRYPTION_UNAVAILABLE_CODE

  constructor(message: string) {
    super(message)
    this.name = 'EncryptionUnavailableError'
  }

  static is(err: unknown): err is EncryptionUnavailableError {
    return (
      err instanceof EncryptionUnavailableError
      || (err instanceof Error && (err as { code?: string }).code === ENCRYPTION_UNAVAILABLE_CODE)
    )
  }
}

export type EncryptedSecret = {
  value: string
  encrypted: boolean
}

/**
 * Encrypt a secret for disk. Empty values stay empty.
 * Never persists a non-empty secret as plaintext.
 */
export function sealSecret(
  value: string,
  opts: {
    available: boolean
    encrypt: (plain: string) => string
    unavailableMessage: string
  },
): EncryptedSecret {
  if (!value) return { value: '', encrypted: false }
  if (!opts.available) {
    throw new EncryptionUnavailableError(opts.unavailableMessage)
  }
  return { value: opts.encrypt(value), encrypted: true }
}
