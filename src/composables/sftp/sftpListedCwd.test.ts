import { describe, expect, it } from 'vitest'
import { clearSftpListedCwd, getSftpListedCwd, setSftpListedCwd } from './sftpListedCwd'

describe('sftpListedCwd', () => {
  it('keeps only a successful absolute listing path', () => {
    clearSftpListedCwd('s1')
    setSftpListedCwd('s1', '/home/v5-automation-servers/')
    expect(getSftpListedCwd('s1')).toBe('/home/v5-automation-servers')
    setSftpListedCwd('s1', 'v/v5-automation-servers')
    expect(getSftpListedCwd('s1')).toBe('/home/v5-automation-servers')
    clearSftpListedCwd('s1')
    expect(getSftpListedCwd('s1')).toBe('')
  })
})
