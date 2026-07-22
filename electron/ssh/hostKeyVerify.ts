import type { KnownHostsStore } from './knownHosts'
import type { HostKeyRole } from './types'

export type HostKeyRejectInfo = {
  role: HostKeyRole
  host: string
  port: number
  fingerprint: string
  existingFingerprint: string
  error: string
  keyBuffer: Buffer
  unknown?: boolean
}

export function hostKeyRoleLabel(role: HostKeyRole): string {
  return role === 'jump' ? 'jump host' : 'target host'
}

/**
 * Shared hostVerifier for SSH sessions and DB tunnels.
 * Never auto-accepts unknown or changed keys — caller must confirm + updateHostKey.
 */
export function createHostVerifier(
  knownHosts: KnownHostsStore,
  host: string,
  port: number,
  role: HostKeyRole,
  onReject?: (info: HostKeyRejectInfo) => void,
): (key: Buffer) => boolean {
  const normalizedHost = host.trim()
  const normalizedPort = port || 22
  return (key: Buffer) => {
    const result = knownHosts.verifySync(normalizedHost, normalizedPort, key)
    if (result.accepted) return true
    const existingFingerprint =
      knownHosts.getFingerprint(normalizedHost, normalizedPort) || ''
    const rolePart = hostKeyRoleLabel(role)
    const error =
      result.error ||
      `Host key verification failed for ${rolePart} ${normalizedHost}:${normalizedPort}`
    onReject?.({
      role,
      host: normalizedHost,
      port: normalizedPort,
      fingerprint: result.fingerprint,
      existingFingerprint,
      error: `[${rolePart}] ${error}`,
      keyBuffer: Buffer.from(key),
      unknown: result.unknown,
    })
    return false
  }
}
