import { reactive, computed } from 'vue'
import { t } from '../i18n'
import type { TransferItem } from '../env.d.ts'
import { formatSize } from '../utils/format'

/** Shared across FileSidebar instances so badge works when sidebar is closed */
const transfers = reactive<Map<string, TransferItem>>(new Map())
const speedMap = reactive<Map<string, number>>(new Map())
let lastProgress = new Map<string, { transferred: number; time: number }>()
let listenersBound = false
let unsubFns: Array<() => void> = []

function getTransfer(sessionId: string, transferId: string): TransferItem | undefined {
  const item = transfers.get(transferId)
  return item?.sessionId === sessionId ? item : undefined
}

function addTransfer(
  sessionId: string,
  transferId: string,
  fileName: string,
  localPath: string,
  direction: 'download' | 'upload',
  remotePath?: string,
) {
  if (transfers.has(transferId)) {
    const existing = transfers.get(transferId)!
    existing.fileName = fileName
    existing.localPath = localPath
    if (remotePath) existing.remotePath = remotePath
    existing.status = direction === 'download' ? 'downloading' : 'uploading'
    existing.error = undefined
    return
  }
  transfers.set(transferId, {
    id: transferId,
    sessionId,
    fileName,
    localPath,
    remotePath,
    transferred: 0,
    total: 0,
    status: direction === 'download' ? 'downloading' : 'uploading',
    direction,
  })
  lastProgress.set(transferId, { transferred: 0, time: Date.now() })
  speedMap.set(transferId, 0)
}

function updateProgress(
  sessionId: string,
  transferId: string,
  transferred: number,
  total: number,
  stats?: { completedFiles: number; failedFiles: number; totalFiles: number },
) {
  const item = getTransfer(sessionId, transferId)
  if (item) {
    // Keep UI progress monotonic even if concurrent IPC reorders slightly
    if (transferred >= item.transferred) item.transferred = transferred
    if (total >= item.total) item.total = total
    if (stats) {
      item.completedFiles = stats.completedFiles
      item.failedFiles = stats.failedFiles
      item.totalFiles = stats.totalFiles
    }
  }
  const last = lastProgress.get(transferId)
  const now = Date.now()
  if (last && now - last.time >= 500) {
    const bytesPerMs = (transferred - last.transferred) / (now - last.time)
    speedMap.set(transferId, Math.max(0, bytesPerMs * 1000))
    lastProgress.set(transferId, { transferred, time: now })
  }
}

function markCompleted(
  sessionId: string,
  transferId: string,
  status?: 'skipped' | 'partial',
  stats?: { completedFiles: number; failedFiles: number; totalFiles: number },
) {
  const item = getTransfer(sessionId, transferId)
  if (item) {
    if (status === 'skipped') {
      item.status = 'skipped'
    } else if (status === 'partial') {
      item.status = 'partial'
      if (stats) {
        item.completedFiles = stats.completedFiles
        item.failedFiles = stats.failedFiles
        item.totalFiles = stats.totalFiles
      }
    } else {
      item.status = 'completed'
      item.transferred = item.total || item.transferred
    }
  }
  speedMap.set(transferId, 0)
  lastProgress.delete(transferId)
}

function markError(sessionId: string, transferId: string, errorMsg: string) {
  const item = getTransfer(sessionId, transferId)
  if (item) {
    item.status = 'error'
    item.error = errorMsg
  }
  speedMap.set(transferId, 0)
  lastProgress.delete(transferId)
}

/** All sessions — for toolbar badge when SFTP panel is closed */
export function getGlobalActiveTransferCount(): number {
  let count = 0
  for (const [, item] of transfers) {
    if (item.status === 'downloading' || item.status === 'uploading') count++
  }
  return count
}

export const globalActiveTransfers = computed(() => getGlobalActiveTransferCount())

/** Bind IPC listeners once (App / workspace mount). Safe to call repeatedly. */
export function ensureTransferListeners() {
  if (listenersBound) return
  listenersBound = true

  unsubFns = [
    window.LiteConnect.onTransferStart((sessionId, transferId, fileName, localPath, direction, remotePath) => {
      addTransfer(sessionId, transferId, fileName, localPath, direction, remotePath)
    }),
    window.LiteConnect.onTransferProgress((sessionId, transferId, transferred, total, stats) => {
      updateProgress(sessionId, transferId, transferred, total, stats)
    }),
    window.LiteConnect.onTransferComplete((sessionId, transferId, _localPath, status, stats) => {
      const item = transfers.get(transferId)
      markCompleted(sessionId, transferId, status, stats)
      if (item?.direction === 'upload' && status !== 'skipped') {
        window.dispatchEvent(new CustomEvent('sftp-upload-complete', { detail: { sessionId } }))
      }
      const finishedStatus =
        status === 'skipped' ? 'skipped' : status === 'partial' ? 'partial' : 'completed'
      window.dispatchEvent(new CustomEvent('sftp-transfer-finished', {
        detail: {
          sessionId,
          transferId,
          fileName: item?.fileName || '',
          direction: item?.direction || 'download',
          status: finishedStatus,
          completedFiles: stats?.completedFiles ?? item?.completedFiles,
          failedFiles: stats?.failedFiles ?? item?.failedFiles,
          totalFiles: stats?.totalFiles ?? item?.totalFiles,
        },
      }))
    }),
    window.LiteConnect.onTransferError((sessionId, transferId, errorMsg) => {
      const item = transfers.get(transferId)
      markError(sessionId, transferId, errorMsg)
      window.dispatchEvent(new CustomEvent('sftp-transfer-finished', {
        detail: {
          sessionId,
          transferId,
          fileName: item?.fileName || '',
          direction: item?.direction || 'download',
          status: 'error',
          error: errorMsg,
        },
      }))
    }),
  ]
}

export function teardownTransferListeners() {
  for (const u of unsubFns) u()
  unsubFns = []
  listenersBound = false
}

export function useTransfers(getCurrentSessionId: () => string) {
  const activeTransfers = computed(() => {
    const currentSessionId = getCurrentSessionId()
    let count = 0
    for (const [, item] of transfers) {
      if (item.sessionId === currentSessionId && (item.status === 'downloading' || item.status === 'uploading')) {
        count++
      }
    }
    return count
  })

  const downloadTransfers = computed(() => {
    const currentSessionId = getCurrentSessionId()
    const items: [string, TransferItem][] = []
    for (const [id, item] of transfers) {
      if (item.sessionId === currentSessionId && item.direction === 'download') items.push([id, item])
    }
    return items
  })

  const uploadTransfers = computed(() => {
    const currentSessionId = getCurrentSessionId()
    const items: [string, TransferItem][] = []
    for (const [id, item] of transfers) {
      if (item.sessionId === currentSessionId && item.direction === 'upload') items.push([id, item])
    }
    return items
  })

  function getSpeed(transferId: string): number {
    return speedMap.get(transferId) || 0
  }

  function cancelTransfer(transferId: string) {
    window.LiteConnect.sftpCancelTransfer(transferId)
    const item = transfers.get(transferId)
    if (item) {
      item.status = 'error'
      item.error = t('sftp.cancelledResumable')
    }
    speedMap.set(transferId, 0)
    lastProgress.delete(transferId)
  }

  function removeTransfer(transferId: string) {
    transfers.delete(transferId)
    speedMap.delete(transferId)
    lastProgress.delete(transferId)
  }

  function clearFinishedTransfers(direction?: 'download' | 'upload') {
    const currentSessionId = getCurrentSessionId()
    for (const [id, item] of transfers) {
      if (item.sessionId !== currentSessionId) continue
      if (direction && item.direction !== direction) continue
      if (item.status !== 'downloading' && item.status !== 'uploading') {
        transfers.delete(id)
        speedMap.delete(id)
        lastProgress.delete(id)
      }
      // partial / completed / error / skipped are finished
    }
  }

  /** Resume a failed/cancelled transfer if paths are known */
  function resumeTransfer(transferId: string) {
    const item = transfers.get(transferId)
    if (!item || item.status === 'downloading' || item.status === 'uploading') return false
    if (!item.localPath || !item.remotePath) return false

    const newId = `${transferId}-r-${Date.now().toString(36)}`
    const snapshot: TransferItem = {
      ...item,
      id: newId,
      status: item.direction === 'download' ? 'downloading' : 'uploading',
      error: undefined,
    }
    transfers.delete(transferId)
    transfers.set(newId, snapshot)
    lastProgress.set(newId, { transferred: snapshot.transferred, time: Date.now() })
    speedMap.set(newId, 0)
    lastProgress.delete(transferId)
    speedMap.delete(transferId)

    if (item.direction === 'download') {
      window.LiteConnect.sftpDownload(item.sessionId, item.remotePath, item.fileName, newId, {
        resume: true,
        localPath: item.localPath,
      })
    } else {
      const parent = item.remotePath.includes('/')
        ? item.remotePath.slice(0, item.remotePath.lastIndexOf('/')) || '/'
        : '/'
      window.LiteConnect.sftpUpload(
        item.sessionId,
        item.localPath,
        parent,
        item.fileName,
        newId,
        { resume: true, remoteFullPath: item.remotePath },
      )
    }
    return true
  }

  return {
    transfers,
    activeTransfers,
    downloadTransfers,
    uploadTransfers,
    addTransfer,
    updateProgress,
    markCompleted,
    markError,
    cancelTransfer,
    removeTransfer,
    clearFinishedTransfers,
    resumeTransfer,
    getSpeed,
    formatSize,
  }
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return ''
  if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`
}
