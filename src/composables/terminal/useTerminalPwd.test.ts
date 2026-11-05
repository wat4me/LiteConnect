import { describe, expect, it } from 'vitest'
import { useTerminalPwd } from './useTerminalPwd'

const createTracker = () => useTerminalPwd({ isDirectory: async () => true })

describe('useTerminalPwd relative cd', () => {
  it('keeps a report received before initialization and ignores later cd guesses', async () => {
    const pwd = createTracker()
    await pwd.handleCd('s1', 'cd ~/queued')
    pwd.reportPwd('s1', '/home/u/actual')
    pwd.initSession('s1', '/home/u')
    await pwd.handleCd('s1', 'cd /home/u/guess')
    expect(pwd.getPwd('s1')).toBe('/home/u/actual')
    pwd.reportPwd('s1', '/home/u/next')
    expect(pwd.getPwd('s1')).toBe('/home/u/next')
    pwd.removeSession('s1')
    pwd.initSession('s1', '/home/u')
    await expect(pwd.handleCd('s1', 'cd fallback')).resolves.toBe('/home/u/fallback')
  })

  it('discards a directory check that finishes after a shell report', async () => {
    let finishCheck!: (exists: boolean) => void
    const isDirectory = () => new Promise<boolean>(resolve => { finishCheck = resolve })
    const pwd = useTerminalPwd({ isDirectory })
    pwd.initSession('s1', '/home/u')
    const checking = pwd.handleCd('s1', 'cd guess')
    await Promise.resolve()
    pwd.reportPwd('s1', '/home/u/actual')
    finishCheck(true)
    await expect(checking).resolves.toBe('/home/u/actual')
  })

  it('cd .. follows the logical tracker path, not a previously realpath-ed physical path', async () => {
    const pwd = createTracker()
    pwd.initSession('s1', '/home/u', '/home/u/link')
    await expect(pwd.handleCd('s1', 'cd ..')).resolves.toBe('/home/u')
  })

  it('would drift after locate if tracker were overwritten with realpath', async () => {
    const pwd = createTracker()
    pwd.initSession('s1', '/home/u', '/home/u/link')
    // What locate used to do: write SFTP realpath into the tracker.
    pwd.setPwd('s1', '/mnt/data/u/link')
    await expect(pwd.handleCd('s1', 'cd ..')).resolves.toBe('/mnt/data/u')
  })

  it('does not invent /v/... when relative cd runs before home is known', async () => {
    const pwd = createTracker()
    pwd.initSession('s1', '', '')
    expect(pwd.getPwd('s1')).toBe(null)
    await expect(pwd.handleCd('s1', 'cd v')).resolves.toBeNull()
    expect(pwd.getPwd('s1')).toBe(null)
    pwd.initSession('s1', '/root')
    // Queued relative `cd v` is dropped — it never ran against a known base.
    expect(pwd.getPwd('s1')).toBe('/root')
    await pwd.handleCd('s1', 'cd /home/')
    await pwd.handleCd('s1', 'cd v')
    await pwd.handleCd('s1', 'cd v5-automation-servers/')
    expect(pwd.getPwd('s1')).toBe('/home/v/v5-automation-servers')
    await expect(pwd.handleCd('s1', 'cd -')).resolves.toBe('/home/v')
    await expect(pwd.handleCd('s1', 'cd ..')).resolves.toBe('/home')
  })
})
