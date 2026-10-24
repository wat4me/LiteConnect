import { TransferCancelledError } from '../../../shared/transferCancellation'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TransferRunner } from './transferRunner'
import type { Session } from '../types'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))

function setup() {
  const local = mkdtempSync(join(tmpdir(), 'lite-upload-conflicts-'))
  directories.push(local)
  for (const name of ['a-new.txt', 'b-existing.txt', 'c-new.txt']) writeFileSync(join(local, name), 'abc')
  const runner = new TransferRunner(() => ({ sftp: {} }) as Session, {
    initSftp: async () => {}, sftpMkdir: vi.fn(), sftpReaddir: async () => [{ name: 'b-existing.txt' }] as any,
    sftpExists: async (_sid, path) => path === '/upload' || path === '/upload/b-existing.txt',
  })
  const upload = vi.spyOn(runner, 'sftpUpload').mockResolvedValue()
  return { runner, local, upload }
}

describe('directory upload conflict timing', () => {
  it('merges existing directories and uploads new files before asking about the conflicting file', async () => {
    const { runner, local, upload } = setup()
    const onFileConflict = vi.fn(async (source, target) => {
      expect(source).toBe(join(local, 'b-existing.txt'))
      expect(target).toBe('/upload/b-existing.txt')
      expect(upload.mock.calls.map(call => call[2])).toEqual(['/upload/a-new.txt'])
      return 'rename' as const
    })
    const progress = vi.fn()
    await runner.sftpUploadDirectory('ssh', local, '/upload', 'job', progress, { onFileConflict, concurrency: 1 })
    expect(onFileConflict).toHaveBeenCalledOnce()
    expect(upload.mock.calls.map(call => call[2])).toEqual(['/upload/a-new.txt', '/upload/b-existing (1).txt', '/upload/c-new.txt'])
    expect(progress.mock.calls.some(call => call[2].phase === 'scanning' && call[2].totalFiles === 3)).toBe(true)
    expect(runner.map.size).toBe(0)
  })

  it('wakes a pending conflict when the directory is cancelled, without uploading that file', async () => {
    const { runner, local, upload } = setup()
    let waiting!: () => void
    const reachedConflict = new Promise<void>(resolve => { waiting = resolve })
    const run = runner.sftpUploadDirectory('ssh', local, '/upload', 'job', () => {}, {
      concurrency: 1,
      onFileConflict: (_local, _remote, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new TransferCancelledError()), { once: true })
        waiting()
      }),
    })
    const result = run.catch(error => error)
    await reachedConflict
    runner.cancelTransfer('job')
    expect(await result).toBeInstanceOf(TransferCancelledError)
    expect(upload).toHaveBeenCalledOnce()
    expect(runner.map.size).toBe(0)
  })

  it('does not rename onto another file from this upload even if the server listing fails', async () => {
    const { runner, local, upload } = setup()
    writeFileSync(join(local, 'b-existing (1).txt'), 'original local copy')
    // Simulate permission to stat individual files but not list the target directory.
    const ops = (runner as any).sftpOps
    ops.sftpReaddir = async () => { throw new Error('cannot list') }
    await runner.sftpUploadDirectory('ssh', local, '/upload', 'job', () => {}, { concurrency: 2, onFileConflict: async () => 'rename' })
    const targets = upload.mock.calls.map(call => call[2])
    expect(new Set(targets).size).toBe(4)
    expect(targets).toContain('/upload/b-existing (1).txt')
    expect(targets).toContain('/upload/b-existing (2).txt')
  })

  it('dismisses another worker’s pending conflict when stop-on-error fails a file', async () => {
    const { runner, local, upload } = setup()
    let waiting!: () => void
    const reachedConflict = new Promise<void>(resolve => { waiting = resolve })
    upload.mockImplementation(async () => { await reachedConflict; throw new Error('disk full') })
    await expect(runner.sftpUploadDirectory('ssh', local, '/upload', 'job', () => {}, {
      concurrency: 2, failPolicy: 'stop',
      onFileConflict: (_local, _remote, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new TransferCancelledError()), { once: true })
        waiting()
      }),
    })).rejects.toThrow('disk full')
    expect(runner.map.size).toBe(0)
  })
})
