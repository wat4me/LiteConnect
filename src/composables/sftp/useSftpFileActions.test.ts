import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('element-plus/es/components/message/index', () => ({
  ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('../useAppDialog', () => ({ appConfirm: vi.fn() }))

import { appConfirm } from '../useAppDialog'
import { useSftpFileActions } from './useSftpFileActions'

const file = {
  name: 'notes.txt',
  path: '/home/user/notes.txt',
  isDirectory: false,
  isSymlink: false,
} as const

describe('useSftpFileActions', () => {
  const originalWindow = globalThis.window
  let sftpDelete: ReturnType<typeof vi.fn>
  let sftpRename: ReturnType<typeof vi.fn>
  let setError: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.mocked(appConfirm).mockResolvedValue('confirm')
    sftpDelete = vi.fn(async () => {})
    sftpRename = vi.fn(async () => {})
    setError = vi.fn()
    globalThis.window = {
      LiteConnect: { sftpDelete, sftpRename },
    } as unknown as Window & typeof globalThis
  })

  afterEach(() => {
    globalThis.window = originalWindow
  })

  function actions() {
    return useSftpFileActions({
      sessionId: () => 'session-1',
      downloadConflict: ref('rename'),
      refresh: vi.fn(),
      onDownloadQueued: vi.fn(),
      setError,
      hideContextMenu: vi.fn(),
    })
  }

  it('renames within the original directory', async () => {
    const api = actions()
    api.startRename(file)
    api.renameValue.value = 'renamed.txt'

    await api.confirmRename()

    expect(sftpRename).toHaveBeenCalledWith('session-1', '/home/user/notes.txt', '/home/user/renamed.txt')
  })

  it('reports a failed rename without sending a second request', async () => {
    sftpRename.mockRejectedValueOnce(new Error('permission denied'))
    const api = actions()
    api.startRename(file)
    api.renameValue.value = 'renamed.txt'

    await api.confirmRename()

    expect(sftpRename).toHaveBeenCalledTimes(1)
    expect(setError).toHaveBeenCalledWith('permission denied')
  })

  it('deletes real directories recursively but does not recurse into symlinks', async () => {
    const api = actions()
    await api.deleteEntry({ ...file, name: 'folder', path: '/home/user/folder', isDirectory: true })
    await api.deleteEntry({ ...file, name: 'shortcut', path: '/home/user/shortcut', isDirectory: true, isSymlink: true })

    expect(sftpDelete).toHaveBeenNthCalledWith(1, 'session-1', '/home/user/folder', true)
    expect(sftpDelete).toHaveBeenNthCalledWith(2, 'session-1', '/home/user/shortcut', false)
  })
})
