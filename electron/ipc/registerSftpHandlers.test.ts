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
