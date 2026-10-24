import { afterEach, expect, it, vi } from 'vitest'
import type { McpFileTransferPort } from './ports'
import { TransferCancelledError } from '../../shared/transferCancellation'
import { createMcpFileTransfers } from './fileTransfers'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const context = { ownerId: 7, conversationId: 'workspace:first', threadId: 'thread-first' }
type Download = McpFileTransferPort['sftpDownload']
function setup() {
  const events: Array<{ owner: number | undefined; channel: string; args: unknown[] }> = []
  const ssh = {
    sftpDownload: vi.fn<Download>(async () => {}), sftpUpload: vi.fn<McpFileTransferPort['sftpUpload']>(async () => {}),
    cancelTransfer: vi.fn(() => true), getConnectionName: vi.fn(() => '服务器 163'),
  }
  const sender = vi.fn((_session: string, origin?: typeof context) => (channel: string, ...args: unknown[]) => { events.push({ owner: origin?.ownerId, channel, args }) })
  return { ssh, events, sender, bridge: createMcpFileTransfers(ssh, sender) }
}
afterEach(() => vi.useRealTimers())

it('pushes throttled download bytes and a final result through the existing transfer events', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000)
  const { ssh, events, bridge } = setup()
  let lateProgress!: Parameters<Download>[4]
  ssh.sftpDownload.mockImplementationOnce(async (_session, _remote, _local, _id, progress, settings) => {
    expect(settings?.keepPartial).toBe(false)
    lateProgress = progress
    progress(10, 100)
    vi.setSystemTime(1050); progress(20, 100)
    vi.setSystemTime(1120); progress(50, 100)
    vi.setSystemTime(1130); progress(100, 100)
  })
  await bridge.download('ssh', '/var/log/app.log', 'C:/Downloads/app.log', { transferContext: context })
  expect(events.map(event => event.channel)).toEqual(['sftp:transferStart', 'sftp:transferProgress', 'sftp:transferProgress', 'sftp:transferProgress', 'sftp:transferComplete'])
  expect(events[0].args).toEqual(['ssh', expect.stringMatching(/^mcp-dl-/), 'app.log', 'C:/Downloads/app.log', 'download', '/var/log/app.log', 'file', { source: 'ai', conversationId: context.conversationId, threadId: context.threadId, hostName: '服务器 163' }])
  expect(events.every(event => event.owner === 7)).toBe(true)
  expect(events.slice(1, -1).map(event => event.args.slice(2))).toEqual([[10, 100], [50, 100], [100, 100]])
  lateProgress(100, 100)
  expect(events).toHaveLength(5)
})

it('reports upload failure once and never emits a false completion', async () => {
  const { ssh, events, bridge } = setup()
  ssh.sftpUpload.mockRejectedValueOnce(new Error('Permission denied'))
  await expect(bridge.upload('ssh', 'C:/Downloads/app.zip', '/srv/app.zip', { transferContext: context })).rejects.toThrow('Permission denied')
  expect(events.map(event => event.channel)).toEqual(['sftp:transferStart', 'sftp:transferError'])
  expect(events[0].args[4]).toBe('upload')
  expect(events[1].args.slice(2)).toEqual(['Permission denied', undefined])
})

it('cancels the actual transfer on AI abort and removes its abort listener after settlement', async () => {
  const { ssh, events, bridge } = setup()
  const controller = new AbortController()
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  let fail!: (error: Error) => void
  ssh.sftpDownload.mockImplementationOnce((_session, _remote, _local, _id, _progress, settings) => new Promise((_, reject) => {
    fail = reject
    ssh.cancelTransfer.mockImplementationOnce(() => { expect(settings?.isCancelled?.()).toBe(true); fail(new TransferCancelledError()); return true })
  }))
  const pending = bridge.download('ssh', '/app.log', 'C:/app.log', { transferContext: context, signal: controller.signal })
  controller.abort()
  await expect(pending).rejects.toBeInstanceOf(TransferCancelledError)
  expect(ssh.cancelTransfer).toHaveBeenCalledExactlyOnceWith(events[0].args[1])
  expect(events.at(-1)?.args.at(-1)).toBe('cancelled')
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  expect(events.some(event => event.channel === 'sftp:transferComplete')).toBe(false)
})

it('does not start an already-aborted download or cancel a completed one later', async () => {
  const { ssh, events, bridge } = setup()
  const stopped = new AbortController(); stopped.abort()
  await expect(bridge.download('ssh', '/a', 'C:/a', { signal: stopped.signal })).rejects.toBeInstanceOf(TransferCancelledError)
  expect(events).toHaveLength(0)
  expect(ssh.sftpDownload).not.toHaveBeenCalled()
  const controller = new AbortController()
  await bridge.download('ssh', '/a', 'C:/a', { signal: controller.signal })
  controller.abort()
  expect(ssh.cancelTransfer).not.toHaveBeenCalled()
})

it('recognizes backend cancellation without an AI abort signal', async () => {
  const { ssh, events, bridge } = setup()
  const cancelled = new TransferCancelledError('Session disconnected')
  ssh.sftpDownload.mockRejectedValueOnce(cancelled)
  await expect(bridge.download('ssh', '/a', 'C:/a')).rejects.toBe(cancelled)
  expect(events.map(event => event.channel)).toEqual(['sftp:transferStart', 'sftp:transferError'])
  expect(events.at(-1)?.args.slice(2)).toEqual(['Session disconnected', 'cancelled'])
})

it('keeps concurrent transfers on a shared SSH connection bound to their originating owners and conversations', async () => {
  const { events, bridge, sender } = setup()
  const other = { ownerId: 8, conversationId: 'workspace:second', threadId: 'thread-second' }
  await Promise.all([
    bridge.download('ssh', '/first', 'C:/first', { transferContext: context }),
    bridge.upload('ssh', 'C:/second', '/second', { transferContext: other }),
  ])
  expect(sender).toHaveBeenCalledWith('ssh', context)
  expect(sender).toHaveBeenCalledWith('ssh', other)
  const starts = events.filter(event => event.channel === 'sftp:transferStart')
  expect(starts.map(event => [event.owner, event.args.at(-1)])).toEqual([
    [7, expect.objectContaining({ conversationId: context.conversationId, threadId: context.threadId })],
    [8, expect.objectContaining({ conversationId: other.conversationId, threadId: other.threadId })],
  ])
  expect(starts[0].args[1]).not.toBe(starts[1].args[1])
})

it('uses download settings and atomically keeps concurrent same-name downloads separate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lite-ai-download-'))
  try {
    const { ssh, sender } = setup()
    const bridge = createMcpFileTransfers(ssh, sender, () => ({ directory, conflict: 'rename' }))
    ssh.sftpDownload.mockImplementation(async (_sid, _remote, local) => { await writeFile(local, 'downloaded') })
    await writeFile(join(directory, 'app.log'), 'original')
    const results = await Promise.all([bridge.download('ssh', '/a/app.log', undefined), bridge.download('ssh', '/b/app.log', undefined)])
    expect(new Set(results.map(result => result.localPath)).size).toBe(2)
    expect(results.every(result => result.localPath !== join(directory, 'app.log'))).toBe(true)
    expect(await readFile(join(directory, 'app.log'), 'utf8')).toBe('original')
    for (const result of results) expect(await readFile(result.localPath, 'utf8')).toBe('downloaded')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('skips an existing local target and reports a skipped transfer without downloading', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lite-ai-download-'))
  try {
    const { ssh, sender, events } = setup()
    const bridge = createMcpFileTransfers(ssh, sender, () => ({ directory, conflict: 'skip' }))
    const target = join(directory, 'app.log')
    await writeFile(target, 'original')
    expect(await bridge.download('ssh', '/app.log', target)).toEqual({ localPath: target, skipped: true })
    expect(ssh.sftpDownload).not.toHaveBeenCalled()
    expect(events.at(-1)?.args.slice(2)).toEqual([target, 'skipped'])
    expect(await readFile(target, 'utf8')).toBe('original')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('removes only its new reserved destination on failure, preserving preexisting files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lite-ai-download-'))
  try {
    const { ssh, sender } = setup()
    const bridge = createMcpFileTransfers(ssh, sender, () => ({ directory, conflict: 'rename' }))
    await writeFile(join(directory, 'app.log'), 'original')
    ssh.sftpDownload.mockRejectedValueOnce(new Error('failed'))
    await expect(bridge.download('ssh', '/app.log', undefined)).rejects.toThrow('failed')
    expect(await readFile(join(directory, 'app.log'), 'utf8')).toBe('original')
    await expect(readFile(join(directory, 'app (1).log'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
