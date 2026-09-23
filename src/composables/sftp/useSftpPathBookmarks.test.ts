import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('SFTP path bookmark persistence', () => {
  it('restores the last saved snapshot when consecutive queued writes fail', async () => {
    const setRendererState = vi.fn()
      .mockRejectedValueOnce(new Error('first write failed'))
      .mockRejectedValueOnce(new Error('second write failed'))
    vi.stubGlobal('window', {
      LiteConnect: {
        getRendererState: vi.fn().mockResolvedValue('[]'),
        setRendererState,
        onSftpPathBookmarksChanged: vi.fn(),
      },
    })
    const { useSftpPathBookmarks } = await import('./useSftpPathBookmarks')
    const api = useSftpPathBookmarks(() => 'connection-1')
    const results = await Promise.allSettled([
      api.add({ name: 'One', path: '/one', scope: 'global' }),
      api.add({ name: 'Two', path: '/two', scope: 'global' }),
    ])

    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
    expect(setRendererState).toHaveBeenCalledTimes(2)
    expect(api.bookmarks.value).toEqual([])
  })
})
