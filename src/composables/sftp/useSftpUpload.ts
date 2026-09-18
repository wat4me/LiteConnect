import { ref, watch, type Ref } from 'vue'
import { useDragDrop, type DropUploadItem } from './useDragDrop'
import { localBaseName } from '@/utils/sftp/sftpEditable'
import { beginTransferBatch } from './useTransfers'
import type { FileEntry } from '../../env.d.ts'

export type DownloadConflictStrategy = 'overwrite' | 'skip' | 'rename'

/**
 * Upload queue + drag-drop target for SFTP sidebar.
 * Host switches tab to transfers after confirm.
 */
export function useSftpUpload(deps: {
  sessionId: () => string
  currentPath: Ref<string>
  /** Listing of `currentPath`; lets the confirm dialog flag conflicts without a readdir. */
  currentFiles?: Ref<FileEntry[]>
  onQueued: (direction: 'upload') => void
  /** Surfaces a rejected drop (nothing uploadable) as a user-visible hint. */
  onDropRejected?: () => void
}) {
  const showUploadConfirm = ref(false)
  const uploadFiles = ref<DropUploadItem[]>([])
  const uploadTargetPath = ref('')
  /** Entries already inside the upload target (the drop folder, not necessarily the current one). */
  const uploadTargetFiles = ref<FileEntry[]>([])
  const dropTargetPath = ref<string | null>(null)
  const downloadConflict = ref<DownloadConflictStrategy>('rename')
  let targetListingSeq = 0

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
    uploadFiles.value = items
    uploadTargetPath.value =
      (targetPath || dropTargetPath.value || deps.currentPath.value || '/').replace(/\/+$/, '') || '/'
    dropTargetPath.value = null
    showUploadConfirm.value = true
    void loadTargetListing(uploadTargetPath.value)
  }

  /** Conflict badges must reflect the drop folder, which is not always the listed directory. */
  async function loadTargetListing(target: string) {
    const seq = ++targetListingSeq
    const current = (deps.currentPath.value || '/').replace(/\/+$/, '') || '/'
    if (target === current && deps.currentFiles) {
      uploadTargetFiles.value = deps.currentFiles.value
      return
    }
    uploadTargetFiles.value = []
    try {
      const listing = await window.LiteConnect.sftpReaddir(deps.sessionId(), target)
      if (seq !== targetListingSeq) return
      uploadTargetFiles.value = listing.filter((e) => e.name !== '.' && e.name !== '..')
    } catch {
      // Unknown listing: the dialog simply shows no "exists" badges.
    }
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
    const dir = await window.LiteConnect.selectDirectory()
    if (!dir) return
    handleItemsDropped(
      [
        {
          name: localBaseName(dir),
          path: dir,
          isDirectory: true,
        },
      ],
      deps.currentPath.value || '/',
    )
  }

  async function confirmUpload(conflict: DownloadConflictStrategy = 'rename') {
    const target = uploadTargetPath.value || deps.currentPath.value
    const sid = deps.sessionId()
    const items = uploadFiles.value
    const transferIds = items.map(() => `ul-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`)
    // One toast for the whole drop; main throttles how many actually run at once.
    beginTransferBatch({
      batchId: `ul-batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: sid,
      direction: 'upload',
      transferIds,
    })
    items.forEach((item, i) => {
      const transferId = transferIds[i]
      if (item.isDirectory) {
        window.LiteConnect.sftpUploadDirectory(sid, item.path, target, item.name, transferId, {
          conflict,
        })
      } else {
        window.LiteConnect.sftpUpload(sid, item.path, target, item.name, transferId, { conflict })
      }
    })
    showUploadConfirm.value = false
    uploadFiles.value = []
    deps.onQueued('upload')
  }

  function cancelUpload() {
    showUploadConfirm.value = false
    uploadFiles.value = []
  }

  function bindConflictSettingsListener() {
    window.addEventListener('download-conflict-settings-change', onDownloadConflictSettingsChange)
  }

  function unbindConflictSettingsListener() {
    window.removeEventListener('download-conflict-settings-change', onDownloadConflictSettingsChange)
  }

  return {
    showUploadConfirm,
    uploadFiles,
    uploadTargetPath,
    uploadTargetFiles,
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
    confirmUpload,
    cancelUpload,
    bindConflictSettingsListener,
    unbindConflictSettingsListener,
  }
}
