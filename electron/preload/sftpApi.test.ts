import { beforeEach, expect, it, vi } from 'vitest'
import type { IpcRenderer, IpcRendererEvent } from 'electron'
import type { SftpApi } from '../../shared/ipc/sftp'
import { createSftpApi } from './sftpApi'

const transport = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined as unknown),
  send: vi.fn(), on: vi.fn(), removeListener: vi.fn(), expose: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcRenderer: transport,
  contextBridge: { exposeInMainWorld: transport.expose },
  webUtils: {},
}))

const ipc = transport as unknown as IpcRenderer
let api: SftpApi
beforeEach(() => {
  vi.clearAllMocks()
  transport.invoke.mockResolvedValue(undefined)
  api = createSftpApi(ipc)
})

it('exposes the SFTP facade through the actual preload without removing other capabilities', async () => {
  await import('../preload')
  expect(transport.expose).toHaveBeenCalledOnce()
  const [name, exposed] = transport.expose.mock.calls[0]
  expect(name).toBe('LiteConnect')
  for (const method of Object.keys(api)) expect(exposed[method]).toBeTypeOf('function')
  expect(exposed.aiChatStream).toBeTypeOf('function')
  expect(exposed.getConnections).toBeTypeOf('function')
  expect(exposed.dbListConnections).toBeTypeOf('function')
  exposed.sftpCancelTransfer('transfer')
  expect(transport.send).toHaveBeenCalledWith('sftp:cancelTransfer', 'transfer')
})

const calls: Array<[keyof SftpApi, string, unknown[]]> = [
  ['sftpInit', 'sftp:init', ['session']],
  ['sftpReaddir', 'sftp:readdir', ['session', '/path']],
  ['sftpRealpath', 'sftp:realpath', ['session', '/path']],
  ['sftpExecHome', 'sftp:execHome', ['session']],
  ['sftpExtractArchive', 'sftp:extractArchive', ['session', '/archive']],
  ['sftpExists', 'sftp:exists', ['session', '/path']],
  ['sftpEditorSnapshot', 'sftp:editorSnapshot', ['session', '/path']],
  ['sftpEditorSave', 'sftp:editorSave', ['session', '/path', 'content', { revision: 'revision', backup: true }]],
  ['sftpDirectoryPreview', 'sftp:directoryPreview', ['session', 'C:/local', '/remote']],
  ['sftpReadFile', 'sftp:readFile', ['session', '/path']],
  ['sftpWriteFile', 'sftp:writeFile', ['session', '/path', 'content']],
  ['sftpChmod', 'sftp:chmod', ['session', '/path', '755', true]],
  ['sftpChown', 'sftp:chown', ['session', '/path', 'owner', 'group', true]],
  ['sftpRename', 'sftp:rename', ['session', '/old', '/new']],
  ['sftpMkdir', 'sftp:mkdir', ['session', '/path']],
  ['sftpDelete', 'sftp:delete', ['session', '/path', true]],
  ['sftpStat', 'sftp:stat', ['session', '/path']],
]

it.each(calls)('%s preserves its invoke channel, argument order and result', async (method, channel, args) => {
  const result = { response: channel }
  transport.invoke.mockResolvedValueOnce(result)
  const call = api[method] as (...args: unknown[]) => Promise<unknown>
  expect(await call(...args)).toBe(result)
  expect(transport.invoke).toHaveBeenCalledExactlyOnceWith(channel, ...args)
  expect(transport.send).not.toHaveBeenCalled()
})

it('preserves handler rejection instead of converting it into a successful result', async () => {
  const failure = new Error('Invalid session id')
  transport.invoke.mockRejectedValueOnce(failure)
  await expect(api.sftpStat('bad', '/path')).rejects.toBe(failure)
})

const commands: Array<[keyof SftpApi, string, unknown[]]> = [
  ['sftpDownload', 'sftp:download', ['session', '/remote', 'file', 'dl', { resume: true, localPath: 'C:/file', conflict: 'rename' }]],
  ['sftpUpload', 'sftp:upload', ['session', 'C:/file', '/remote', 'file', 'ul', { conflict: 'ask', batchId: 'batch', batchSize: 2 }]],
  ['sftpDownloadDirectory', 'sftp:downloadDirectory', ['session', '/remote', 'dir', 'dl-dir', { conflict: 'skip', concurrency: 2, failPolicy: 'stop' }]],
  ['sftpUploadDirectory', 'sftp:uploadDirectory', ['session', 'C:/dir', '/remote', 'dir', 'ul-dir', { conflict: 'ask' }]],
  ['sftpCancelTransfer', 'sftp:cancelTransfer', ['transfer']],
  ['resolveUploadConflict', 'sftp:resolveUploadConflict', ['request', { action: 'cancel', applyToAll: false }]],
]
it.each(commands)('%s remains a fire-and-forget command', (method, channel, args) => {
  const call = api[method] as (...args: unknown[]) => void
  expect(call(...args)).toBeUndefined()
  expect(transport.send).toHaveBeenCalledExactlyOnceWith(channel, ...args)
  expect(transport.invoke).not.toHaveBeenCalled()
})

const events: Array<[keyof SftpApi, string, unknown[]]> = [
  ['onTransferStart', 'sftp:transferStart', ['session', 'transfer', 'file', 'C:/file', 'upload', '/file', 'file', { source: 'ai', conversationId: 'conversation', threadId: 'thread' }]],
  ['onTransferProgress', 'sftp:transferProgress', ['session', 'transfer', 3, 10, { completedFiles: 1, failedFiles: 0, totalFiles: 2, phase: 'transferring' }]],
  ['onTransferComplete', 'sftp:transferComplete', ['session', 'transfer', 'C:/file', 'partial', { completedFiles: 1, failedFiles: 1, totalFiles: 2 }]],
  ['onTransferError', 'sftp:transferError', ['session', 'transfer', 'Cancelled', 'cancelled']],
  ['onUploadConflict', 'sftp:uploadConflict', [{ requestId: 'request', sessionId: 'session', transferId: 'transfer', localPath: 'C:/file', remotePath: '/file' }]],
]
it.each(events)('%s strips Electron events and removes only its own listener', (method, channel, payload) => {
  const subscribe = api[method] as (callback: (...args: unknown[]) => void) => () => void
  const callback = vi.fn()
  const off = subscribe(callback)
  const otherOff = subscribe(vi.fn())
  const listener = transport.on.mock.calls[0][1]
  const otherListener = transport.on.mock.calls[1][1]
  expect(transport.on.mock.calls.map(call => call[0])).toEqual([channel, channel])
  listener({ sender: ipc } as IpcRendererEvent, ...payload)
  expect(callback).toHaveBeenCalledExactlyOnceWith(...payload)
  off()
  expect(transport.removeListener).toHaveBeenCalledExactlyOnceWith(channel, listener)
  expect(listener).not.toBe(otherListener)
  otherOff()
  expect(transport.removeListener).toHaveBeenLastCalledWith(channel, otherListener)
})

it('delivers the null conflict dismissal and accepts omitted optional transfer options', () => {
  const callback = vi.fn()
  api.onUploadConflict(callback)
  transport.on.mock.calls[0][1]({}, null)
  expect(callback).toHaveBeenCalledWith(null)
  api.sftpDownload('session', '/remote', 'file', 'dl')
  expect(transport.send).toHaveBeenCalledWith('sftp:download', 'session', '/remote', 'file', 'dl')
})
