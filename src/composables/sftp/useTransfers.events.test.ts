import { afterEach, expect, it, vi } from 'vitest'
import { canResumeTransfer, ensureTransferListeners, teardownTransferListeners, useTransfers } from './useTransfers'

const store = useTransfers(() => 'ssh')
afterEach(() => {
  teardownTransferListeners()
  for (const id of [...store.transfers.keys()]) store.removeTransfer(id)
  vi.unstubAllGlobals()
})
function setup() {
  const callbacks = new Map<string, (...args: unknown[]) => void>()
  const unsubscribe = vi.fn()
  const listener = (key: string) => vi.fn((callback: (...args: unknown[]) => void) => { callbacks.set(key, callback); return unsubscribe })
  const api = { onUploadConflict: listener('conflict'), onTransferStart: listener('start'), onTransferProgress: listener('progress'), onTransferComplete: listener('complete'), onTransferError: listener('error'), sftpCancelTransfer: vi.fn(), sftpDownload: vi.fn(), sftpUpload: vi.fn() }
  vi.stubGlobal('window', { LiteConnect: api, dispatchEvent: vi.fn() })
  ensureTransferListeners()
  return { callbacks, api, unsubscribe }
}

it('shares start/progress/finish events with AI metadata and avoids duplicate listener subscriptions', () => {
  const { callbacks, api, unsubscribe } = setup()
  ensureTransferListeners()
  expect(api.onTransferStart).toHaveBeenCalledOnce()
  const origin = { source: 'ai', conversationId: 'workspace:one', threadId: 'thread' }
  callbacks.get('start')!('ssh', 'dl', 'app.log', 'C:/app.log', 'download', '/app.log', 'file', origin)
  callbacks.get('progress')!('ssh', 'dl', 40, 100)
  expect(store.transfers.get('dl')).toMatchObject({ origin, transferred: 40, total: 100, status: 'downloading' })
  callbacks.get('complete')!('ssh', 'dl', 'C:/app.log')
  expect(store.transfers.get('dl')).toMatchObject({ status: 'completed', transferred: 100 })
  teardownTransferListeners()
  expect(unsubscribe).toHaveBeenCalledTimes(5)
})

it('marks a waiting upload and blocks resuming an upload cancelled before any bytes were written', () => {
  const { callbacks, api } = setup()
  callbacks.get('start')!('ssh', 'upload', 'a.txt', 'C:/a.txt', 'upload', '/a.txt', 'file')
  callbacks.get('conflict')!({ requestId: 'req', sessionId: 'ssh', transferId: 'upload', localPath: 'C:/a.txt', remotePath: '/a.txt' })
  expect(store.transfers.get('upload')?.waitingForConflict).toBe(true)
  callbacks.get('conflict')!(null)
  callbacks.get('error')!('ssh', 'upload', 'Cancelled', 'cancelled')
  expect(store.transfers.get('upload')?.waitingForConflict).toBe(false)
  expect(store.transfers.get('upload')?.error).toBe('已取消')
  expect(store.resumeTransfer('upload')).toBe(false)
  expect(api.sftpUpload).not.toHaveBeenCalled()
})

it('cancels tool transfers without offering file-panel resume or reporting a resumable partial file', () => {
  const { callbacks, api } = setup()
  callbacks.get('start')!('ssh', 'dl', 'app.log', 'C:/app.log', 'download', '/app.log', 'file', { source: 'ai', conversationId: 'one', threadId: 'thread' })
  store.cancelTransfer('dl')
  expect(api.sftpCancelTransfer).toHaveBeenCalledWith('dl')
  expect(store.transfers.get('dl')?.error).toBe('已取消')
  expect(canResumeTransfer(store.transfers.get('dl')!)).toBe(false)
  expect(store.resumeTransfer('dl')).toBe(false)
  expect(api.sftpDownload).not.toHaveBeenCalled()
  callbacks.get('start')!('ssh', 'manual', 'manual.log', 'C:/manual.log', 'download', '/manual.log', 'file')
  callbacks.get('error')!('ssh', 'manual', 'failed')
  expect(canResumeTransfer(store.transfers.get('manual')!)).toBe(true)
})
