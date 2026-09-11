import { beforeAll, describe, expect, it } from 'vitest'
import {
  commonDirPrefix,
  expandDroppedFiles,
  isPathInside,
  isSynthesizableUploadRoot,
  setScratchDirs,
} from './useDragDrop'

// The drop handler compares against the machine's real scratch directory, which
// the main process resolves at startup. Pin it here so the cases are stable.
const TEMP = 'C:/Users/w/AppData/Local/Temp'
beforeAll(() => setScratchDirs([TEMP]))

const F = (p: string, n = p.split(/[/\\]/).pop() as string, d = false) => ({
  path: p,
  name: n,
  isDirectory: d,
})

describe('commonDirPrefix', () => {
  it('returns the shared directory for siblings', () => {
    expect(commonDirPrefix(['D:/a/b/1.txt', 'D:/a/b/2.txt'])).toBe('D:/a/b')
  })

  it('returns the shared directory for a file and a dir beside it', () => {
    expect(commonDirPrefix(['D:/a/b/1.txt', 'D:/a/b/sub'])).toBe('D:/a/b')
  })

  it('returns empty for completely different roots', () => {
    expect(commonDirPrefix(['C:/x/1.txt', 'D:/y/2.txt'])).toBe('')
  })

  it('ignores a single listing (nothing to infer from)', () => {
    expect(commonDirPrefix(['D:/a/b/c.txt'])).toBe('')
  })

  it('never returns a bare drive root', () => {
    // Unrelated folders dragged together must not collapse into "D:/" —
    // that would upload the whole drive.
    expect(commonDirPrefix(['D:/pics/1.png', 'D:/docs/2.txt'])).toBe('')
  })

  it('is case-insensitive and drive-agnostic in separator style', () => {
    expect(commonDirPrefix(['D:\\a\\b\\1.txt', 'd:/A/B/2.txt'])).toBe('D:/a/b')
  })

  it('never returns a scratch directory (archive-viewer / Recycle Bin source)', () => {
    // 7-Zip / WinRAR unpack to %TEMP%; agreeing there means scratch copies.
    expect(commonDirPrefix([
      'C:/Users/w/AppData/Local/Temp/spring-a.xml',
      'C:/Users/w/AppData/Local/Temp/spring-b.xml',
    ])).toBe('')
    // Recycle Bin listings are not a real folder either.
    expect(commonDirPrefix([
      'D:/$Recycle.Bin/S-1-5-21/old.txt',
      'D:/$Recycle.Bin/S-1-5-21/older.txt',
    ])).toBe('')
  })

  it('refuses to walk above a scratch directory either', () => {
    // The walk-up from …/Temp/*.xml passes through the scratch dir's ancestors.
    // Stopping there would upload far more than the user grabbed — the profile
    // directory in the worst case — so every ancestor is refused too.
    expect(commonDirPrefix([
      'C:/Users/w/notes.txt',
      'C:/Users/w/other.txt',
    ])).toBe('')
    expect(commonDirPrefix([
      'C:/Users/w/AppData/Local/one.txt',
      'C:/Users/w/AppData/Local/two.txt',
    ])).toBe('')
  })

  it('still allows a folder the user actually browsed into', () => {
    // A real folder is strictly below the scratch directory, so the walk stops
    // on it before ever reaching %TEMP% or an ancestor.
    expect(commonDirPrefix([
      'C:/Users/w/AppData/Local/Temp/myproject/a.txt',
      'C:/Users/w/AppData/Local/Temp/myproject/sub/b.txt',
    ])).toBe('C:/Users/w/AppData/Local/Temp/myproject')
  })
})

describe('isSynthesizableUploadRoot', () => {
  it('rejects the scratch directory, everything above it, and the Recycle Bin', () => {
    expect(isSynthesizableUploadRoot(TEMP)).toBe(false)
    expect(isSynthesizableUploadRoot('C:/Users/w/AppData/Local')).toBe(false)
    expect(isSynthesizableUploadRoot('C:/Users/w/AppData')).toBe(false)
    expect(isSynthesizableUploadRoot('C:/Users/w')).toBe(false)
    expect(isSynthesizableUploadRoot('C:/Users')).toBe(false)
    expect(isSynthesizableUploadRoot('D:/$Recycle.Bin')).toBe(false)
    expect(isSynthesizableUploadRoot('')).toBe(false)
  })

  it('accepts ordinary folders and folders inside a scratch directory', () => {
    expect(isSynthesizableUploadRoot('D:/assets/photos')).toBe(true)
    // Strictly *below* the scratch root is a folder the user deliberately opened.
    expect(isSynthesizableUploadRoot('C:/Users/w/AppData/Local/Temp/myproject')).toBe(true)
  })

  it('does not confuse an unrelated folder named like the scratch one', () => {
    // Screening is by exact location, not by name — only the real %TEMP% counts.
    expect(isSynthesizableUploadRoot('D:/Temp')).toBe(true)
    expect(isSynthesizableUploadRoot('D:/projects/local/temp')).toBe(true)
  })
})

describe('isPathInside', () => {
  it('detects containment on both separators', () => {
    expect(isPathInside('D:/a/b/c.txt', 'D:/a/b')).toBe(true)
    expect(isPathInside('D:\\a\\b\\c.txt', 'D:/a/b')).toBe(true)
    expect(isPathInside('D:/a/bc.txt', 'D:/a/b')).toBe(false)
  })
})

describe('expandDroppedFiles', () => {
  it('keeps an explicitly dropped directory as a single recursive upload', () => {
    const expanded = expandDroppedFiles([F('D:/assets/photos', 'photos', true)])
    expect(expanded).toEqual([
      { name: 'photos', path: 'D:/assets/photos', isDirectory: true },
    ])
  })

  it('collapses a flat file batch into the shared parent directory', () => {
    const expanded = expandDroppedFiles([
      F('D:/assets/season1/ep1.mkv', 'ep1.mkv'),
      F('D:/assets/season1/ep2.mkv', 'ep2.mkv'),
    ])
    expect(expanded).toEqual([
      { name: 'season1', path: 'D:/assets/season1', isDirectory: true },
    ])
  })

  it('does not invent a folder from a single file listing', () => {
    // One file says nothing about what the user grabbed; stay flat.
    // (A dropped folder always arrives as a directory entry, so this is rare.)
    const expanded = expandDroppedFiles([F('D:/desktop/notes.txt', 'notes.txt')])
    expect(expanded).toEqual([
      { name: 'notes.txt', path: 'D:/desktop/notes.txt', isDirectory: false },
    ])
  })

  it('keeps a loose multi-file drop flat (no synthesised folder)', () => {
    const expanded = expandDroppedFiles([
      F('D:/desktop/a.txt', 'a.txt'),
      F('D:/downloads/b.txt', 'b.txt'),
    ])
    expect(expanded).toHaveLength(2)
    expect(expanded.every((e) => e.isDirectory === false)).toBe(true)
  })

  it('refuses entries that only exist as scratch copies', () => {
    // Archive viewers unpack to %TEMP%; uploading those copies is never intended.
    expect(expandDroppedFiles([
      F('C:/Users/w/AppData/Local/Temp/spring-a.xml', 'spring-a.xml'),
      F('C:/Users/w/AppData/Local/Temp/spring-b.xml', 'spring-b.xml'),
    ])).toEqual([])
    // A scratch directory handed over as a "folder" is equally untrustworthy.
    expect(expandDroppedFiles([
      F('C:/Users/w/AppData/Local/Temp', 'Temp', true),
    ])).toEqual([])
  })

  it('leaves an empty item list alone', () => {
    expect(expandDroppedFiles([])).toEqual([])
  })
})
