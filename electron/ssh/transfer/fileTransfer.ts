import * as fs from 'fs'
import * as path from 'path'
import type { ActiveTransfer, Session, SftpTransferOptions } from '../types'
import { t } from '../../i18n'
import { TransferCancelledError } from './transferHelpers'

export type FileTransferDeps = {
  getSession: (sessionId: string) => Session | undefined
  activeTransfers: Map<string, ActiveTransfer>
  destroyStreams: (transfer: ActiveTransfer) => void
}

export function sftpDownload(
  deps: FileTransferDeps,
  sessionId: string,
  remotePath: string,
  localPath: string,
  transferId: string,
  onProgress: (transferred: number, total: number) => void,
  options?: SftpTransferOptions,
): Promise<void> {
  const session = deps.getSession(sessionId)
  if (!session?.sftp) return Promise.reject(new Error(t('sftp.notInitialized')))
  const resume = options?.resume === true
  const keepPartial = options?.keepPartial !== false
  const isCancelled = options?.isCancelled ?? (() => false)

  if (isCancelled()) return Promise.reject(new TransferCancelledError())

  return new Promise((resolve, reject) => {
    // Registered before the async stat so a cancel arriving meanwhile has something to mark.
    const transfer: ActiveTransfer = { sessionId, cancelled: false, keepPartial }
    deps.activeTransfers.set(transferId, transfer)
    const cancelled = () => transfer.cancelled || isCancelled()
    const abort = (err: Error) => {
      deps.activeTransfers.delete(transferId)
      reject(err)
    }

    session.sftp!.stat(remotePath, (statErr, stats) => {
      if (cancelled()) {
        abort(new TransferCancelledError())
        return
      }
      if (statErr) {
        abort(new Error(`Stat error: ${statErr.message}`))
        return
      }

      const totalSize = stats.size || 0

      const localDir = path.dirname(localPath)
      try {
        fs.mkdirSync(localDir, { recursive: true })
      } catch (mkdirErr: any) {
        abort(new Error(`Cannot create directory: ${mkdirErr.message}`))
        return
      }

      let startOffset = 0
      if (resume && fs.existsSync(localPath)) {
        try {
          const localSize = fs.statSync(localPath).size
          if (localSize > 0 && localSize < totalSize) {
            startOffset = localSize
          } else if (localSize >= totalSize && totalSize > 0) {
            onProgress(totalSize, totalSize)
            deps.activeTransfers.delete(transferId)
            resolve()
            return
          }
        } catch {}
      }

      if (cancelled()) {
        abort(new TransferCancelledError())
        return
      }

      const readStream = session.sftp!.createReadStream(
        remotePath,
        startOffset > 0 ? { start: startOffset } : {},
      )
      const writeStream = fs.createWriteStream(
        localPath,
        startOffset > 0 ? { flags: 'a' } : {},
      )
      transfer.readStream = readStream
      transfer.writeStream = writeStream

      let transferred = startOffset
      if (startOffset > 0) onProgress(transferred, totalSize)

      let settled = false
      const settle = (err?: Error) => {
        if (settled) return
        settled = true
        deps.activeTransfers.delete(transferId)
        if (err) reject(err)
        else resolve()
      }

      readStream.on('data', (chunk: Buffer) => {
        if (isCancelled() && !transfer.cancelled) {
          transfer.cancelled = true
          deps.destroyStreams(transfer)
        }
        transferred += chunk.length
        onProgress(transferred, totalSize)
      })

      const cleanupPartial = () => {
        if (keepPartial || transfer.keepPartial) return
        try {
          fs.unlinkSync(localPath)
        } catch {}
      }

      readStream.on('error', (err: Error) => {
        writeStream.close()
        if (cancelled()) {
          settle(new TransferCancelledError())
        } else {
          cleanupPartial()
          settle(new Error(`Download error: ${err.message}`))
        }
      })

      writeStream.on('error', (err) => {
        readStream.destroy()
        settle(cancelled() ? new TransferCancelledError() : new Error(`Write error: ${err.message}`))
      })

      writeStream.on('finish', () => {
        if (cancelled()) {
          cleanupPartial()
          settle(new TransferCancelledError())
        } else {
          settle()
        }
      })

      // A cancel destroys both streams without 'finish' or 'error'; 'close' is the only signal left.
      writeStream.on('close', () => {
        if (settled) return
        if (cancelled()) {
          cleanupPartial()
          settle(new TransferCancelledError())
        } else {
          settle(new Error('Download error: local file closed before the transfer finished'))
        }
      })

      readStream.pipe(writeStream)
    })
  })
}

export function sftpUpload(
  deps: FileTransferDeps,
  sessionId: string,
  localPath: string,
  remotePath: string,
  transferId: string,
  onProgress: (transferred: number, total: number) => void,
  options?: SftpTransferOptions,
): Promise<void> {
  const session = deps.getSession(sessionId)
  if (!session?.sftp) return Promise.reject(new Error(t('sftp.notInitialized')))
  const resume = options?.resume === true
  const isCancelled = options?.isCancelled ?? (() => false)

  if (isCancelled()) return Promise.reject(new TransferCancelledError())

  return new Promise((resolve, reject) => {
    let totalSize: number
    try {
      totalSize = fs.statSync(localPath).size
    } catch (err: any) {
      reject(new Error(`Cannot read local file: ${err.message}`))
      return
    }

    // Registered up front so a cancel during the resume stat is not lost.
    const transfer: ActiveTransfer = { sessionId, cancelled: false, keepPartial: true }
    deps.activeTransfers.set(transferId, transfer)
    const cancelled = () => transfer.cancelled || isCancelled()
    const abort = (err: Error) => {
      deps.activeTransfers.delete(transferId)
      reject(err)
    }

    const startUpload = (startOffset: number) => {
      if (cancelled()) {
        abort(new TransferCancelledError())
        return
      }

      const readStream = fs.createReadStream(
        localPath,
        startOffset > 0 ? { start: startOffset } : {},
      )
      const writeStream = session.sftp!.createWriteStream(
        remotePath,
        startOffset > 0 ? { flags: 'a', start: startOffset } : {},
      )
      transfer.readStream = readStream
      transfer.writeStream = writeStream

      let transferred = startOffset
      if (startOffset > 0) onProgress(transferred, totalSize)

      let settled = false
      const settle = (err?: Error) => {
        if (settled) return
        settled = true
        deps.activeTransfers.delete(transferId)
        if (err) reject(err)
        else resolve()
      }

      readStream.on('data', (chunk: string | Buffer) => {
        if (isCancelled() && !transfer.cancelled) {
          transfer.cancelled = true
          deps.destroyStreams(transfer)
        }
        transferred += chunk.length
        onProgress(transferred, totalSize)
      })

      readStream.on('error', (err: any) => {
        writeStream.destroy()
        settle(cancelled() ? new TransferCancelledError() : new Error(`Upload read error: ${err.message}`))
      })

      writeStream.on('error', (err: any) => {
        readStream.destroy()
        settle(cancelled() ? new TransferCancelledError() : new Error(`Upload write error: ${err.message}`))
      })

      writeStream.on('close', () => {
        settle(cancelled() ? new TransferCancelledError() : undefined)
      })

      readStream.pipe(writeStream)
    }

    if (!resume) {
      startUpload(0)
      return
    }

    session.sftp!.stat(remotePath, (statErr, stats) => {
      if (cancelled()) {
        abort(new TransferCancelledError())
        return
      }
      if (!statErr && stats && stats.size > 0 && stats.size < totalSize) {
        startUpload(stats.size)
      } else if (!statErr && stats && totalSize > 0 && stats.size >= totalSize) {
        onProgress(totalSize, totalSize)
        deps.activeTransfers.delete(transferId)
        resolve()
      } else {
        startUpload(0)
      }
    })
  })
}
