import { TransferCancelledError } from '../../shared/transferCancellation'
import { BrowserWindow, type WebContents } from 'electron'
import { onSftp, sendSftpEvent as emitTransfer } from './sftpContract'
import * as path from 'path'
import {
  isValidUUID,
  isValidTransferId,
  isStrictPath,
  isSafeLocalPath,
} from '../utils/validation'
import { SSHManager } from '../ssh/manager'
import { SettingsStore } from '../store/settingsStore'
import {
  fallbackRemoteName,
  resolveLocalConflictPath,
  joinRemote,
  nextRemoteName,
  remoteBasename,
  remoteDirname,
  sanitizeLocalName,
  type ConflictStrategy,
} from '../utils/filePaths'
import { TransferQueue } from '../ssh/transfer/transferQueue'
import type { DirTransferResult } from '../ssh/types'
import { UploadConflicts } from '../ssh/transfer/uploadConflicts'
import type { UploadTransferOptions } from '../../shared/types/sftp'

type UploadTarget = { skip: true } | { skip: false; remotePath: string; fileName: string }

function normalizeConflict(v: unknown): ConflictStrategy {
  if (v === 'overwrite' || v === 'skip' || v === 'rename') return v
  return 'rename'
}

/** Entry names come from readdir or the local FS; a separator, NUL or a dot name can never be right. */
function isValidEntryName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('\0') &&
    !name.includes('/')
  )
}

/** A cancel is reported with a code so the renderer can keep its own "cancelled" state quiet. */
function emitFailure(sender: WebContents, sessionId: string, transferId: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof TransferCancelledError) {
    emitTransfer(sender, 'sftp:transferError', sessionId, transferId, message, 'cancelled')
  } else {
    emitTransfer(sender, 'sftp:transferError', sessionId, transferId, message)
  }
}

/** A directory job that ran to the end is complete, whether or not every file made it. */
function emitDirectoryResult(
  sender: WebContents,
  sessionId: string,
  transferId: string,
  localPath: string,
  result: DirTransferResult,
): void {
  if (result.status === 'partial') {
    emitTransfer(sender, 'sftp:transferComplete', sessionId, transferId, localPath, 'partial', result.stats)
  } else {
    emitTransfer(sender, 'sftp:transferComplete', sessionId, transferId, localPath)
  }
}

type MainWindowGetter = () => BrowserWindow | null

export function registerSftpTransferHandlers(
  _getMainWindow: MainWindowGetter,
  sshManager: SSHManager,
  settingsStore: SettingsStore,
): void {
  const ensureSettingsStoreReady = () => settingsStore.init()
  // Renderer-started transfers share the directory-transfer concurrency setting, per session.
  const queue = new TransferQueue(() => settingsStore.getDirTransferConcurrency())
  /** Runs that left the queue but have not reached the runner yet (opening the channel, resolving a target). */
  const pendingRuns = new Map<string, { sessionId: string; cancelled: boolean }>()
  /** Remote paths that queued uploads are about to write; rename must never hand one out twice. */
  const claimedRemotePaths = new Map<string, Set<string>>()
  /** Upload target resolution runs one at a time per session so concurrent uploads see each other's claims. */
  const resolveChains = new Map<string, Promise<unknown>>()
  const conflicts = new UploadConflicts(cancelRun)
  const watchedOwners = new WeakSet<WebContents>()

  function cancelRun(transferId: string) {
    const pending = pendingRuns.get(transferId)
    if (pending) pending.cancelled = true
    queue.cancel(transferId)
    sshManager.cancelTransfer(transferId)
  }

  function uploadContext(sender: WebContents, sessionId: string, transferId: string, opts?: UploadTransferOptions) {
    if (!watchedOwners.has(sender)) {
      watchedOwners.add(sender)
      sender.once?.('destroyed', () => conflicts.cancelOwner(sender.id))
    }
    const batchId = isValidTransferId(opts?.batchId) ? opts.batchId : transferId
    const batchSize = Number.isInteger(opts?.batchSize) && opts!.batchSize! > 0 && opts!.batchSize! <= 100000 ? opts!.batchSize! : 1
    return conflicts.register(sender, sessionId, transferId, batchId, batchSize)
  }

  sshManager.registerSessionTeardownHook((sessionId) => {
    conflicts.cancelSession(sessionId)
    queue.cancelSession(sessionId)
    for (const pending of pendingRuns.values()) {
      if (pending.sessionId === sessionId) pending.cancelled = true
    }
    claimedRemotePaths.delete(sessionId)
    resolveChains.delete(sessionId)
  })

  const claimRemotePath = (sessionId: string, remotePath: string) => {
    const claimed = claimedRemotePaths.get(sessionId) ?? new Set<string>()
    claimed.add(remotePath)
    claimedRemotePaths.set(sessionId, claimed)
  }

  const releaseRemotePath = (sessionId: string, remotePath: string) => {
    const claimed = claimedRemotePaths.get(sessionId)
    if (!claimed) return
    claimed.delete(remotePath)
    if (claimed.size === 0) claimedRemotePaths.delete(sessionId)
  }

  const serializedPerSession = <T>(sessionId: string, fn: () => Promise<T>): Promise<T> => {
    const previous = resolveChains.get(sessionId) ?? Promise.resolve()
    const next = previous.then(fn, fn)
    resolveChains.set(sessionId, next.catch(() => undefined))
    return next
  }

  /** Where an upload lands, honouring the conflict strategy against the server and against in-flight uploads. */
  const resolveUploadTarget = async (
    sessionId: string,
    parent: string,
    fileName: string,
    conflict: ConflictStrategy,
    ask?: () => Promise<ConflictStrategy>,
  ): Promise<UploadTarget> => {
    const result = await serializedPerSession<UploadTarget | 'ask'>(sessionId, async () => {
      const wanted = joinRemote(parent, fileName)
      let exists = claimedRemotePaths.get(sessionId)?.has(wanted) ?? false
      if (!exists) {
        try {
          exists = await sshManager.sftpExists(sessionId, wanted)
        } catch (error) {
          if (ask) throw error
          // Unknown state: attempt the plain upload, as before.
        }
      }
      if (exists && ask) return 'ask'
      if (!exists || conflict === 'overwrite') {
        claimRemotePath(sessionId, wanted)
        return { skip: false, remotePath: wanted, fileName }
      }
      if (conflict === 'skip') return { skip: true }

      const dir = remoteDirname(wanted)
      let newName: string
      try {
        const listing = await sshManager.sftpReaddir(sessionId, dir)
        const names = new Set(listing.map((e) => e.name))
        for (const claimed of claimedRemotePaths.get(sessionId) ?? []) {
          if (remoteDirname(claimed) === dir) names.add(remoteBasename(claimed))
        }
        newName = nextRemoteName(names, fileName)
      } catch {
        // The target exists but its directory could not be listed: still never overwrite it.
        newName = fallbackRemoteName(fileName)
      }
      const target = joinRemote(dir, newName)
      claimRemotePath(sessionId, target)
      return { skip: false, remotePath: target, fileName: newName }
    })
    // Never hold the session's resolver lock while waiting for a person.
    if (result === 'ask') return resolveUploadTarget(sessionId, parent, fileName, await ask!())
    return result
  }

  /**
   * Queue a transfer. `run` gets `cancelledEarly` to consult right before handing the
   * transfer to the runner; any error it throws (including a cancel) is reported once.
   */
  const enqueue = (
    sender: WebContents,
    sessionId: string,
    transferId: string,
    run: (cancelledEarly: () => boolean) => Promise<void>,
    dispose?: () => void,
  ) => {
    queue.enqueue({
      sessionId,
      transferId,
      run: async () => {
        const pending = { sessionId, cancelled: false }
        pendingRuns.set(transferId, pending)
        try {
          // The channel may have died since the panel opened; reopening is a no-op while it is alive.
          await sshManager.initSftp(sessionId)
          await run(() => pending.cancelled)
        } catch (err) {
          emitFailure(sender, sessionId, transferId, err)
        } finally {
          pendingRuns.delete(transferId)
          dispose?.()
        }
      },
      onDropped: () => {
        dispose?.()
        emitFailure(sender, sessionId, transferId, new TransferCancelledError())
      },
    })
  }

  const dirOptions = (opts: Pick<UploadTransferOptions, 'concurrency' | 'failPolicy'> | undefined) => ({
    concurrency: opts?.concurrency ?? settingsStore.getDirTransferConcurrency(),
    failPolicy:
      opts?.failPolicy === 'continue' || opts?.failPolicy === 'stop'
        ? opts.failPolicy
        : settingsStore.getDirTransferFailPolicy(),
  })

  onSftp(
    'sftp:download',
    async (
      event,
      sessionId,
      remotePath,
      fileName,
      transferId,
      opts,
    ) => {
      if (!isValidUUID(sessionId)) return
      if (!isStrictPath(remotePath)) return
      if (!isValidEntryName(fileName)) return
      if (!isValidTransferId(transferId)) return
      await ensureSettingsStoreReady()

      const sender = event.sender
      const conflict = normalizeConflict(opts?.conflict)
      const resume = opts?.resume === true
      const localName = sanitizeLocalName(fileName)
      let localPath: string

      if (opts?.localPath && isSafeLocalPath(opts.localPath)) {
        localPath = opts.localPath
      } else {
        const downloadDir =
          opts?.localDir && isSafeLocalPath(opts.localDir)
            ? opts.localDir
            : settingsStore.getDownloadPath()
        const resolved = resume
          ? path.join(downloadDir, localName)
          : resolveLocalConflictPath(downloadDir, localName, conflict)
        if (resolved === null) {
          const skipped = path.join(downloadDir, localName)
          emitTransfer(sender, 'sftp:transferStart', sessionId, transferId, fileName, skipped, 'download', remotePath, 'file')
          emitTransfer(sender, 'sftp:transferComplete', sessionId, transferId, skipped, 'skipped')
          return
        }
        localPath = resolved
      }

      if (opts?.localDir && isSafeLocalPath(opts.localDir)) {
        try {
          await settingsStore.addRecentDownloadPath(opts.localDir)
        } catch {}
      }

      emitTransfer(sender, 'sftp:transferStart', sessionId, transferId, fileName, localPath, 'download', remotePath, 'file')

      enqueue(sender, sessionId, transferId, async (cancelledEarly) => {
        if (cancelledEarly()) throw new TransferCancelledError()
        await sshManager.sftpDownload(
          sessionId,
          remotePath,
          localPath,
          transferId,
          (transferred, total) => {
            emitTransfer(sender, 'sftp:transferProgress', sessionId, transferId, transferred, total)
          },
          { resume, keepPartial: true },
        )
        emitTransfer(sender, 'sftp:transferComplete', sessionId, transferId, localPath)
      })
    },
  )

  onSftp('sftp:cancelTransfer', (_event, transferId) => {
    if (!isValidTransferId(transferId)) return
    conflicts.cancelTransfer(transferId)
    if (queue.cancel(transferId)) return
    if (sshManager.cancelTransfer(transferId)) return
    // Between the queue and the runner: honoured at the run's next check.
    const pending = pendingRuns.get(transferId)
    if (pending) pending.cancelled = true
  })

  onSftp('sftp:resolveUploadConflict', (event, requestId, decision) => {
    if (typeof requestId !== 'string') return
    conflicts.respond(event.sender.id, requestId, decision)
  })

  onSftp(
    'sftp:upload',
    async (
      event,
      sessionId,
      localPath,
      remotePath,
      fileNameArg,
      transferId,
      opts,
    ) => {
      if (!isValidUUID(sessionId)) return
      if (!isSafeLocalPath(localPath)) return
      if (!isStrictPath(remotePath)) return
      if (!isValidEntryName(fileNameArg)) return
      if (!isValidTransferId(transferId)) return

      const sender = event.sender
      const conflict = normalizeConflict(opts?.conflict)
      const resume = opts?.resume === true
      const explicitTarget =
        opts?.remoteFullPath && isStrictPath(opts.remoteFullPath) ? opts.remoteFullPath : null
      const provisionalTarget = explicitTarget ?? joinRemote(remotePath, fileNameArg)
      const context = opts?.conflict === 'ask' ? uploadContext(sender, sessionId, transferId, opts) : undefined

      emitTransfer(sender, 'sftp:transferStart', sessionId, transferId, fileNameArg, localPath, 'upload', provisionalTarget, 'file')

      enqueue(sender, sessionId, transferId, async (cancelledEarly) => {
        let target = provisionalTarget
        let claimed = false
        try {
          if (cancelledEarly() || context?.isCancelled()) throw new TransferCancelledError()
          if (!resume && !explicitTarget) {
            const resolved = await resolveUploadTarget(sessionId, remotePath, fileNameArg, conflict, context
              ? () => context.ask(localPath, provisionalTarget, sshManager.getSessionSnapshot(sessionId)?.connectionName)
              : undefined)
            if (resolved.skip) {
              emitTransfer(sender, 'sftp:transferComplete', sessionId, transferId, localPath, 'skipped')
              return
            }
            target = resolved.remotePath
            claimed = true
            if (target !== provisionalTarget) {
              // Renamed: let the transfer list show the name that is actually being written.
              emitTransfer(sender, 'sftp:transferStart', sessionId, transferId, resolved.fileName, localPath, 'upload', target, 'file')
            }
          }
          if (cancelledEarly() || context?.isCancelled()) throw new TransferCancelledError()
          await sshManager.sftpUpload(
            sessionId,
            localPath,
            target,
            transferId,
            (transferred, total) => {
              emitTransfer(sender, 'sftp:transferProgress', sessionId, transferId, transferred, total)
            },
            { resume },
          )
          emitTransfer(sender, 'sftp:transferComplete', sessionId, transferId, localPath)
        } finally {
          if (claimed) releaseRemotePath(sessionId, target)
        }
      }, context?.dispose)
    },
  )

  onSftp(
    'sftp:downloadDirectory',
    async (
      event,
      sessionId,
      remotePath,
      dirName,
      transferId,
      opts,
    ) => {
      if (!isValidUUID(sessionId) || !isStrictPath(remotePath) || !isValidTransferId(transferId)) return
      if (dirName && !isValidEntryName(dirName)) return
      await ensureSettingsStoreReady()
      const sender = event.sender
      const conflict = normalizeConflict(opts?.conflict)
      const downloadDir = settingsStore.getDownloadPath()
      const displayName = dirName || path.posix.basename(remotePath) || 'download'
      const localName = sanitizeLocalName(displayName)
      // Same conflict semantics as a single file, applied to the directory root.
      const resolved = resolveLocalConflictPath(downloadDir, localName, conflict, { isDirectory: true })
      if (resolved === null) {
        const skipped = path.join(downloadDir, localName)
        emitTransfer(sender, 'sftp:transferStart', sessionId, transferId, displayName, skipped, 'download', remotePath, 'directory')
        emitTransfer(sender, 'sftp:transferComplete', sessionId, transferId, skipped, 'skipped')
        return
      }
      const localPath = resolved
      emitTransfer(sender, 'sftp:transferStart', sessionId, transferId, displayName, localPath, 'download', remotePath, 'directory')

      enqueue(sender, sessionId, transferId, async (cancelledEarly) => {
        if (cancelledEarly()) throw new TransferCancelledError()
        const result = await sshManager.sftpDownloadDirectory(
          sessionId,
          remotePath,
          localPath,
          transferId,
          (transferred, total, stats) => {
            emitTransfer(sender, 'sftp:transferProgress', sessionId, transferId, transferred, total, stats)
          },
          dirOptions(opts),
        )
        emitDirectoryResult(sender, sessionId, transferId, localPath, result)
      })
    },
  )

  onSftp(
    'sftp:uploadDirectory',
    async (
      event,
      sessionId,
      localPath,
      remoteParent,
      dirName,
      transferId,
      opts,
    ) => {
      if (!isValidUUID(sessionId) || !isSafeLocalPath(localPath) || !isStrictPath(remoteParent) || !isValidTransferId(transferId)) return
      if (!isValidEntryName(dirName)) return
      const sender = event.sender
      const conflict = normalizeConflict(opts?.conflict)
      const remotePath = joinRemote(remoteParent, dirName)
      const context = opts?.conflict === 'ask' ? uploadContext(sender, sessionId, transferId, opts) : undefined
      emitTransfer(sender, 'sftp:transferStart', sessionId, transferId, dirName, localPath, 'upload', remotePath, 'directory')

      enqueue(sender, sessionId, transferId, async (cancelledEarly) => {
        if (cancelledEarly() || context?.isCancelled()) throw new TransferCancelledError()
        const result = await sshManager.sftpUploadDirectory(
          sessionId,
          localPath,
          remotePath,
          transferId,
          (transferred, total, stats) => {
            emitTransfer(sender, 'sftp:transferProgress', sessionId, transferId, transferred, total, stats)
          },
          { conflict, ...dirOptions(opts), ...(context ? {
            onFileConflict: (local: string, remote: string, signal: AbortSignal) => context.ask(local, remote, sshManager.getSessionSnapshot(sessionId)?.connectionName, signal),
          } : {}) },
        )
        emitDirectoryResult(sender, sessionId, transferId, localPath, result)
      }, context?.dispose)
    },
  )
}
