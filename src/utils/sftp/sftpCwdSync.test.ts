import { describe, expect, it } from 'vitest'
import {
  cleanRemotePath,
  sameRemotePath,
  shouldReloadSftpListing,
} from './sftpCwdSync'

describe('sameRemotePath', () => {
  it('treats trailing slashes as the same path', () => {
    expect(sameRemotePath('/home/u/', '/home/u')).toBe(true)
    expect(cleanRemotePath('/')).toBe('/')
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
