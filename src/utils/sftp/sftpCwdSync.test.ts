import { describe, expect, it } from 'vitest'
import {
  cleanRemotePath,
  planLocateCwd,
  sameRemotePath,
  shouldReloadSftpListing,
  uniqueCleanPaths,
} from './sftpCwdSync'

describe('planLocateCwd', () => {
  it('always probes the live shell; tracker is only a fallback path', () => {
    expect(
      planLocateCwd({
        terminalPath: '/home/u',
        trackerPwd: '/tmp/work',
      }),
    ).toEqual({ tracked: '/tmp/work', useLiveShellPwd: true })
  })

  it('still probes when tracker and sidebar already agree', () => {
    expect(
      planLocateCwd({
        terminalPath: '/home/u',
        trackerPwd: '/home/u/',
      }),
    ).toEqual({ tracked: '/home/u', useLiveShellPwd: true })
  })

  it('probes even when nothing is tracked', () => {
    expect(
      planLocateCwd({
        terminalPath: '',
        trackerPwd: null,
      }),
    ).toEqual({ tracked: '', useLiveShellPwd: true })
  })
})

describe('sameRemotePath', () => {
  it('treats trailing slashes as the same path', () => {
    expect(sameRemotePath('/home/u/', '/home/u')).toBe(true)
    expect(cleanRemotePath('/')).toBe('/')
  })
})

describe('uniqueCleanPaths', () => {
  it('drops SFTP cwd ".", empties, and duplicates; keeps logical shell paths', () => {
    expect(
      uniqueCleanPaths(['/home/u/link', '/home/u/link/', '', '.', null, '/tmp']),
    ).toEqual(['/home/u/link', '/tmp'])
  })
})

describe('shouldReloadSftpListing', () => {
  it('locate always reloads, even when already on the path', () => {
    expect(shouldReloadSftpListing('locate', '/home/u', '/home/u')).toBe(true)
    expect(shouldReloadSftpListing('locate', '/home/u/', '/home/u')).toBe(true)
  })

  it('follow skips reload when already on the logical path', () => {
    expect(shouldReloadSftpListing('follow', '/home/u', '/home/u/')).toBe(false)
    expect(shouldReloadSftpListing('follow', '/home/u/src', '/home/u')).toBe(true)
  })
})
