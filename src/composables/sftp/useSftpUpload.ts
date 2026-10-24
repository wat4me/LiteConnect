import { ref, watch, type Ref } from 'vue'
import { useDragDrop, type DropUploadItem } from './useDragDrop'
import { localBaseName } from '@/utils/sftp/sftpEditable'
import { beginTransferBatch } from './useTransfers'

export type DownloadConflictStrategy = 'overwrite' | 'skip' | 'rename'

/**
 * Upload queue + drag-drop target for SFTP sidebar.
 * Host switches tab to transfers immediately; main asks only on a real conflict.
 */
export function useSftpUpload(deps: {
  sessionId: () => string
  currentPath: Ref<string>
  onQueued: (direction: 'upload') => void
  /** Surfaces a rejected drop (nothing uploadable) as a user-visible hint. */
  onDropRejected?: () => void
}) {
  const dropTargetPath = ref<string | null>(null)
  const downloadConflict = ref<DownloadConflictStrategy>('rename')

  async function loadDownloadConflict() {
    try {
      const v = await window.LiteConnect.getDownloadConflictStrategy()
      if (v === 'overwrite' || v === 'skip' || v === 'rename') {
        downloadConflict.value = v
      }
    } catch {
      downloadConflict.value = 'rename'
    }
  }

  function onDownloadConflictSettingsChange(e: Event) {
    const detail = (e as CustomEvent).detail as { strategy?: string } | undefined
    const v = detail?.strategy
    if (v === 'overwrite' || v === 'skip' || v === 'rename') {
      downloadConflict.value = v
    }
  }

  function handleItemsDropped(items: DropUploadItem[], targetPath?: string) {
    if (items.length === 0) return
    const target =
      (targetPath || dropTargetPath.value || deps.currentPath.value || '/').replace(/\/+$/, '') || '/'
    dropTargetPath.value = null
    queueItems(items, target, deps.sessionId())
  }

  function onDropTarget(path: string | null) {
    dropTargetPath.value = path
  }

  const {
    isDragOver,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    resetDragState,
  } = useDragDrop(
    handleItemsDropped,
    () => dropTargetPath.value || deps.currentPath.value || '/',
    () => deps.onDropRejected?.(),
  )

  watch(isDragOver, (v) => {
    if (!v) dropTargetPath.value = null
    else if (!dropTargetPath.value) dropTargetPath.value = deps.currentPath.value || '/'
  })

  async function pickAndUploadDirectory() {
    const sid = deps.sessionId()
    const target = deps.currentPath.value || '/'
    const dir = await window.LiteConnect.selectDirectory()
    if (!dir) return
    queueItems(
      [
        {
          name: localBaseName(dir),
          path: dir,
          isDirectory: true,
        },
      ],
      target,
      sid,
    )
  }

  function queueItems(items: DropUploadItem[], target: string, sid: string) {
    const transferIds = items.map(() => `ul-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`)
    const batchId = `ul-batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    // One toast for the whole drop; main throttles how many actually run at once.
    beginTransferBatch({
      batchId,
      sessionId: sid,
      direction: 'upload',
      transferIds,
    })
    items.forEach((item, i) => {
      const transferId = transferIds[i]
      if (item.isDirectory) {
        window.LiteConnect.sftpUploadDirectory(sid, item.path, target, item.name, transferId, {
          conflict: 'ask', batchId, batchSize: items.length,
        })
      } else {
        window.LiteConnect.sftpUpload(sid, item.path, target, item.name, transferId, { conflict: 'ask', batchId, batchSize: items.length })
      }
    })
    deps.onQueued('upload')
  }

  function bindConflictSettingsListener() {
    window.addEventListener('download-conflict-settings-change', onDownloadConflictSettingsChange)
  }

  function unbindConflictSettingsListener() {
    window.removeEventListener('download-conflict-settings-change', onDownloadConflictSettingsChange)
  }

  return {
    dropTargetPath,
    downloadConflict,
    isDragOver,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    resetDragState,
    onDropTarget,
    loadDownloadConflict,
    pickAndUploadDirectory,
    bindConflictSettingsListener,
    unbindConflictSettingsListener,
  }
}
