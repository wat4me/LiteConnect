import { randomUUID } from 'crypto'
import { basename, dirname, join } from 'path'
import { mkdir, open, unlink } from 'node:fs/promises'
import type { TransferOrigin } from '../../shared/types/sftp'
import { TransferCancelledError } from '../../shared/transferCancellation'
import type { McpFileTransferPort, McpDownloadResult, McpDownloadSettings, McpTransferContext, McpTransferOptions } from './ports'
import { nextRemoteName, sanitizeLocalName } from '../utils/filePaths'
import { requireLocalPath } from './args'

import type { SftpEventSender } from '../../shared/ipc/sftp'

/** Tool downloads/uploads use the same progress events and cancellation as the file panel. */
export function createMcpFileTransfers(
  ssh: McpFileTransferPort,
  senderFor: (sessionId: string, context?: McpTransferContext) => SftpEventSender,
  getDownloadSettings?: () => McpDownloadSettings,
) {
  async function transfer(direction: 'download' | 'upload', sessionId: string, localPath: string, remotePath: string, options?: McpTransferOptions, skipped = false) {
    const signal = options?.signal
    if (signal?.aborted) throw new TransferCancelledError()
    const transferId = `mcp-${direction === 'download' ? 'dl' : 'ul'}-${randomUUID()}`
    const send = senderFor(sessionId, options?.transferContext)
    const context = options?.transferContext
    const origin: TransferOrigin = context
      ? { source: 'ai', conversationId: context.conversationId, threadId: context.threadId }
      : { source: 'mcp' }
    origin.hostName = ssh.getConnectionName(sessionId)
    let finished = false
    let lastSentAt = -Infinity
    let lastBytes = -1
    let latest: [number, number] | undefined
    const progress = (bytes: number, total: number) => {
      if (finished) return
      latest = [bytes, total]
      const now = Date.now()
      if (now - lastSentAt < 120 && bytes !== total) return
      lastSentAt = now
      lastBytes = bytes
      send('sftp:transferProgress', sessionId, transferId, bytes, total)
    }
    const cancel = () => { ssh.cancelTransfer(transferId) }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      const fileName = direction === 'download' ? remotePath.split('/').pop() || basename(localPath) : basename(localPath)
      send('sftp:transferStart', sessionId, transferId, fileName, localPath, direction, remotePath, 'file', origin)
      if (skipped) {
        send('sftp:transferComplete', sessionId, transferId, localPath, 'skipped')
        return
      }
      const settings = { keepPartial: false, isCancelled: () => signal?.aborted === true }
      if (direction === 'download') await ssh.sftpDownload(sessionId, remotePath, localPath, transferId, progress, settings)
      else await ssh.sftpUpload(sessionId, localPath, remotePath, transferId, progress, settings)
      if (latest && latest[0] !== lastBytes) send('sftp:transferProgress', sessionId, transferId, ...latest)
      finished = true
      send('sftp:transferComplete', sessionId, transferId, localPath)
    } catch (error) {
      finished = true
      const cancelled = error instanceof TransferCancelledError || signal?.aborted
      send('sftp:transferError', sessionId, transferId, error instanceof Error ? error.message : String(error), cancelled ? 'cancelled' : undefined)
      throw error
    } finally {
      finished = true
      signal?.removeEventListener('abort', cancel)
    }
  }

  async function download(id: string, remote: string, local: string | undefined, options?: McpTransferOptions): Promise<McpDownloadResult> {
    if (!getDownloadSettings) {
      if (!local) throw new Error('No local download directory is configured')
      await transfer('download', id, local, remote, options)
      return { localPath: local }
    }
    if (options?.signal?.aborted) throw new TransferCancelledError()
    const settings = getDownloadSettings()
    const requested = requireLocalPath(local ?? join(settings.directory, sanitizeLocalName(remote.split('/').pop() || 'download')))
    await mkdir(dirname(requested), { recursive: true })
    let target = requested
    let reserved = false
    let skipped = false
    const usedNames = new Set<string>()
    if (settings.conflict !== 'overwrite') {
      // Exclusive creation prevents two conversations choosing the same rename target.
      for (;;) {
        if (options?.signal?.aborted) throw new TransferCancelledError()
        try {
          const handle = await open(target, 'wx')
          await handle.close()
          reserved = true
          break
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          if (settings.conflict === 'skip') { skipped = true; break }
          usedNames.add(basename(target))
          target = join(dirname(requested), nextRemoteName(usedNames, basename(requested)))
        }
      }
    }
    try {
      await transfer('download', id, target, remote, options, skipped)
      return { localPath: target, ...(skipped ? { skipped: true } : {}) }
    } catch (error) {
      if (reserved) await unlink(target).catch(() => {})
      throw error
    }
  }
  return {
    download,
    upload: (id: string, local: string, remote: string, options?: McpTransferOptions) => transfer('upload', id, local, remote, options),
  }
}
