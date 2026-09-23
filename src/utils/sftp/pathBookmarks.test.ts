import { describe, expect, it } from 'vitest'
import { stripConnectionPathBookmarks } from '@shared/sftp/pathBookmarks'
import {
  bookmarksForConnection,
  defaultBookmarkName,
  findBookmarkForPath,
  findConnectionBookmarkForPath,
  moveBookmarkWithinScope,
  normalizeBookmarkPath,
  parseSftpPathBookmarks,
  reorderBookmarkWithinScope,
  replaceBookmarkPath,
} from './pathBookmarks'
import type { SftpPathBookmark } from '@shared/types/sftp'

function bookmark(id: string, scope: 'connection' | 'global', connectionId?: string): SftpPathBookmark {
  return { id, name: id, path: `/${id}`, scope, connectionId, createdAt: 1, updatedAt: 1 }
}

describe('SFTP path bookmarks', () => {
  it('normalizes remote paths and derives readable default names', () => {
    expect(normalizeBookmarkPath(' //opt///apps/ ')).toBe('/opt/apps')
    expect(defaultBookmarkName('/opt/apps/')).toBe('apps')
    expect(defaultBookmarkName('/')).toBe('/')
  })

  it('drops malformed records and normalizes persisted data', () => {
    const parsed = parseSftpPathBookmarks(JSON.stringify([
      { id: 'a', path: '/var/log/', scope: 'connection', connectionId: 'c1', createdAt: 1, updatedAt: 2 },
      { id: 'b', name: 'Shared', path: 'tmp', scope: 'global' },
      { id: 'c', path: '/bad', scope: 'connection' },
      { id: 'a', path: '/duplicate', scope: 'global' },
    ]))
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({ id: 'a', name: 'log', path: '/var/log', connectionId: 'c1' })
    expect(parsed[1]).toMatchObject({ id: 'b', name: 'Shared', path: '/tmp', scope: 'global' })
  })

  it('shows current-connection and global bookmarks, preferring local matches', () => {
    const items = [bookmark('a', 'connection', 'c1'), bookmark('b', 'connection', 'c2'), bookmark('g', 'global')]
    expect(bookmarksForConnection(items, 'c1')).toEqual({ connection: [items[0]], global: [items[2]] })
    const samePath = [
      { ...items[2], path: '/same' },
      { ...items[0], path: '/same' },
    ]
    expect(findBookmarkForPath(samePath, 'c1', '/same')?.id).toBe('a')
  })

  it('reorders only within the same scope and connection', () => {
    const items = [
      bookmark('a', 'connection', 'c1'),
      bookmark('x', 'connection', 'c2'),
      bookmark('b', 'connection', 'c1'),
      bookmark('g', 'global'),
    ]
    expect(moveBookmarkWithinScope(items, 'b', -1).map((item) => item.id)).toEqual(['b', 'x', 'a', 'g'])
    expect(moveBookmarkWithinScope(items, 'a', -1)).toEqual(items)
    expect(reorderBookmarkWithinScope(items, 'b', 'a', 'before').map((item) => item.id)).toEqual(['b', 'a', 'x', 'g'])
    expect(reorderBookmarkWithinScope(items, 'a', 'g', 'before').map((item) => item.id)).toEqual(items.map((item) => item.id))
    expect(findConnectionBookmarkForPath(
      [{ ...items[2], path: '/same' }, { ...items[3], path: '/same' }],
      'c1',
      '/same',
    )?.id).toBe('b')
    expect(findConnectionBookmarkForPath(
      [{ ...items[3], path: '/same' }],
      'c1',
      '/same',
    )).toBeNull()
  })

  it('replaces a bookmark path without colliding in the same scope', () => {
    const items = [
      bookmark('a', 'connection', 'c1'),
      bookmark('b', 'connection', 'c1'),
      bookmark('g', 'global'),
    ]
    items[0].path = '/opt/a'
    items[1].path = '/opt/b'
    items[2].path = '/opt/a'
    expect(replaceBookmarkPath(items, 'a', '/opt/b').result).toBe('duplicate')
    expect(replaceBookmarkPath(items, 'g', '/opt/b').result).toBe('ok')
    expect(replaceBookmarkPath(items, 'a', '/var/log').bookmarks.find((item) => item.id === 'a')?.path).toBe('/var/log')
  })

  it('strips one connection from persisted bookmarks and keeps globals', () => {
    const raw = JSON.stringify([
      { id: 'a', path: '/var/log', scope: 'connection', connectionId: 'c1' },
      { id: 'b', path: '/tmp', scope: 'connection', connectionId: 'c2' },
      { id: 'g', path: '/etc', scope: 'global' },
      { id: 'legacy', path: '/opt', connectionId: 'c1' },
    ])
    const stripped = stripConnectionPathBookmarks(raw, 'c1')
    expect(stripped.changed).toBe(true)
    expect(JSON.parse(stripped.value || '[]').map((item: { id: string }) => item.id)).toEqual(['b', 'g'])
    expect(stripConnectionPathBookmarks(stripped.value, 'c1').changed).toBe(false)
    expect(stripConnectionPathBookmarks('not-json', 'c1')).toEqual({ changed: false, value: 'not-json' })
    expect(stripConnectionPathBookmarks(JSON.stringify([{ id: 'a', path: '/x', scope: 'connection', connectionId: 'c1' }]), 'c1')).toEqual({
      changed: true,
      value: null,
    })
  })
})
