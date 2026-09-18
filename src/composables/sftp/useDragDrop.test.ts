import { beforeAll, describe, expect, it } from 'vitest'
import {
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

  it('keeps a same-directory file selection limited to the selected files', () => {
    const expanded = expandDroppedFiles([
      F('D:/assets/season1/ep1.mkv', 'ep1.mkv'),
      F('D:/assets/season1/ep2.mkv', 'ep2.mkv'),
    ])
    expect(expanded).toEqual([
      { name: 'ep1.mkv', path: 'D:/assets/season1/ep1.mkv', isDirectory: false },
      { name: 'ep2.mkv', path: 'D:/assets/season1/ep2.mkv', isDirectory: false },
    ])
  })

  it('keeps every item in a mixed file and directory drop', () => {
    const expanded = expandDroppedFiles([
      F('D:/assets/photos', 'photos', true),
      F('D:/assets/videos', 'videos', true),
      F('D:/assets/readme.txt', 'readme.txt'),
    ])
    expect(expanded).toEqual([
      { name: 'photos', path: 'D:/assets/photos', isDirectory: true },
      { name: 'videos', path: 'D:/assets/videos', isDirectory: true },
      { name: 'readme.txt', path: 'D:/assets/readme.txt', isDirectory: false },
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
