import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  claimLocalName,
  detectArchiveKind,
  fallbackRemoteName,
  joinRemote,
  nextRemoteName,
  remoteBasename,
  remoteDirname,
  resolveLocalConflictPath,
  sanitizeLocalName,
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

describe('claimLocalName', () => {
  it('numbers duplicates, folding case when asked', () => {
    const used = new Set<string>()
    expect(claimLocalName(used, 'a.txt', true)).toBe('a.txt')
    expect(claimLocalName(used, 'A.txt', true)).toBe('A (1).txt')
    expect(claimLocalName(used, 'a.txt', true)).toBe('a (2).txt')
    const exact = new Set<string>()
    expect(claimLocalName(exact, 'a.txt', false)).toBe('a.txt')
    expect(claimLocalName(exact, 'A.txt', false)).toBe('A.txt')
  })
})

describe('fallbackRemoteName', () => {
  it('keeps the extension and never returns the original name', () => {
    expect(fallbackRemoteName('report.tar.gz', 1000)).toBe('report.tar (rs).gz')
    expect(fallbackRemoteName('Makefile', 1000)).toBe('Makefile (rs)')
  })
})

describe('sanitizeLocalName', () => {
  it('rewrites characters Windows cannot store and NTFS stream separators', () => {
    expect(sanitizeLocalName('a:b.txt', 'win32')).toBe('a_b.txt')
    expect(sanitizeLocalName('what?.log', 'win32')).toBe('what_.log')
    expect(sanitizeLocalName('..\\..\\escape.txt', 'win32')).toBe('.._.._escape.txt')
    expect(sanitizeLocalName('a<b>c|d"e*f', 'win32')).toBe('a_b_c_d_e_f')
  })

  it('handles trailing dots / spaces and reserved device names on Windows', () => {
    expect(sanitizeLocalName('report. ', 'win32')).toBe('report')
    expect(sanitizeLocalName('con', 'win32')).toBe('_con')
    expect(sanitizeLocalName('NUL.txt', 'win32')).toBe('_NUL.txt')
    expect(sanitizeLocalName('...', 'win32')).toBe('_')
  })

  it('leaves names untouched on other platforms', () => {
    expect(sanitizeLocalName('a:b.txt', 'linux')).toBe('a:b.txt')
    expect(sanitizeLocalName('back\\slash', 'darwin')).toBe('back\\slash')
  })
})

describe('resolveLocalConflictPath', () => {
  it('numbers directories without splitting a fake extension', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'litesh-conflict-'))
    try {
      fs.mkdirSync(path.join(dir, 'my.project'))
      fs.writeFileSync(path.join(dir, 'notes.txt'), '')
      expect(resolveLocalConflictPath(dir, 'my.project', 'rename', { isDirectory: true })).toBe(
        path.join(dir, 'my.project (1)'),
      )
      expect(resolveLocalConflictPath(dir, 'notes.txt', 'rename')).toBe(path.join(dir, 'notes (1).txt'))
      expect(resolveLocalConflictPath(dir, 'my.project', 'skip', { isDirectory: true })).toBeNull()
      expect(resolveLocalConflictPath(dir, 'my.project', 'overwrite', { isDirectory: true })).toBe(
        path.join(dir, 'my.project'),
      )
      expect(resolveLocalConflictPath(dir, 'fresh', 'rename', { isDirectory: true })).toBe(path.join(dir, 'fresh'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
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
