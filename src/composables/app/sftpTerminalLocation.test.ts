import { afterEach, expect, it, vi } from 'vitest'
import { useSftpNavigation } from '@/composables/sftp/useSftpNavigation'
import { useTerminalPwd } from '@/composables/terminal/useTerminalPwd'
import { clearSftpListedCwd } from '@/utils/sftp/sftpListedCwd'

const sessionId = 'sftp-location'

afterEach(() => {
  clearSftpListedCwd(sessionId)
  vi.unstubAllGlobals()
})

it('locates /home after consecutive failed cd commands with follow turned off', async () => {
  const project = '/home/v5-automation-servers'
  const existing = new Set(['/root', '/home', project])
  const isDirectory = vi.fn(async (_sessionId: string, path: string) => existing.has(path))
  const readdir = vi.fn(async (_sessionId: string, path: string) => {
    if (!existing.has(path)) throw new Error(`No such file: ${path}`)
    return []
  })
  const dispatchEvent = vi.fn()
  vi.stubGlobal('window', { dispatchEvent, LiteConnect: {
    sftpInit: async () => {}, sftpExecHome: async () => '/root',
    sftpRealpath: async () => '/root', sftpReaddir: readdir,
  } })

  const tracker = useTerminalPwd({ isDirectory })
  tracker.initSession(sessionId, '/root')
  const sftp = useSftpNavigation(() => sessionId, tracker)
  await sftp.initSftp()
  await tracker.handleCd(sessionId, `cd ${project}`)
  await sftp.locateTerminalCwd()
  await sftp.toggleFollowTerminalPath()
  expect(sftp.currentPath.value).toBe(project)
  readdir.mockClear()
  isDirectory.mockClear()

  void tracker.handleCd(sessionId, 'cd ..')
  void tracker.handleCd(sessionId, 'cd tab')
  void tracker.handleCd(sessionId, 'cd bcdd')
  await expect(sftp.locateTerminalCwd()).resolves.toBe(true)
  expect(sftp.currentPath.value).toBe('/home')
  expect(isDirectory.mock.calls.map(([, path]) => path)).toEqual(['/home', '/home/tab', '/home/bcdd'])
  expect(readdir).toHaveBeenCalledExactlyOnceWith(sessionId, '/home')
  expect(dispatchEvent).not.toHaveBeenCalled()
})
