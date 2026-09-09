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
})
