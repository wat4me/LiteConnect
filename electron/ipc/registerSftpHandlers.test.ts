import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shellQuote } from '../ssh/shellQuote'

const handlers = new Map<string, (...args: any[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => unknown) => handlers.set(channel, fn),
  },
}))

import { registerSftpHandlers } from './registerSftpHandlers'
import type { SSHManager } from '../ssh/manager'

const VALID_SID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

beforeEach(() => handlers.clear())

describe('SFTP stat handler', () => {
  it('shell-quotes the remote path used to resolve owner names', async () => {
    const remotePath = '/tmp/a"; touch /tmp/injected; echo "'
    const sftpExec = vi.fn(async () => 'alice:staff')
    const manager = {
      sftpStat: vi.fn(async () => ({
        mode: '644', size: 1, uid: 1000, gid: 1000, atime: 0, mtime: 0,
        owner: '1000', group: '1000',
      })),
      sftpExec,
    } as unknown as SSHManager
    registerSftpHandlers(manager)

    const handler = handlers.get('sftp:stat')
    expect(handler).toBeDefined()
    const result = await handler!({}, VALID_SID, remotePath)

    expect(sftpExec).toHaveBeenCalledWith(
      VALID_SID,
      `stat -c '%U:%G' -- ${shellQuote(remotePath)}`,
    )
    expect(result).toMatchObject({ owner: 'alice', group: 'staff' })
  })
})

describe('SFTP editor IPC validation', () => {
  it('rejects malformed revisions, invalid sessions and invalid paths before saving', async () => {
    const save = vi.fn()
    registerSftpHandlers({ sftpSaveEditor: save } as unknown as SSHManager)
    const handler = handlers.get('sftp:editorSave')!
    await expect(handler({}, VALID_SID, '/x', 'draft', { revision: 'invalid' })).rejects.toThrow()
    await expect(handler({}, 'bad', '/x', 'draft', { revision: 'a'.repeat(64) })).rejects.toThrow()
    await expect(handler({}, VALID_SID, '/x\0', 'draft', { revision: 'a'.repeat(64) })).rejects.toThrow()
    expect(save).not.toHaveBeenCalled()
  })
})
describe('shallow SFTP directory preview', () => {
  it('compares files and skips subdirectories; blocks remote links and same-name directories', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'liteconnect-sync-'))
    try {
      for (const name of ['new', 'changed', 'same', 'blocked']) await fs.writeFile(path.join(dir, name), 'abc')
      await fs.mkdir(path.join(dir, 'subdirectory'))
      const sameStat = await fs.stat(path.join(dir, 'same'))
      const readdir = vi.fn(async () => [
        { name: 'changed', size: 1, modifyTime: 0, isDirectory: false, isSymlink: false },
        { name: 'same', size: 3, modifyTime: sameStat.mtimeMs, isDirectory: false, isSymlink: false },
        { name: 'blocked', size: 3, modifyTime: sameStat.mtimeMs, isDirectory: false, isSymlink: true },
        { name: 'remote-only', size: 8, modifyTime: 0, isDirectory: false, isSymlink: false },
      ])
      registerSftpHandlers({ sftpReaddir: readdir } as unknown as SSHManager)
      const result = await handlers.get('sftp:directoryPreview')!({}, VALID_SID, dir, '/target') as { entries: Array<{ name: string; status: string }>; skipped: number }
      expect(Object.fromEntries(result.entries.map(entry => [entry.name, entry.status]))).toEqual({ new: 'new', changed: 'changed', same: 'same', blocked: 'blocked' })
      expect(result.skipped).toBe(1)
      expect(readdir).toHaveBeenCalledOnce()
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  })
  it('refuses relative local paths before reading the remote directory', async () => {
    const readdir = vi.fn()
    registerSftpHandlers({ sftpReaddir: readdir } as unknown as SSHManager)
    await expect(handlers.get('sftp:directoryPreview')!({}, VALID_SID, '../relative', '/remote')).rejects.toThrow()
    expect(readdir).not.toHaveBeenCalled()
  })
})
