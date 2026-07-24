import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSftpUpload } from './useSftpUpload'

describe('useSftpUpload', () => {
  const originalWindow = globalThis.window
  let sftpUpload: ReturnType<typeof vi.fn>
  let sftpUploadDirectory: ReturnType<typeof vi.fn>
  let getPathForFile: ReturnType<typeof vi.fn>
  let onQueued: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sftpUpload = vi.fn()
    sftpUploadDirectory = vi.fn()
    getPathForFile = vi.fn((file: File) => `C:/tmp/${file.name}`)
    onQueued = vi.fn()
    globalThis.window = {
      LiteConnect: {
        sftpUpload,
        sftpUploadDirectory,
        getPathForFile,
      },
    } as unknown as Window & typeof globalThis
  })

  afterEach(() => {
    globalThis.window = originalWindow
  })

  it('queues files and directories with the selected conflict strategy and target path', async () => {
    const upload = useSftpUpload({
      sessionId: () => 'session-1',
      currentPath: ref('/home'),
      onQueued,
    })

    upload.onDropTarget('/incoming/')
    await upload.onDrop({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        items: [
          {
            kind: 'file',
            getAsFile: () => ({ name: 'notes.txt' }),
            webkitGetAsEntry: () => ({ isDirectory: false }),
          },
          {
            kind: 'file',
            getAsFile: () => ({ name: 'photos' }),
            webkitGetAsEntry: () => ({ isDirectory: true }),
          },
        ],
      },
    } as unknown as DragEvent)
    await upload.confirmUpload('overwrite')

    expect(sftpUpload).toHaveBeenCalledWith(
      'session-1',
      'C:/tmp/notes.txt',
      '/incoming',
      'notes.txt',
      expect.stringMatching(/^ul-/),
      { conflict: 'overwrite' },
    )
    expect(sftpUploadDirectory).toHaveBeenCalledWith(
      'session-1',
      'C:/tmp/photos',
      '/incoming',
      'photos',
      expect.stringMatching(/^ul-/),
      { conflict: 'overwrite' },
    )
    expect(onQueued).toHaveBeenCalledWith('upload')
    expect(upload.showUploadConfirm.value).toBe(false)
    expect(upload.uploadFiles.value).toEqual([])
  })

  it('ignores an empty drop without opening a confirmation or starting an upload', async () => {
    const upload = useSftpUpload({
      sessionId: () => 'session-1',
      currentPath: ref('/home'),
      onQueued,
    })

    await upload.onDrop({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { items: [] },
    } as unknown as DragEvent)

    expect(upload.showUploadConfirm.value).toBe(false)
    expect(upload.uploadFiles.value).toEqual([])
    expect(sftpUpload).not.toHaveBeenCalled()
    expect(sftpUploadDirectory).not.toHaveBeenCalled()
    expect(onQueued).not.toHaveBeenCalled()
  })
})
