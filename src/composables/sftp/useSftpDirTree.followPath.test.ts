import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ancestorPaths, useSftpDirTree } from './useSftpDirTree'
import type { FileEntry } from '../../env.d.ts'

function dir(name: string, parent: string): FileEntry {
  const path = parent === '/' ? `/${name}` : `${parent}/${name}`
  return {
    name,
    path,
    isDirectory: true,
    isSymlink: false,
    size: 0,
    modifyTime: 0,
    permissions: 'drwxr-xr-x',
  }
}

describe('useSftpDirTree followPath', () => {
  const readdir = vi.fn()

  beforeEach(() => {
    readdir.mockReset()
    ;(globalThis as any).window = {
      LiteConnect: {
        sftpReaddir: readdir,
      },
    }
  })

  it('ancestorPaths builds chain', () => {
    expect(ancestorPaths('/home/u/new')).toEqual(['/', '/home', '/home/u', '/home/u/new'])
  })

  it('force-reloads parent when next segment is missing from cache (mkdir+cd)', async () => {
    const tree = useSftpDirTree(() => 'sess-1')

    // Stale parent listing without the newly created directory
    tree.ingestListing('/home/u', [dir('old', '/home/u')])
    tree.ingestListing('/home/u/new', [])

    readdir.mockImplementation(async (_sid: string, path: string) => {
      if (path === '/') return [dir('home', '/')]
      if (path === '/home') return [dir('u', '/home')]
      if (path === '/home/u') return [dir('old', '/home/u'), dir('new', '/home/u')]
      if (path === '/home/u/new') return []
      return []
    })

    await tree.followPath('/home/u/new')

    const parentKids = tree.entriesOf('/home/u')
    expect(parentKids.map((e) => e.name).sort()).toEqual(['new', 'old'])
    expect(readdir).toHaveBeenCalledWith('sess-1', '/home/u')
  })

  it('injects placeholder when parent readdir still omits the leaf', async () => {
    const tree = useSftpDirTree(() => 'sess-1')
    tree.ingestListing('/home/u', [dir('old', '/home/u')])

    readdir.mockImplementation(async (_sid: string, path: string) => {
      if (path === '/') return [dir('home', '/')]
      if (path === '/home') return [dir('u', '/home')]
      // Parent still stale / missing new
      if (path === '/home/u') return [dir('old', '/home/u')]
      if (path === '/home/u/new') return []
      return []
    })

    await tree.followPath('/home/u/new')

    const parentKids = tree.entriesOf('/home/u')
    expect(parentKids.some((e) => e.path === '/home/u/new' && e.isDirectory)).toBe(true)
  })
})
