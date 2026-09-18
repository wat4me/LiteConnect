import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const handlers = new Map<string, (...args: any[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, fn: (...args: any[]) => unknown) => handlers.set(channel, fn),
    handle: (channel: string, fn: (...args: any[]) => unknown) => handlers.set(channel, fn),
  },
  BrowserWindow: class {},
}))

import { registerSftpTransferHandlers } from './registerSftpTransferHandlers'
import { TransferCancelledError } from '../ssh/transfer/transferHelpers'
import type { SSHManager } from '../ssh/manager'
import type { SettingsStore } from '../store/settingsStore'

const SID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

function sender() {
  const send = vi.fn()
  return { send, isDestroyed: () => false }
}

function eventsOf(send: ReturnType<typeof vi.fn>, channel: string) {
  return send.mock.calls.filter((c) => c[0] === channel).map((c) => c.slice(1))
}

describe('SFTP transfer handlers', () => {
  let downloadDir: string
  let settings: SettingsStore
  let concurrency: number

  beforeEach(() => {
    handlers.clear()
    downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'litesh-handlers-'))
    concurrency = 1
    settings = {
      init: async () => {},
      getDownloadPath: () => downloadDir,
      getDirTransferConcurrency: () => concurrency,
      getDirTransferFailPolicy: () => 'stop',
      addRecentDownloadPath: async () => {},
    } as unknown as SettingsStore
  })

  function register(manager: Partial<SSHManager>) {
    const teardown: Array<(sessionId: string) => void> = []
    const full = {
      registerSessionTeardownHook: (hook: (sessionId: string) => void) => {
        teardown.push(hook)
        return () => {}
      },
      initSftp: async () => {},
      cancelTransfer: vi.fn(() => false),
      ...manager,
    } as unknown as SSHManager
    registerSftpTransferHandlers(() => null, full, settings)
    return { teardown }
  }

  /** A real local file so isSafeLocalPath passes and the path is unambiguous in assertions. */
  function localFile(rel: string) {
    const p = path.join(downloadDir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, 'x')
    return p
  }

  it('applies the download conflict strategy to a directory download', async () => {
    fs.mkdirSync(path.join(downloadDir, 'photos'))
    const sftpDownloadDirectory = vi.fn(async (..._args: any[]) => ({
      status: 'completed',
      stats: { completedFiles: 0, failedFiles: 0, totalFiles: 0 },
    }))
    register({ sftpDownloadDirectory: sftpDownloadDirectory as any })
    const s = sender()

    await handlers.get('sftp:downloadDirectory')!({ sender: s }, SID, '/remote/photos', 'photos', 'dl-dir-1', { conflict: 'skip' })
    await flush()
    expect(sftpDownloadDirectory).not.toHaveBeenCalled()
    expect(eventsOf(s.send, 'sftp:transferComplete')[0]).toEqual([SID, 'dl-dir-1', path.join(downloadDir, 'photos'), 'skipped'])
    expect(eventsOf(s.send, 'sftp:transferStart')[0][6]).toBe('directory')

    await handlers.get('sftp:downloadDirectory')!({ sender: s }, SID, '/remote/photos', 'photos', 'dl-dir-2', { conflict: 'rename' })
    await flush()
    expect(sftpDownloadDirectory).toHaveBeenCalledWith(
      SID,
      '/remote/photos',
      path.join(downloadDir, 'photos (1)'),
      'dl-dir-2',
      expect.any(Function),
      { concurrency: 1, failPolicy: 'stop' },
    )
  })

  it('sanitises a remote file name before choosing the local path', async () => {
    const sftpDownload = vi.fn(async (..._args: any[]) => {})
    register({ sftpDownload: sftpDownload as any })
    const s = sender()

    await handlers.get('sftp:download')!({ sender: s }, SID, '/remote/a:b.txt', 'a:b.txt', 'dl-1', { conflict: 'rename' })
    await flush()

    const expected = process.platform === 'win32' ? 'a_b.txt' : 'a:b.txt'
    expect(sftpDownload).toHaveBeenCalledWith(
      SID,
      '/remote/a:b.txt',
      path.join(downloadDir, expected),
      'dl-1',
      expect.any(Function),
      { resume: false, keepPartial: true },
    )
    // The transfer list keeps showing the remote name.
    expect(eventsOf(s.send, 'sftp:transferStart')[0][2]).toBe('a:b.txt')
  })

  it('rejects dot names and separators in entry names', async () => {
    const sftpDownload = vi.fn(async (..._args: any[]) => {})
    const sftpUploadDirectory = vi.fn(async (..._args: any[]) => ({ status: 'completed', stats: { completedFiles: 0, failedFiles: 0, totalFiles: 0 } }))
    register({ sftpDownload: sftpDownload as any, sftpUploadDirectory: sftpUploadDirectory as any })
    const s = sender()

    await handlers.get('sftp:download')!({ sender: s }, SID, '/remote/x', '..', 'dl-dot')
    await handlers.get('sftp:uploadDirectory')!({ sender: s }, SID, downloadDir, '/remote', '..', 'ul-dot')
    await flush()

    expect(sftpDownload).not.toHaveBeenCalled()
    expect(sftpUploadDirectory).not.toHaveBeenCalled()
    expect(s.send).not.toHaveBeenCalled()
  })

  it('queues renderer transfers per session and reports a queued cancel as cancelled', async () => {
    const pending: Array<() => void> = []
    const sftpDownload = vi.fn((..._args: any[]) => new Promise<void>((resolve) => pending.push(resolve)))
    const { teardown } = register({ sftpDownload: sftpDownload as any })
    const s = sender()
    const download = handlers.get('sftp:download')!

    await download({ sender: s }, SID, '/remote/1', '1.bin', 'dl-1')
    await download({ sender: s }, SID, '/remote/2', '2.bin', 'dl-2')
    await download({ sender: s }, SID, '/remote/3', '3.bin', 'dl-3')
    await flush()
    expect(sftpDownload).toHaveBeenCalledTimes(1)
    expect(eventsOf(s.send, 'sftp:transferStart')).toHaveLength(3)

    handlers.get('sftp:cancelTransfer')!({}, 'dl-3')
    expect(eventsOf(s.send, 'sftp:transferError')).toEqual([[SID, 'dl-3', 'Transfer cancelled', 'cancelled']])

    pending[0]()
    await flush()
    expect(sftpDownload).toHaveBeenCalledTimes(2)
    expect(eventsOf(s.send, 'sftp:transferComplete')[0]).toEqual([SID, 'dl-1', path.join(downloadDir, '1.bin')])

    // Session teardown drops whatever is still waiting.
    await download({ sender: s }, SID, '/remote/4', '4.bin', 'dl-4')
    for (const hook of teardown) hook(SID)
    expect(eventsOf(s.send, 'sftp:transferError')).toContainEqual([SID, 'dl-4', 'Transfer cancelled', 'cancelled'])
    pending[1]()
    await flush()
  })

  it('honours a cancel that lands between the queue and the runner', async () => {
    let resolveExists: ((exists: boolean) => void) | null = null
    const sftpExists = vi.fn(
      (..._args: any[]) =>
        new Promise<boolean>((resolve) => {
          resolveExists = resolve
        }),
    )
    const sftpUpload = vi.fn(async (..._args: any[]) => {})
    const cancelTransfer = vi.fn(() => false)
    register({ sftpUpload: sftpUpload as any, sftpExists: sftpExists as any, cancelTransfer: cancelTransfer as any })
    const s = sender()

    await handlers.get('sftp:upload')!({ sender: s }, SID, localFile('a.txt'), '/remote', 'a.txt', 'ul-race')
    await flush()
    expect(sftpExists).toHaveBeenCalledTimes(1)

    // Not in the queue any more, not yet known to the runner.
    handlers.get('sftp:cancelTransfer')!({}, 'ul-race')
    expect(cancelTransfer).toHaveBeenCalledWith('ul-race')
    resolveExists!(false)
    await flush()

    expect(sftpUpload).not.toHaveBeenCalled()
    expect(eventsOf(s.send, 'sftp:transferError')).toEqual([[SID, 'ul-race', 'Transfer cancelled', 'cancelled']])
  })

  it('marks a runner-side cancel with the cancelled code but keeps real errors plain', async () => {
    const sftpUpload = vi
      .fn()
      .mockRejectedValueOnce(new TransferCancelledError())
      .mockRejectedValueOnce(new Error('Upload write error: disk full'))
    register({ sftpUpload: sftpUpload as any, sftpExists: async () => false })
    const s = sender()
    const local = localFile('local.txt')

    await handlers.get('sftp:upload')!({ sender: s }, SID, local, '/remote', 'local.txt', 'ul-1')
    await flush()
    await handlers.get('sftp:upload')!({ sender: s }, SID, local, '/remote', 'local.txt', 'ul-2')
    await flush()

    expect(eventsOf(s.send, 'sftp:transferError')).toEqual([
      [SID, 'ul-1', 'Transfer cancelled', 'cancelled'],
      [SID, 'ul-2', 'Upload write error: disk full'],
    ])
  })

  it('never overwrites an existing remote file in rename mode even when the listing fails', async () => {
    const sftpUpload = vi.fn(async (..._args: any[]) => {})
    register({
      sftpUpload: sftpUpload as any,
      sftpExists: async () => true,
      sftpReaddir: async () => {
        throw new Error('permission denied')
      },
    })
    const s = sender()

    await handlers.get('sftp:upload')!({ sender: s }, SID, localFile('notes.txt'), '/remote', 'notes.txt', 'ul-1', { conflict: 'rename' })
    await flush()

    const target = sftpUpload.mock.calls[0][2] as string
    expect(target).not.toBe('/remote/notes.txt')
    expect(target).toMatch(/^\/remote\/notes \(.+\)\.txt$/)
  })

  it('gives concurrent uploads of the same basename distinct remote names', async () => {
    concurrency = 2
    const sftpUpload = vi.fn((..._args: any[]) => new Promise<void>(() => {}))
    register({ sftpUpload: sftpUpload as any, sftpExists: async () => false, sftpReaddir: async () => [] })
    const s = sender()
    const upload = handlers.get('sftp:upload')!

    await upload({ sender: s }, SID, localFile('a/notes.txt'), '/remote', 'notes.txt', 'ul-a', { conflict: 'rename' })
    await upload({ sender: s }, SID, localFile('b/notes.txt'), '/remote', 'notes.txt', 'ul-b', { conflict: 'rename' })
    await flush()

    expect(sftpUpload.mock.calls.map((c) => c[2])).toEqual(['/remote/notes.txt', '/remote/notes (1).txt'])
    // The renamed upload re-announces itself so the list shows the real target.
    const starts = eventsOf(s.send, 'sftp:transferStart').filter((e) => e[1] === 'ul-b')
    expect(starts[starts.length - 1][2]).toBe('notes (1).txt')
    expect(starts[starts.length - 1][5]).toBe('/remote/notes (1).txt')
  })

  it('reports a skipped upload without touching the server', async () => {
    const sftpUpload = vi.fn(async (..._args: any[]) => {})
    register({ sftpUpload: sftpUpload as any, sftpExists: async () => true })
    const s = sender()
    const local = localFile('notes.txt')

    await handlers.get('sftp:upload')!({ sender: s }, SID, local, '/remote', 'notes.txt', 'ul-skip', { conflict: 'skip' })
    await flush()

    expect(sftpUpload).not.toHaveBeenCalled()
    expect(eventsOf(s.send, 'sftp:transferComplete')[0]).toEqual([SID, 'ul-skip', local, 'skipped'])
  })

  it('reopens the SFTP channel before a queued transfer and reports when that fails', async () => {
    const initSftp = vi
      .fn()
      .mockRejectedValueOnce(new Error('SFTP init error: boom'))
      .mockResolvedValue(undefined)
    const sftpDownload = vi.fn(async (..._args: any[]) => {})
    register({ initSftp: initSftp as any, sftpDownload: sftpDownload as any })
    const s = sender()
    const download = handlers.get('sftp:download')!

    await download({ sender: s }, SID, '/remote/1', '1.bin', 'dl-1')
    await flush()
    expect(sftpDownload).not.toHaveBeenCalled()
    expect(eventsOf(s.send, 'sftp:transferError')[0]).toEqual([SID, 'dl-1', 'SFTP init error: boom'])

    await download({ sender: s }, SID, '/remote/2', '2.bin', 'dl-2')
    await flush()
    expect(initSftp).toHaveBeenCalledTimes(2)
    expect(sftpDownload).toHaveBeenCalledTimes(1)
  })
})
