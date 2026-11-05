import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSftpNavigation } from './useSftpNavigation'
import { clearSftpListedCwd, getSftpListedCwd } from '@/utils/sftp/sftpListedCwd'
import type { TerminalPwdTracker } from '@/domain/terminal/types'

describe('useSftpNavigation locate / follow cwd', () => {
  const originalWindow = globalThis.window
  const bus = new EventTarget()
  let sftpReaddir: ReturnType<typeof vi.fn>
  let sftpRealpath: ReturnType<typeof vi.fn>
  let sftpInit: ReturnType<typeof vi.fn>
  let sftpExecHome: ReturnType<typeof vi.fn>
  let trackedPwd = '/home/u'
  let setPwd: ReturnType<typeof vi.fn>
  let livePwd = '/home/u'
  let queryCount = 0

  function onPwdRequest(e: Event) {
    queryCount++
    const detail = (e as CustomEvent).detail as {
      handled?: boolean
      resolve: (pwd: string) => void
    }
    detail.handled = true
    detail.resolve(livePwd)
  }

  beforeEach(() => {
    livePwd = '/home/u'
    queryCount = 0
    sftpInit = vi.fn(async () => {})
    sftpExecHome = vi.fn(async () => '/home/u')
    sftpRealpath = vi.fn(async (_sid: string, p: string) => {
      if (p === '.' || p === '/home/u') return '/home/u'
      if (p === '/home/u/link') return '/mnt/data/u/link'
      return p
    })
    sftpReaddir = vi.fn(async () => [])
    trackedPwd = '/home/u'
    setPwd = vi.fn()
    bus.addEventListener('request-terminal-pwd', onPwdRequest)
    globalThis.window = {
      LiteConnect: { sftpInit, sftpExecHome, sftpRealpath, sftpReaddir },
      addEventListener: bus.addEventListener.bind(bus),
      removeEventListener: bus.removeEventListener.bind(bus),
      dispatchEvent: bus.dispatchEvent.bind(bus),
    } as unknown as Window & typeof globalThis
  })

  afterEach(() => {
    bus.removeEventListener('request-terminal-pwd', onPwdRequest)
    globalThis.window = originalWindow
    clearSftpListedCwd('sess-1')
  })

  function nav() {
    return useSftpNavigation(() => 'sess-1', {
      getPwd: () => trackedPwd,
      waitForPendingCd: async () => {},
      setPwd,
    } as unknown as TerminalPwdTracker)
  }

  it('locate reloads SFTP listing even when already on that directory', async () => {
    const api = nav()
    await api.initSftp()
    const readsAfterInit = sftpReaddir.mock.calls.length
    expect(api.currentPath.value).toBe('/home/u')
    expect(getSftpListedCwd('sess-1')).toBe('/home/u')

    const ok = await api.locateTerminalCwd()
    expect(ok).toBe(true)
    expect(queryCount).toBe(0)
    expect(sftpReaddir.mock.calls.length).toBeGreaterThan(readsAfterInit)
    expect(sftpReaddir).toHaveBeenCalledWith('sess-1', '/home/u')
  })

  it('uses a shell report and keeps its logical path when SFTP needs the resolved path', async () => {
    trackedPwd = '/home/u/link'
    sftpReaddir.mockImplementation(async (_sid: string, p: string) => {
      if (p === '/home/u' || p === '/mnt/data/u/link') return []
      throw new Error(`unexpected readdir ${p}`)
    })
    const api = nav()
    await api.initSftp()
    const ok = await api.locateTerminalCwd()
    expect(ok).toBe(true)
    expect(queryCount).toBe(0)
    expect(api.terminalPath.value).toBe('/home/u/link')
    expect(setPwd).not.toHaveBeenCalled()
    expect(api.currentPath.value).toBe('/mnt/data/u/link')
  })

  it('queries the shell only when the explicit query is requested', async () => {
    livePwd = '/home/u/actual'
    const api = nav()
    await api.initSftp()
    expect(await api.queryTerminalCwd()).toBe(true)
    expect(queryCount).toBe(1)
    expect(api.currentPath.value).toBe('/home/u/actual')
  })
})
