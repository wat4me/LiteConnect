import { describe, expect, it } from 'vitest'
import {
  detectArchiveKind,
  joinRemote,
  nextRemoteName,
  remoteBasename,
  remoteDirname,
} from './filePaths'

describe('joinRemote / path helpers', () => {
  it('joins remote paths', () => {
    expect(joinRemote('/', 'a')).toBe('/a')
    expect(joinRemote('/home', 'u')).toBe('/home/u')
    expect(joinRemote('/home/', 'u')).toBe('/home/u')
  })

  it('remoteBasename / dirname', () => {
    expect(remoteBasename('/var/log/app.tar.gz')).toBe('app.tar.gz')
    expect(remoteDirname('/var/log/app.tar.gz')).toBe('/var/log')
    expect(remoteDirname('/file')).toBe('/')
  })
})

describe('nextRemoteName', () => {
  it('returns original when free', () => {
    expect(nextRemoteName(new Set(['a.txt']), 'b.txt')).toBe('b.txt')
  })

  it('appends counter when taken', () => {
    const names = new Set(['a.txt', 'a (1).txt'])
    expect(nextRemoteName(names, 'a.txt')).toBe('a (2).txt')
  })
})

describe('detectArchiveKind', () => {
  it('detects common archives', () => {
    expect(detectArchiveKind('x.tar.gz')).toBe('targz')
    expect(detectArchiveKind('x.tgz')).toBe('targz')
    expect(detectArchiveKind('x.zip')).toBe('zip')
    expect(detectArchiveKind('x.tar')).toBe('tar')
    expect(detectArchiveKind('x.7z')).toBe('7z')
    expect(detectArchiveKind('readme.md')).toBe(null)
  })
})
