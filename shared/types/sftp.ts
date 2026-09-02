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

export interface TransferItem {
  id: string
  sessionId: string
  fileName: string
  localPath: string
  remotePath?: string
  transferred: number
  total: number
  status: 'downloading' | 'uploading' | 'completed' | 'error' | 'skipped' | 'partial'
  direction: 'download' | 'upload'
  error?: string
  completedFiles?: number
  failedFiles?: number
  totalFiles?: number
  batchId?: string
}
