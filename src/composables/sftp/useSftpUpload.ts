import { ref, watch, type Ref } from 'vue'
import { useDragDrop, type DropUploadItem } from './useDragDrop'
import { localBaseName } from '../utils/sftpEditable'

export type DownloadConflictStrategy = 'overwrite' | 'skip' | 'rename'

/**
 * Upload queue + drag-drop target for SFTP sidebar.
 * Host switches tab to transfers after confirm.
 */
export function useSftpUpload(deps: {
  sessionId: () => string
  currentPath: Ref<string>
  onQueued: (direction: 'upload') => void
}) {
  const showUploadConfirm = ref(false)
  const uploadFiles = ref<DropUploadItem[]>([])
  const uploadTargetPath = ref('')
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
    uploadFiles.value = items
    uploadTargetPath.value =
      (targetPath || dropTargetPath.value || deps.currentPath.value || '/').replace(/\/+$/, '') || '/'
    dropTargetPath.value = null
    showUploadConfirm.value = true
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
    for (const item of uploadFiles.value) {
      const transferId = `ul-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
      if (item.isDirectory) {
        window.LiteConnect.sftpUploadDirectory(sid, item.path, target, item.name, transferId, {
          conflict,
        })
      } else {
        window.LiteConnect.sftpUpload(sid, item.path, target, item.name, transferId, { conflict })
      }
    }
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
