export interface HostKeyMismatchData {
  connectionId: string
  host: string
  port: number
  existingFingerprint: string
  newFingerprint: string
  /** jump = bastion, target = destination host */
  role?: 'target' | 'jump'
}

export interface DecryptionFailedData {
  connectionId: string
  field: 'password' | 'privateKey' | 'apiKey'
  message: string
}
