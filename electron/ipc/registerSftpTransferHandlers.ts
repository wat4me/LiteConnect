import { ipcMain, BrowserWindow } from 'electron'
import * as path from 'path'
import {
  isValidUUID,
  isValidTransferId,
  isStrictPath,
  isSafeLocalPath,
  safeSend,
} from '../utils/validation'
import { SSHManager } from '../ssh/manager'
import { SettingsStore } from '../store/settingsStore'
import {
  resolveLocalConflictPath,
  joinRemote,
  nextRemoteName,
  type ConflictStrategy,
} from '../utils/filePaths'

type TransferOptsPayload = {
  conflict?: ConflictStrategy
  resume?: boolean
  /** Explicit local directory for download-to-folder */
  localDir?: string
  /** Explicit full local path (resume) */
  localPath?: string
  /** Explicit full remote path (resume / rename result) */
  remoteFullPath?: string
  /** Directory transfer concurrency (1–8) */
  concurrency?: number
  /** Directory transfer: continue or stop on single-file failure */
  failPolicy?: 'continue' | 'stop'
}

function normalizeConflict(v: unknown): ConflictStrategy {
  if (v === 'overwrite' || v === 'skip' || v === 'rename') return v
  return 'rename'
}

type MainWindowGetter = () => BrowserWindow | null

export function registerSftpTransferHandlers(
  getMainWindow: MainWindowGetter,
  sshManager: SSHManager,
  settingsStore: SettingsStore,
): void {
  const ensureSettingsStoreReady = () => settingsStore.init()

  ipcMain.on(
    'sftp:download',
    async (
      _event,
      sessionId: string,
      remotePath: string,
      fileName: string,
      transferId: string,
      opts?: TransferOptsPayload,
    ) => {
      if (!isValidUUID(sessionId)) return
      if (!isStrictPath(remotePath)) return
      if (!fileName || typeof fileName !== 'string' || fileName.includes('\0') || fileName.includes('/') || fileName.includes('\\')) return
      if (!isValidTransferId(transferId)) return
      await ensureSettingsStoreReady()

      const conflict = normalizeConflict(opts?.conflict)
      const resume = opts?.resume === true
      let localPath: string

      if (opts?.localPath && isSafeLocalPath(opts.localPath)) {
        localPath = opts.localPath
      } else {
        const downloadDir =
          opts?.localDir && isSafeLocalPath(opts.localDir)
            ? opts.localDir
            : settingsStore.getDownloadPath()
        const resolved = resume
          ? path.join(downloadDir, fileName)
          : resolveLocalConflictPath(downloadDir, fileName, conflict)
        if (resolved === null) {
          safeSend(getMainWindow(), 'sftp:transferStart', sessionId, transferId, fileName, path.join(downloadDir, fileName), 'download')
          safeSend(getMainWindow(), 'sftp:transferComplete', sessionId, transferId, path.join(downloadDir, fileName), 'skipped')
          return
        }
        localPath = resolved
      }

      if (opts?.localDir && isSafeLocalPath(opts.localDir)) {
        try {
          await settingsStore.addRecentDownloadPath(opts.localDir)
        } catch {}
      }

      safeSend(getMainWindow(), 'sftp:transferStart', sessionId, transferId, fileName, localPath, 'download', remotePath)

      sshManager
        .sftpDownload(
          sessionId,
          remotePath,
          localPath,
          transferId,
          (transferred, total) => {
            safeSend(getMainWindow(), 'sftp:transferProgress', sessionId, transferId, transferred, total)
          },
          { resume, keepPartial: true },
        )
        .then(() => {
          safeSend(getMainWindow(), 'sftp:transferComplete', sessionId, transferId, localPath)
        })
        .catch((err) => {
          safeSend(getMainWindow(), 'sftp:transferError', sessionId, transferId, err.message)
        })
    },
  )

  ipcMain.on('sftp:cancelTransfer', (_event, transferId: string) => {
    if (!isValidTransferId(transferId)) return
    sshManager.cancelTransfer(transferId)
  })

  ipcMain.on(
    'sftp:upload',
    async (
      _event,
      sessionId: string,
      localPath: string,
      remotePath: string,
      fileNameArg: string,
      transferId: string,
      opts?: TransferOptsPayload,
    ) => {
      if (!isValidUUID(sessionId)) return
      if (!isSafeLocalPath(localPath)) return
      if (!isStrictPath(remotePath)) return
      if (!fileNameArg || typeof fileNameArg !== 'string' || fileNameArg.includes('\0') || fileNameArg.includes('/') || fileNameArg.includes('\\')) return
      if (!isValidTransferId(transferId)) return

      const conflict = normalizeConflict(opts?.conflict)
      const resume = opts?.resume === true
      let fileName = fileNameArg
      let fullRemotePath =
        opts?.remoteFullPath && isStrictPath(opts.remoteFullPath)
          ? opts.remoteFullPath
          : joinRemote(remotePath, fileName)

      if (!resume && !opts?.remoteFullPath) {
        try {
          const exists = await sshManager.sftpExists(sessionId, fullRemotePath)
          if (exists) {
            if (conflict === 'skip') {
              safeSend(getMainWindow(), 'sftp:transferStart', sessionId, transferId, fileName, localPath, 'upload', fullRemotePath)
              safeSend(getMainWindow(), 'sftp:transferComplete', sessionId, transferId, localPath, 'skipped')
              return
            }
            if (conflict === 'rename') {
              const parent = remotePath
              const listing = await sshManager.sftpReaddir(sessionId, parent === '' ? '/' : parent)
              const names = new Set(listing.map((e) => e.name))
              const newName = nextRemoteName(names, fileName)
              fullRemotePath = joinRemote(parent, newName)
              fileName = newName
            }
            // overwrite: keep fullRemotePath
          }
        } catch {
          // if exists check fails, proceed with overwrite attempt
        }
      }

      safeSend(getMainWindow(), 'sftp:transferStart', sessionId, transferId, fileName, localPath, 'upload', fullRemotePath)

      sshManager
        .sftpUpload(
          sessionId,
          localPath,
          fullRemotePath,
          transferId,
          (transferred, total) => {
            safeSend(getMainWindow(), 'sftp:transferProgress', sessionId, transferId, transferred, total)
          },
          { resume },
        )
        .then(() => {
          safeSend(getMainWindow(), 'sftp:transferComplete', sessionId, transferId, localPath)
        })
        .catch((err) => {
          safeSend(getMainWindow(), 'sftp:transferError', sessionId, transferId, err.message)
        })
    },
  )

  ipcMain.on(
    'sftp:downloadDirectory',
    async (
      _event,
      sessionId: string,
      remotePath: string,
      dirName: string,
      transferId: string,
      opts?: TransferOptsPayload,
    ) => {
      if (!isValidUUID(sessionId) || !isStrictPath(remotePath) || !isValidTransferId(transferId)) return
      if (dirName && (typeof dirName !== 'string' || dirName.includes('\0') || dirName.includes('/') || dirName.includes('\\'))) return
      await ensureSettingsStoreReady()
      const downloadDir = settingsStore.getDownloadPath()
      const localPath = path.join(downloadDir, dirName || path.basename(remotePath))
      safeSend(getMainWindow(), 'sftp:transferStart', sessionId, transferId, dirName, localPath, 'download')
      try {
        const result = await sshManager.sftpDownloadDirectory(
          sessionId,
          remotePath,
          localPath,
          transferId,
          (transferred, total, stats) => {
            safeSend(getMainWindow(), 'sftp:transferProgress', sessionId, transferId, transferred, total, stats)
          },
          {
            concurrency: opts?.concurrency ?? settingsStore.getDirTransferConcurrency(),
            failPolicy:
              opts?.failPolicy === 'continue' || opts?.failPolicy === 'stop'
                ? opts.failPolicy
                : settingsStore.getDirTransferFailPolicy(),
          },
        )
        if (result.status === 'partial') {
          safeSend(
            getMainWindow(),
            'sftp:transferComplete',
            sessionId,
            transferId,
            localPath,
            'partial',
            result.stats,
          )
        } else {
          safeSend(getMainWindow(), 'sftp:transferComplete', sessionId, transferId, localPath)
        }
      } catch (err: any) {
        safeSend(getMainWindow(), 'sftp:transferError', sessionId, transferId, err?.message || String(err))
      }
    },
  )

  ipcMain.on(
    'sftp:uploadDirectory',
    async (
      _event,
      sessionId: string,
      localPath: string,
      remoteParent: string,
      dirName: string,
      transferId: string,
      opts?: TransferOptsPayload,
    ) => {
      if (!isValidUUID(sessionId) || !isSafeLocalPath(localPath) || !isStrictPath(remoteParent) || !isValidTransferId(transferId)) return
      if (dirName && (typeof dirName !== 'string' || dirName.includes('\0') || dirName.includes('/') || dirName.includes('\\'))) return
      const conflict = normalizeConflict(opts?.conflict)
      const remotePath = remoteParent === '/' ? `/${dirName}` : `${remoteParent}/${dirName}`
      safeSend(getMainWindow(), 'sftp:transferStart', sessionId, transferId, dirName, localPath, 'upload', remotePath)
      try {
        const result = await sshManager.sftpUploadDirectory(
          sessionId,
          localPath,
          remotePath,
          transferId,
          (transferred, total, stats) => {
            safeSend(getMainWindow(), 'sftp:transferProgress', sessionId, transferId, transferred, total, stats)
          },
          {
            conflict,
            concurrency: opts?.concurrency ?? settingsStore.getDirTransferConcurrency(),
            failPolicy:
              opts?.failPolicy === 'continue' || opts?.failPolicy === 'stop'
                ? opts.failPolicy
                : settingsStore.getDirTransferFailPolicy(),
          },
        )
        if (result.status === 'partial') {
          safeSend(
            getMainWindow(),
            'sftp:transferComplete',
            sessionId,
            transferId,
            localPath,
            'partial',
            result.stats,
          )
        } else {
          safeSend(getMainWindow(), 'sftp:transferComplete', sessionId, transferId, localPath)
        }
      } catch (err: any) {
        safeSend(getMainWindow(), 'sftp:transferError', sessionId, transferId, err?.message || String(err))
      }
    },
  )
}
