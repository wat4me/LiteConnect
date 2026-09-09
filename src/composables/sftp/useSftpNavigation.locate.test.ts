import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSftpNavigation } from './useSftpNavigation'
import { clearSftpListedCwd, getSftpListedCwd } from './sftpListedCwd'

describe('useSftpNavigation locate / follow cwd', () => {
  const originalWindow = globalThis.window
  const bus = new EventTarget()
  let sftpReaddir: ReturnType<typeof vi.fn>
  let sftpRealpath: ReturnType<typeof vi.fn>
  let sftpInit: ReturnType<typeof vi.fn>
  let sftpExecHome: ReturnType<typeof vi.fn>
  let setPwd: ReturnType<typeof vi.fn>
  let livePwd = '/home/u'

  function onPwdRequest(e: Event) {
    const detail = (e as CustomEvent).detail as {
      handled?: boolean
      resolve: (pwd: string) => void
    }
    detail.handled = true
    detail.resolve(livePwd)
  }

  beforeEach(() => {
    livePwd = '/home/u'
    sftpInit = vi.fn(async () => {})
    sftpExecHome = vi.fn(async () => '/home/u')
    sftpRealpath = vi.fn(async (_sid: string, p: string) => {
      if (p === '.' || p === '/home/u') return '/home/u'
      if (p === '/home/u/link') return '/mnt/data/u/link'
      return p
    })
    sftpReaddir = vi.fn(async () => [])
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
    return useSftpNavigation(
      () => 'sess-1',
      {
        getPwd: () => '/home/u',
        setPwd,
      } as any,
    )
  }

  it('locate reloads SFTP listing even when already on that directory', async () => {
    const api = nav()
    await api.initSftp()
    const readsAfterInit = sftpReaddir.mock.calls.length
    expect(api.currentPath.value).toBe('/home/u')
    expect(getSftpListedCwd('sess-1')).toBe('/home/u')

    const ok = await api.syncCwdForce()
    expect(ok).toBe(true)
    expect(sftpReaddir.mock.calls.length).toBeGreaterThan(readsAfterInit)
    expect(sftpReaddir).toHaveBeenCalledWith('sess-1', '/home/u')
  })

  it('keeps the shell-logical path in the cd tracker (not SFTP realpath)', async () => {
    livePwd = '/home/u/link'
    sftpReaddir.mockImplementation(async (_sid: string, p: string) => {
      if (p === '/home/u/link' || p === '/home/u' || p === '/mnt/data/u/link') return []
      throw new Error(`unexpected readdir ${p}`)
    })
    const api = nav()
    await api.initSftp()
    const ok = await api.syncCwdForce()
    expect(ok).toBe(true)
    expect(api.terminalPath.value).toBe('/home/u/link')
    expect(setPwd).toHaveBeenCalledWith('sess-1', '/home/u/link')
    expect(setPwd).not.toHaveBeenCalledWith('sess-1', '/mnt/data/u/link')
    expect(sftpReaddir).toHaveBeenCalledWith('sess-1', '/home/u/link')
  })
})
