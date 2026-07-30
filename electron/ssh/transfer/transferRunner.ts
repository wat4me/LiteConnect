import * as fs from 'fs'
import * as path from 'path'
import type {
  ActiveTransfer,
  DirTransferOptions,
  DirTransferProgressStats,
  DirTransferResult,
  Session,
  SftpTransferOptions,
  TransferConflictStrategy,
} from '../types'
import { joinRemote, nextRemoteName, remoteBasename, remoteDirname } from '../../utils/filePaths'
import type { FileEntry } from '../types'
import { t } from '../../i18n'
import {
  DEFAULT_DIR_TRANSFER_CONCURRENCY,
  joinRemoteRelative,
  MonotonicByteProgress,
  runPool,
  sanitizeTransferError,
  TransferCancelledError,
  walkLocalTree,
} from './transferHelpers'
import type { DirProgressCallback } from './transferHelpers'

export type SftpOps = {
  initSftp: (sessionId: string) => Promise<void>
  sftpReaddir: (sessionId: string, remotePath: string) => Promise<FileEntry[]>
  sftpExists: (sessionId: string, remotePath: string) => Promise<boolean>
  sftpMkdir: (sessionId: string, remotePath: string) => Promise<void>
}

function clampConcurrency(n: number | undefined): number {
  const v = n ?? DEFAULT_DIR_TRANSFER_CONCURRENCY
  if (!Number.isFinite(v)) return DEFAULT_DIR_TRANSFER_CONCURRENCY
  return Math.max(1, Math.min(8, Math.round(v)))
}

export class TransferRunner {
  private activeTransfers: Map<string, ActiveTransfer> = new Map()

  constructor(
    private getSession: (sessionId: string) => Session | undefined,
    private sftpOps: SftpOps,
  ) {}

  get map(): Map<string, ActiveTransfer> {
    return this.activeTransfers
  }

  private destroyStreams(transfer: ActiveTransfer) {
    try {
      transfer.readStream?.destroy()
    } catch {}
    try {
      transfer.writeStream?.destroy()
    } catch {}
  }

  /** Cancel streams; directory parents stay in the map until their finally block. */
  private cancelOne(transferId: string, transfer: ActiveTransfer, removeParent: boolean) {
    transfer.cancelled = true
    this.destroyStreams(transfer)
    if (transfer.childIds) {
      for (const childId of [...transfer.childIds]) {
        const child = this.activeTransfers.get(childId)
        if (child) {
          child.cancelled = true
          this.destroyStreams(child)
          this.activeTransfers.delete(childId)
        }
      }
      transfer.childIds.clear()
      if (removeParent) this.activeTransfers.delete(transferId)
      return
    }
    this.activeTransfers.delete(transferId)
  }

  cancelTransfer(transferId: string) {
    const transfer = this.activeTransfers.get(transferId)
    if (transfer) {
      // Keep directory parent entry so cooperative isCancelled closures remain consistent
      this.cancelOne(transferId, transfer, !transfer.childIds)
      return
    }
    for (const [parentId, parent] of this.activeTransfers) {
      if (parent.childIds?.has(transferId)) {
        this.cancelOne(parentId, parent, false)
        return
      }
    }
  }

  cancelTransfersForSession(sessionId: string) {
    for (const [transferId, transfer] of [...this.activeTransfers]) {
      if (transfer.sessionId !== sessionId) continue
      this.cancelOne(transferId, transfer, true)
    }
  }

  cancelAll() {
    for (const [transferId, transfer] of [...this.activeTransfers]) {
      this.cancelOne(transferId, transfer, true)
    }
    this.activeTransfers.clear()
  }

  private registerDirJob(sessionId: string, transferId: string): ActiveTransfer {
    const job: ActiveTransfer = {
      sessionId,
      cancelled: false,
      keepPartial: true,
      childIds: new Set(),
    }
    this.activeTransfers.set(transferId, job)
    return job
  }

  private trackChild(parentId: string, childId: string) {
    const parent = this.activeTransfers.get(parentId)
    parent?.childIds?.add(childId)
  }

  private untrackChild(parentId: string, childId: string) {
    const parent = this.activeTransfers.get(parentId)
    parent?.childIds?.delete(childId)
  }

  sftpDownload(
    sessionId: string,
    remotePath: string,
    localPath: string,
    transferId: string,
    onProgress: (transferred: number, total: number) => void,
    options?: SftpTransferOptions,
  ): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session?.sftp) return Promise.reject(new Error(t('sftp.notInitialized')))
    const resume = options?.resume === true
    const keepPartial = options?.keepPartial !== false
    const isCancelled = options?.isCancelled ?? (() => false)

    if (isCancelled()) return Promise.reject(new TransferCancelledError())

    return new Promise((resolve, reject) => {
      session.sftp!.stat(remotePath, (statErr, stats) => {
        if (isCancelled()) {
          reject(new TransferCancelledError())
          return
        }
        if (statErr) {
          reject(new Error(`Stat error: ${statErr.message}`))
          return
        }

        const totalSize = stats.size || 0

        const localDir = path.dirname(localPath)
        try {
          fs.mkdirSync(localDir, { recursive: true })
        } catch (mkdirErr: any) {
          reject(new Error(`Cannot create directory: ${mkdirErr.message}`))
          return
        }

        if (isCancelled()) {
          reject(new TransferCancelledError())
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
              resolve()
              return
            }
          } catch {}
        }

        if (isCancelled()) {
          reject(new TransferCancelledError())
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

        const transfer: ActiveTransfer = {
          sessionId,
          readStream,
          writeStream,
          cancelled: false,
          keepPartial,
        }
        this.activeTransfers.set(transferId, transfer)

        // Parent cancelled between stream create and map insert
        if (isCancelled()) {
          transfer.cancelled = true
          this.destroyStreams(transfer)
          this.activeTransfers.delete(transferId)
          reject(new TransferCancelledError())
          return
        }

        let transferred = startOffset
        if (startOffset > 0) onProgress(transferred, totalSize)

        readStream.on('data', (chunk: Buffer) => {
          if (isCancelled() && !transfer.cancelled) {
            transfer.cancelled = true
            this.destroyStreams(transfer)
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
          this.activeTransfers.delete(transferId)
          writeStream.close()
          if (!transfer.cancelled && !isCancelled()) {
            cleanupPartial()
            reject(new Error(`Download error: ${err.message}`))
          } else {
            reject(new TransferCancelledError())
          }
        })

        writeStream.on('error', (err) => {
          this.activeTransfers.delete(transferId)
          readStream.destroy()
          if (!transfer.cancelled && !isCancelled()) {
            reject(new Error(`Write error: ${err.message}`))
          } else {
            reject(new TransferCancelledError())
          }
        })

        writeStream.on('finish', () => {
          this.activeTransfers.delete(transferId)
          if (transfer.cancelled || isCancelled()) {
            cleanupPartial()
            reject(new TransferCancelledError())
          } else {
            resolve()
          }
        })

        readStream.pipe(writeStream)
      })
    })
  }

  sftpUpload(
    sessionId: string,
    localPath: string,
    remotePath: string,
    transferId: string,
    onProgress: (transferred: number, total: number) => void,
    options?: SftpTransferOptions,
  ): Promise<void> {
    const session = this.getSession(sessionId)
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

      const startUpload = (startOffset: number) => {
        if (isCancelled()) {
          reject(new TransferCancelledError())
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

        const transfer: ActiveTransfer = {
          sessionId,
          readStream,
          writeStream,
          cancelled: false,
          keepPartial: true,
        }
        this.activeTransfers.set(transferId, transfer)

        if (isCancelled()) {
          transfer.cancelled = true
          this.destroyStreams(transfer)
          this.activeTransfers.delete(transferId)
          reject(new TransferCancelledError())
          return
        }

        let transferred = startOffset
        if (startOffset > 0) onProgress(transferred, totalSize)

        readStream.on('data', (chunk: string | Buffer) => {
          if (isCancelled() && !transfer.cancelled) {
            transfer.cancelled = true
            this.destroyStreams(transfer)
          }
          transferred += chunk.length
          onProgress(transferred, totalSize)
        })

        readStream.on('error', (err: any) => {
          this.activeTransfers.delete(transferId)
          writeStream.destroy()
          if (!transfer.cancelled && !isCancelled()) {
            reject(new Error(`Upload read error: ${err.message}`))
          } else {
            reject(new TransferCancelledError())
          }
        })

        writeStream.on('error', (err: any) => {
          this.activeTransfers.delete(transferId)
          readStream.destroy()
          if (!transfer.cancelled && !isCancelled()) {
            reject(new Error(`Upload write error: ${err.message}`))
          } else {
            reject(new TransferCancelledError())
          }
        })

        writeStream.on('close', () => {
          this.activeTransfers.delete(transferId)
          if (transfer.cancelled || isCancelled()) {
            reject(new TransferCancelledError())
          } else {
            resolve()
          }
        })

        readStream.pipe(writeStream)
      }

      if (!resume) {
        startUpload(0)
        return
      }

      session.sftp!.stat(remotePath, (statErr, stats) => {
        if (isCancelled()) {
          reject(new TransferCancelledError())
          return
        }
        if (!statErr && stats && stats.size > 0 && stats.size < totalSize) {
          startUpload(stats.size)
        } else if (!statErr && stats && totalSize > 0 && stats.size >= totalSize) {
          onProgress(totalSize, totalSize)
          resolve()
        } else {
          startUpload(0)
        }
      })
    })
  }

  /** Explicit-queue remote tree walk (no deep recursion stack). */
  private async walkRemoteTree(
    sessionId: string,
    remoteRoot: string,
    localRoot: string,
    isCancelled: () => boolean,
  ): Promise<{
    items: Array<{ remote: string; local: string; isDir: boolean; size: number }>
    total: number
  }> {
    type Item = { remote: string; local: string; isDir: boolean; size: number }
    const items: Item[] = []
    let total = 0
    const queue: Array<{ remote: string; local: string }> = [{ remote: remoteRoot, local: localRoot }]

    while (queue.length > 0) {
      if (isCancelled()) throw new TransferCancelledError()
      const { remote: rDir, local: lDir } = queue.shift()!
      const list = await this.sftpOps.sftpReaddir(sessionId, rDir)
      for (const e of list) {
        if (isCancelled()) throw new TransferCancelledError()
        if (e.name === '.' || e.name === '..') continue
        if (e.isSymlink) continue
        const lChild = path.join(lDir, e.name)
        if (e.isDirectory) {
          items.push({ remote: e.path, local: lChild, isDir: true, size: 0 })
          queue.push({ remote: e.path, local: lChild })
        } else {
          const size = e.size || 0
          total += size
          items.push({ remote: e.path, local: lChild, isDir: false, size })
        }
      }
    }
    return { items, total }
  }

  async sftpDownloadDirectory(
    sessionId: string,
    remotePath: string,
    localPath: string,
    transferId: string,
    onProgress: DirProgressCallback,
    options?: DirTransferOptions,
  ): Promise<DirTransferResult> {
    const session = this.getSession(sessionId)
    if (!session?.sftp) throw new Error(t('sftp.notInitialized'))

    const concurrency = clampConcurrency(options?.concurrency)
    const failPolicy = options?.failPolicy ?? 'stop'
    const job = this.registerDirJob(sessionId, transferId)
    const parentCancel = () => job.cancelled

    try {
      await fs.promises.mkdir(localPath, { recursive: true })

      const walked = await this.walkRemoteTree(sessionId, remotePath, localPath, parentCancel)
      if (job.cancelled) throw new TransferCancelledError()

      const dirs = walked.items.filter((i) => i.isDir)
      const files = walked.items.filter((i) => !i.isDir)
      const total = walked.total

      const progress = new MonotonicByteProgress(total)
      let completedFiles = 0
      let failedFiles = 0
      const totalFiles = files.length

      const emit = () => {
        const stats: DirTransferProgressStats = {
          completedFiles,
          failedFiles,
          totalFiles,
        }
        onProgress(progress.current, progress.total, stats)
      }
      emit()

      for (const d of dirs) {
        if (job.cancelled) throw new TransferCancelledError()
        await fs.promises.mkdir(d.local, { recursive: true })
      }

      await runPool(
        files,
        async (item) => {
          if (job.cancelled) throw new TransferCancelledError()
          const subId = `${transferId}-${Math.random().toString(36).slice(2, 8)}`
          this.trackChild(transferId, subId)
          let lastFile = 0
          try {
            await this.sftpDownload(
              sessionId,
              item.remote,
              item.local,
              subId,
              (tBytes) => {
                const delta = tBytes - lastFile
                lastFile = tBytes
                progress.add(delta)
                emit()
              },
              { isCancelled: parentCancel },
            )
            completedFiles++
            emit()
          } catch (err) {
            if (
              job.cancelled ||
              err instanceof TransferCancelledError ||
              (err instanceof Error && err.message === 'Transfer cancelled')
            ) {
              throw new TransferCancelledError()
            }
            failedFiles++
            emit()
            throw err instanceof Error ? err : new Error(String(err))
          } finally {
            this.untrackChild(transferId, subId)
          }
        },
        {
          concurrency,
          isCancelled: parentCancel,
          stopOnError: failPolicy === 'stop',
        },
      )

      if (job.cancelled) throw new TransferCancelledError()

      const stats: DirTransferProgressStats = {
        completedFiles,
        failedFiles,
        totalFiles,
      }

      if (failedFiles > 0 && failPolicy === 'continue') {
        emit()
        if (completedFiles === 0) {
          throw new Error(sanitizeTransferError(new Error(`All ${failedFiles} file(s) failed`)))
        }
        return { status: 'partial', stats }
      }
      progress.complete()
      emit()
      return { status: 'completed', stats }
    } catch (err) {
      if (job.cancelled || err instanceof TransferCancelledError) {
        throw new TransferCancelledError()
      }
      throw new Error(sanitizeTransferError(err))
    } finally {
      this.activeTransfers.delete(transferId)
    }
  }

  async sftpUploadDirectory(
    sessionId: string,
    localPath: string,
    remotePath: string,
    transferId: string,
    onProgress: DirProgressCallback,
    options?: DirTransferOptions,
  ): Promise<DirTransferResult> {
    if (!this.getSession(sessionId)?.sftp) {
      await this.sftpOps.initSftp(sessionId)
    }
    const session = this.getSession(sessionId)
    if (!session?.sftp) throw new Error(t('sftp.notInitialized'))

    const conflict: TransferConflictStrategy = options?.conflict || 'rename'
    const concurrency = clampConcurrency(options?.concurrency)
    const failPolicy = options?.failPolicy ?? 'stop'
    const job = this.registerDirJob(sessionId, transferId)
    const parentCancel = () => job.cancelled

    try {
      let rootRemote = remotePath
      if (conflict === 'rename') {
        const rootExists = await this.sftpOps.sftpExists(sessionId, rootRemote)
        if (rootExists) {
          const parent = rootRemote.includes('/')
            ? rootRemote.slice(0, rootRemote.lastIndexOf('/')) || '/'
            : '/'
          const base = rootRemote.split('/').pop() || 'upload'
          try {
            const listing = await this.sftpOps.sftpReaddir(sessionId, parent)
            const names = new Set(listing.map((e) => e.name))
            const newName = nextRemoteName(names, base)
            rootRemote = joinRemote(parent, newName)
          } catch {
            rootRemote = `${rootRemote}_1`
          }
        }
      }

      try {
        await this.sftpOps.sftpMkdir(sessionId, rootRemote)
      } catch {
        // may already exist (overwrite/skip merge)
      }

      const walked = await walkLocalTree(localPath, {
        isCancelled: parentCancel,
      })

      if (job.cancelled) throw new TransferCancelledError()

      const dirRels = [...walked.dirs]
        .map((d) => d.relativePosix)
        .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))

      for (const rel of dirRels) {
        if (job.cancelled) throw new TransferCancelledError()
        const rp = joinRemoteRelative(rootRemote, rel)
        try {
          await this.sftpOps.sftpMkdir(sessionId, rp)
        } catch {}
      }

      const files = walked.files.map((f) => ({
        local: f.localPath,
        remote: joinRemoteRelative(rootRemote, f.relativePosix),
        size: f.size,
      }))

      const total = walked.totalSize
      const progress = new MonotonicByteProgress(total)
      let completedFiles = 0
      let failedFiles = 0
      const totalFiles = files.length

      const emit = () => {
        onProgress(progress.current, progress.total, {
          completedFiles,
          failedFiles,
          totalFiles,
        })
      }
      emit()

      const ensured = new Set<string>([rootRemote, ...dirRels.map((r) => joinRemoteRelative(rootRemote, r))])
      const dirListingCache = new Map<string, Set<string>>()
      let conflictChain: Promise<void> = Promise.resolve()

      const ensureDir = async (remoteDir: string) => {
        if (ensured.has(remoteDir) || remoteDir === '/' || !remoteDir) return
        const parent = remoteDir.substring(0, remoteDir.lastIndexOf('/')) || '/'
        if (parent !== remoteDir) await ensureDir(parent)
        if (ensured.has(remoteDir)) return
        try {
          await this.sftpOps.sftpMkdir(sessionId, remoteDir)
        } catch {}
        ensured.add(remoteDir)
      }

      const namesInDir = async (dir: string): Promise<Set<string>> => {
        if (dirListingCache.has(dir)) return dirListingCache.get(dir)!
        try {
          const listing = await this.sftpOps.sftpReaddir(sessionId, dir)
          const set = new Set(listing.map((e) => e.name))
          dirListingCache.set(dir, set)
          return set
        } catch {
          const set = new Set<string>()
          dirListingCache.set(dir, set)
          return set
        }
      }

      const resolveRemoteTarget = async (
        localFile: string,
        remoteFile: string,
      ): Promise<{ remote: string; skip: boolean; skipSize: number }> => {
        const dir = remoteDirname(remoteFile)
        const baseName = remoteBasename(remoteFile)
        await ensureDir(dir)

        const exists = await this.sftpOps.sftpExists(sessionId, remoteFile)
        if (!exists) return { remote: remoteFile, skip: false, skipSize: 0 }

        if (conflict === 'skip') {
          let skipSize = 0
          try {
            skipSize = fs.statSync(localFile).size
          } catch {}
          return { remote: remoteFile, skip: true, skipSize }
        }

        if (conflict === 'rename') {
          return new Promise((resolve, reject) => {
            conflictChain = conflictChain
              .then(async () => {
                const names = await namesInDir(dir)
                const newName = nextRemoteName(names, baseName)
                names.add(newName)
                resolve({ remote: joinRemote(dir, newName), skip: false, skipSize: 0 })
              })
              .catch((e) => {
                reject(e)
              })
          })
        }

        return { remote: remoteFile, skip: false, skipSize: 0 }
      }

      await runPool(
        files,
        async (f) => {
          if (job.cancelled) throw new TransferCancelledError()
          const target = await resolveRemoteTarget(f.local, f.remote)
          if (target.skip) {
            progress.add(target.skipSize)
            completedFiles++
            emit()
            return
          }

          const subId = `${transferId}-${Math.random().toString(36).slice(2, 8)}`
          this.trackChild(transferId, subId)
          let lastFile = 0
          try {
            await this.sftpUpload(
              sessionId,
              f.local,
              target.remote,
              subId,
              (tBytes) => {
                const delta = tBytes - lastFile
                lastFile = tBytes
                progress.add(delta)
                emit()
              },
              { isCancelled: parentCancel },
            )
            completedFiles++
            const dir = remoteDirname(target.remote)
            const names = dirListingCache.get(dir)
            if (names) names.add(remoteBasename(target.remote))
            emit()
          } catch (err) {
            if (
              job.cancelled ||
              err instanceof TransferCancelledError ||
              (err instanceof Error && err.message === 'Transfer cancelled')
            ) {
              throw new TransferCancelledError()
            }
            failedFiles++
            emit()
            throw err instanceof Error ? err : new Error(String(err))
          } finally {
            this.untrackChild(transferId, subId)
          }
        },
        {
          concurrency,
          isCancelled: parentCancel,
          stopOnError: failPolicy === 'stop',
        },
      )

      if (job.cancelled) throw new TransferCancelledError()

      const stats: DirTransferProgressStats = {
        completedFiles,
        failedFiles,
        totalFiles,
      }

      if (failedFiles > 0 && failPolicy === 'continue') {
        emit()
        if (completedFiles === 0) {
          throw new Error(sanitizeTransferError(new Error(`All ${failedFiles} file(s) failed`)))
        }
        return { status: 'partial', stats }
      }
      progress.complete()
      emit()
      return { status: 'completed', stats }
    } catch (err) {
      if (job.cancelled || err instanceof TransferCancelledError) {
        throw new TransferCancelledError()
      }
      throw new Error(sanitizeTransferError(err))
    } finally {
      this.activeTransfers.delete(transferId)
    }
  }
}
