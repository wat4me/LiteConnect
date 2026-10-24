export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
  modifyTime: number
  permissions: string
}

export type TransferConflictStrategy = 'overwrite' | 'skip' | 'rename'

export interface UploadTransferOptions {
  conflict?: TransferConflictStrategy | 'ask'
  /** One drop / folder selection; remembered decisions never cross batches. */
  batchId?: string
  batchSize?: number
  resume?: boolean
  remoteFullPath?: string
  concurrency?: number
  failPolicy?: 'continue' | 'stop'
}

export interface UploadConflictRequest {
  requestId: string
  transferId: string
  sessionId: string
  localPath: string
  remotePath: string
  hostName?: string
}

export interface UploadConflictDecision {
  action: TransferConflictStrategy | 'cancel'
  applyToAll: boolean
}

export type SftpPathBookmarkScope = 'connection' | 'global'

export interface SftpPathBookmark {
  id: string
  name: string
  path: string
  scope: SftpPathBookmarkScope
  /** Required for connection-scoped bookmarks; absent for global bookmarks. */
  connectionId?: string
  createdAt: number
  updatedAt: number
}

/** Present for tool transfers; ordinary file-panel transfers have no origin. */
export interface TransferOrigin {
  source: 'ai' | 'mcp'
  conversationId?: string
  threadId?: string
  hostName?: string
}

export interface TransferItem {
  id: string
  sessionId: string
  fileName: string
  localPath: string
  remotePath?: string
  /** Directory jobs cannot be resumed as a single stream. */
  kind?: 'file' | 'directory'
  transferred: number
  total: number
  status: 'downloading' | 'uploading' | 'completed' | 'error' | 'skipped' | 'partial'
  direction: 'download' | 'upload'
  error?: string
  completedFiles?: number
  failedFiles?: number
  totalFiles?: number
  /** Current phase of a recursive directory transfer. */
  phase?: 'scanning' | 'preparing' | 'transferring'
  preparedDirs?: number
  totalDirs?: number
  batchId?: string
  origin?: TransferOrigin
  waitingForConflict?: boolean
}

export interface SftpEditorSnapshot { content: string; revision: string }
export interface SftpEditorSaveOptions { revision: string; backup?: boolean }
export type SftpEditorSaveResult =
  | { status: 'conflict'; revision: string }
  | { status: 'saved'; revision: string; backupPath?: string }
export interface SftpDirectoryDiffEntry {
  name: string; localPath: string; size: number
  status: 'new' | 'changed' | 'same' | 'blocked'
}
export interface SftpDirectoryPreview {
  localPath: string; remotePath: string; entries: SftpDirectoryDiffEntry[]; skipped: number
}
