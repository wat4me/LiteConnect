import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { SftpSession } from './sftpSession'
import type { Session } from '../types'
const revision = (value: string) => createHash('sha256').update(value).digest('hex')
function setup() {
  const channel = { createWriteStream: vi.fn(() => {
    const stream = new EventEmitter() as EventEmitter & { end: (buffer: Buffer) => void }
    stream.end = () => queueMicrotask(() => stream.emit('close'))
    return stream
  }) }
  const api = new SftpSession(() => ({ sftp: channel } as unknown as Session))
  const read = vi.spyOn(api, 'sftpReadFile').mockResolvedValue('original')
  const write = vi.spyOn(api, 'sftpWriteFile').mockResolvedValue()
  return { api, read, write, channel }
}
describe('guarded SFTP editor save', () => {
  it('detects same-length remote edits by content and never writes a conflicting draft', async () => {
    const { api, write } = setup()
    const result = await api.sftpSaveEditor('s', '/x', 'draft', { revision: revision('changed!') }, 1024)
    expect(result.status).toBe('conflict')
    expect(write).not.toHaveBeenCalled()
  })
  it('saves only with the latest revision and returns the new revision', async () => {
    const { api, write } = setup()
    expect(await api.sftpSaveEditor('s', '/x', 'draft', { revision: revision('original') }, 1024)).toEqual({ status: 'saved', revision: revision('draft'), backupPath: undefined })
    expect(write).toHaveBeenCalledWith('s', '/x', 'draft', 1024)
  })
  it('rejects oversized UTF-8 draft before touching the remote file', async () => {
    const { api, read, write } = setup()
    await expect(api.sftpSaveEditor('s', '/x', '中文', { revision: revision('original') }, 5)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })
  it('aborts the overwrite if backup fails', async () => {
    const { api, write, channel } = setup()
    channel.createWriteStream.mockImplementation(() => {
      const stream = new EventEmitter() as EventEmitter & { end: () => void }
      stream.end = () => queueMicrotask(() => stream.emit('error', new Error('permission denied')))
      return stream
    })
    await expect(api.sftpSaveEditor('s', '/x', 'draft', { revision: revision('original'), backup: true }, 1024)).rejects.toThrow('permission denied')
    expect(write).not.toHaveBeenCalled()
  })
  it('backs up exclusively with private permissions and rechecks after backup', async () => {
    const { api, read, write, channel } = setup()
    read.mockResolvedValueOnce('original').mockResolvedValueOnce('external edit')
    const result = await api.sftpSaveEditor('s', '/x', 'draft', { revision: revision('original'), backup: true }, 1024)
    expect(result.status).toBe('conflict')
    expect(channel.createWriteStream).toHaveBeenCalledWith(expect.stringMatching(/^\/x\.liteconnect-backup-/), { flags: 'wx', mode: 0o600 })
    expect(write).not.toHaveBeenCalled()
  })
  it('serializes app saves so two windows cannot both save against one revision', async () => {
    const { api, read, write } = setup()
    let remote = 'original'
    read.mockImplementation(async () => remote)
    write.mockImplementation(async (_sid, _path, content) => { remote = content })
    const results = await Promise.all(['a', 'b'].map(content => api.sftpSaveEditor('s', '/x', content, { revision: revision('original') }, 1024)))
    expect(results.map(result => result.status)).toEqual(['saved', 'conflict'])
    expect(remote).toBe('a')
  })
  it('propagates a disconnected read without attempting any write', async () => {
    const { api, read, write } = setup()
    read.mockRejectedValue(new Error('disconnected'))
    await expect(api.sftpSaveEditor('s', '/x', 'draft', { revision: revision('original') }, 1024)).rejects.toThrow('disconnected')
    expect(write).not.toHaveBeenCalled()
  })
})
