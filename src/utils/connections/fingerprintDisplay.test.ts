import { describe, expect, it } from 'vitest'
import {
  formatFingerprintForCopy,
  groupFingerprintBody,
  parseFingerprint,
} from './fingerprintDisplay'

describe('fingerprintDisplay', () => {
  it('parses SHA256 fingerprints', () => {
    const p = parseFingerprint('SHA256:AbCdEfGhIjKlMnOp')
    expect(p.algorithm).toBe('SHA256')
    expect(p.body).toBe('AbCdEfGhIjKlMnOp')
  })

  it('groups body for large print', () => {
    expect(groupFingerprintBody('abcdefghijkl', 4)).toEqual(['abcd', 'efgh', 'ijkl'])
  })

  it('formats for clipboard', () => {
    expect(formatFingerprintForCopy('SHA256:xyz')).toBe('SHA256:xyz')
  })
})
