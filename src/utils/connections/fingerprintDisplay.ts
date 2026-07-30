/** Parse and format SSH host-key fingerprints for non-technical UI. */

export type FingerprintParts = {
  /** e.g. SHA256 */
  algorithm: string
  /** Raw body without algorithm prefix */
  body: string
  /** Full original string */
  full: string
}

export function parseFingerprint(fp: string | null | undefined): FingerprintParts {
  const full = (fp || '').trim()
  if (!full) {
    return { algorithm: 'SHA256', body: '', full: '' }
  }
  const m = full.match(/^(SHA256|MD5|SHA1)\s*:\s*(.+)$/i)
  if (m) {
    return {
      algorithm: m[1].toUpperCase(),
      body: m[2].trim(),
      full,
    }
  }
  return { algorithm: 'SHA256', body: full, full }
}

/**
 * Split fingerprint body into short groups for large-print verification.
 * SHA256 base64 is not hex; group by 4 characters for eye scanning.
 */
export function groupFingerprintBody(body: string, groupSize = 4): string[] {
  const cleaned = body.replace(/\s+/g, '')
  if (!cleaned) return []
  const groups: string[] = []
  for (let i = 0; i < cleaned.length; i += groupSize) {
    groups.push(cleaned.slice(i, i + groupSize))
  }
  return groups
}

export function formatFingerprintForCopy(fp: string | null | undefined): string {
  const parts = parseFingerprint(fp)
  if (!parts.body) return ''
  return `${parts.algorithm}:${parts.body}`
}
