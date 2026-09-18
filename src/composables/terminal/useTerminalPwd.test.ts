import { describe, expect, it } from 'vitest'
import { useTerminalPwd } from './useTerminalPwd'

describe('useTerminalPwd relative cd', () => {
  it('cd .. follows the logical tracker path, not a previously realpath-ed physical path', () => {
    const pwd = useTerminalPwd()
    pwd.initSession('s1', '/home/u', '/home/u/link')
    expect(pwd.handleCd('s1', 'cd ..')).toBe('/home/u')
  })

  it('would drift after locate if tracker were overwritten with realpath', () => {
    const pwd = useTerminalPwd()
    pwd.initSession('s1', '/home/u', '/home/u/link')
    // What locate used to do: write SFTP realpath into the tracker.
    pwd.setPwd('s1', '/mnt/data/u/link')
    expect(pwd.handleCd('s1', 'cd ..')).toBe('/mnt/data/u')
  })

  it('does not invent /v/... when relative cd runs before home is known', () => {
    const pwd = useTerminalPwd()
    pwd.initSession('s1', '', '')
    expect(pwd.getPwd('s1')).toBe(null)
    expect(pwd.handleCd('s1', 'cd v')).toBe(null)
    expect(pwd.getPwd('s1')).toBe(null)
    pwd.initSession('s1', '/root')
    // Queued relative `cd v` is dropped — it never ran against a known base.
    expect(pwd.getPwd('s1')).toBe('/root')
    pwd.handleCd('s1', 'cd /home/')
    pwd.handleCd('s1', 'cd v')
    pwd.handleCd('s1', 'cd v5-automation-servers/')
    expect(pwd.getPwd('s1')).toBe('/home/v/v5-automation-servers')
    expect(pwd.revertCd('s1')).toBe('/home/v')
    expect(pwd.revertCd('s1')).toBe('/home')
  })
})
