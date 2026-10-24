import type { FileEntry, TransferConflictStrategy, UploadTransferOptions, UploadConflictRequest, UploadConflictDecision, TransferOrigin } from '../types/sftp'

export interface TransferProgressStats {
  completedFiles: number
  failedFiles: number
  totalFiles: number
  phase?: 'scanning' | 'preparing' | 'transferring'
  preparedDirs?: number
  totalDirs?: number
}

export interface SftpEventArgs {
  'sftp:transferStart': [sessionId: string, transferId: string, fileName: string, localPath: string, direction: 'download' | 'upload', remotePath?: string, kind?: 'file' | 'directory', origin?: TransferOrigin]
  'sftp:transferProgress': [sessionId: string, transferId: string, transferred: number, total: number, stats?: TransferProgressStats]
  'sftp:transferComplete': [sessionId: string, transferId: string, localPath: string, status?: 'skipped' | 'partial', stats?: Pick<TransferProgressStats, 'completedFiles' | 'failedFiles' | 'totalFiles'>]
  'sftp:transferError': [sessionId: string, transferId: string, error: string, code?: 'cancelled']
  'sftp:uploadConflict': [request: UploadConflictRequest | null]
}

export type SftpEventSender = <K extends keyof SftpEventArgs>(channel: K, ...args: SftpEventArgs[NoInfer<K>]) => void
type Subscribe<K extends keyof SftpEventArgs> = (callback: (...args: SftpEventArgs[K]) => void) => () => void

/** Public bridge contract; existing method names and positional arguments are stable. */
export interface SftpApi {
  sftpInit: (sessionId: string) => Promise<void>
  sftpReaddir: (sessionId: string, remotePath: string) => Promise<FileEntry[]>
  sftpRealpath: (sessionId: string, remotePath: string) => Promise<string>
  sftpExecHome: (sessionId: string) => Promise<string>
  sftpDownload: (
    sessionId: string,
    remotePath: string,
    fileName: string,
    transferId: string,
    options?: {
      conflict?: TransferConflictStrategy
      resume?: boolean
      localDir?: string
      localPath?: string
    },
  ) => void
  sftpUpload: (
    sessionId: string,
    localPath: string,
    remotePath: string,
    fileName: string,
    transferId: string,
    options?: UploadTransferOptions,
  ) => void
  sftpCancelTransfer: (transferId: string) => void
  sftpExtractArchive: (sessionId: string, remotePath: string) => Promise<{ ok: boolean; output?: string }>
  sftpExists: (sessionId: string, remotePath: string) => Promise<boolean>
  sftpEditorSnapshot: (sessionId: string, remotePath: string) => Promise<import('../types/sftp').SftpEditorSnapshot>
  sftpEditorSave: (sessionId: string, remotePath: string, content: string, options: import('../types/sftp').SftpEditorSaveOptions) => Promise<import('../types/sftp').SftpEditorSaveResult>
  sftpDirectoryPreview: (sessionId: string, localPath: string, remotePath: string) => Promise<import('../types/sftp').SftpDirectoryPreview>
  sftpReadFile: (sessionId: string, remotePath: string) => Promise<string>
  sftpWriteFile: (sessionId: string, remotePath: string, content: string) => Promise<void>
  sftpChmod: (sessionId: string, remotePath: string, mode: string, recursive?: boolean) => Promise<void>
  sftpChown: (sessionId: string, remotePath: string, owner: string, group?: string, recursive?: boolean) => Promise<void>
  sftpRename: (sessionId: string, oldPath: string, newPath: string) => Promise<void>
  sftpMkdir: (sessionId: string, remotePath: string) => Promise<void>
  sftpDelete: (sessionId: string, remotePath: string, isDirectory?: boolean) => Promise<void>
  sftpDownloadDirectory: (
    sessionId: string,
    remotePath: string,
    dirName: string,
    transferId: string,
    options?: {
      conflict?: TransferConflictStrategy
      concurrency?: number
      failPolicy?: 'continue' | 'stop'
    },
  ) => void
  sftpUploadDirectory: (
    sessionId: string,
    localPath: string,
    remoteParent: string,
    dirName: string,
    transferId: string,
    options?: UploadTransferOptions,
  ) => void
  resolveUploadConflict: (requestId: string, decision: UploadConflictDecision) => void
  onUploadConflict: Subscribe<'sftp:uploadConflict'>
  sftpStat: (sessionId: string, remotePath: string) => Promise<{
    mode: string
    size: number
    uid: number
    gid: number
    atime: number
    mtime: number
    owner: string
    group: string
    isDirectory: boolean
  }>

  onTransferStart: Subscribe<'sftp:transferStart'>
  onTransferProgress: Subscribe<'sftp:transferProgress'>
  onTransferComplete: Subscribe<'sftp:transferComplete'>
  onTransferError: Subscribe<'sftp:transferError'>
}

export interface SftpInvokeContract {
  'sftp:init': SftpApi['sftpInit']
  'sftp:readdir': SftpApi['sftpReaddir']
  'sftp:realpath': SftpApi['sftpRealpath']
  'sftp:execHome': SftpApi['sftpExecHome']
  'sftp:extractArchive': SftpApi['sftpExtractArchive']
  'sftp:exists': SftpApi['sftpExists']
  'sftp:editorSnapshot': SftpApi['sftpEditorSnapshot']
  'sftp:editorSave': SftpApi['sftpEditorSave']
  'sftp:directoryPreview': SftpApi['sftpDirectoryPreview']
  'sftp:readFile': SftpApi['sftpReadFile']
  'sftp:writeFile': SftpApi['sftpWriteFile']
  'sftp:chmod': SftpApi['sftpChmod']
  'sftp:chown': SftpApi['sftpChown']
  'sftp:rename': SftpApi['sftpRename']
  'sftp:mkdir': SftpApi['sftpMkdir']
  'sftp:delete': SftpApi['sftpDelete']
  'sftp:stat': SftpApi['sftpStat']
}

export interface SftpSendContract {
  'sftp:download': SftpApi['sftpDownload']
  'sftp:upload': SftpApi['sftpUpload']
  'sftp:downloadDirectory': SftpApi['sftpDownloadDirectory']
  'sftp:uploadDirectory': SftpApi['sftpUploadDirectory']
  'sftp:cancelTransfer': SftpApi['sftpCancelTransfer']
  'sftp:resolveUploadConflict': SftpApi['resolveUploadConflict']
}
