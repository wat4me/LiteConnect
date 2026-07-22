import { ref, nextTick, watch, type Ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { t } from '../i18n'
import { appConfirm } from './useAppDialog'
import type { FileEntry } from '../env.d.ts'
import { canEditSftpFile, isSftpArchiveName } from '../utils/sftpEditable'
import type { DownloadConflictStrategy } from './useSftpUpload'

/**
 * Download / delete / rename / edit / extract / properties for SFTP sidebar.
 */
export function useSftpFileActions(deps: {
  sessionId: () => string
  downloadConflict: Ref<DownloadConflictStrategy>
  refresh: () => void | Promise<void>
  onDownloadQueued: () => void
  setError: (msg: string) => void
  hideContextMenu: () => void
}) {
  const showEditor = ref(false)
  const editorEntry = ref<FileEntry | null>(null)
  const showProperties = ref(false)
  const propertiesEntry = ref<FileEntry | null>(null)
  const showRename = ref(false)
  const renameEntry = ref<FileEntry | null>(null)
  const renameValue = ref('')
  const renameInputRef = ref<HTMLInputElement | null>(null)

  watch(showRename, async (val) => {
    if (val) {
      await nextTick()
      renameInputRef.value?.focus()
      renameInputRef.value?.select()
    }
  })

  function canEditFile(fileName: string): boolean {
    return canEditSftpFile(fileName)
  }

  function isArchiveName(name: string): boolean {
    return isSftpArchiveName(name)
  }

  function startDownload(entry: FileEntry, localDir?: string) {
    if (entry.isDirectory) return
    const transferId = `dl-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    window.LiteConnect.sftpDownload(deps.sessionId(), entry.path, entry.name, transferId, {
      conflict: deps.downloadConflict.value,
      localDir,
    })
    deps.onDownloadQueued()
  }

  function startDownloadMany(entries: FileEntry[], localDir?: string) {
    for (const entry of entries) {
      if (entry.isDirectory) continue
      const transferId = `dl-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
      window.LiteConnect.sftpDownload(deps.sessionId(), entry.path, entry.name, transferId, {
        conflict: deps.downloadConflict.value,
        localDir,
      })
    }
    if (entries.some((e) => !e.isDirectory)) {
      deps.onDownloadQueued()
    }
  }

  function startDownloadDir(entry: FileEntry) {
    if (!entry.isDirectory) return
    const transferId = `dl-dir-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    window.LiteConnect.sftpDownloadDirectory(deps.sessionId(), entry.path, entry.name, transferId)
    deps.onDownloadQueued()
    deps.hideContextMenu()
  }

  async function extractArchive(entry: FileEntry) {
    deps.hideContextMenu()
    if (!entry || entry.isDirectory) return
    if (!isArchiveName(entry.name)) {
      ElMessage.warning(t('sftp.unsupportedArchive'))
      return
    }
    try {
      await appConfirm({
        title: t('sftp.extractTitle'),
        message: t('sftp.extractMessage', { name: entry.name }),
        detail: t('sftp.extractDetail'),
        confirmText: t('sftp.extractConfirm'),
      })
    } catch {
      return
    }
    try {
      ElMessage.info(t('sftp.extracting'))
      await window.LiteConnect.sftpExtractArchive(deps.sessionId(), entry.path)
      ElMessage.success(t('sftp.extractDone'))
      void deps.refresh()
    } catch (err: any) {
      ElMessage.error(err?.message || t('sftp.extractFailed'))
    }
  }

  function openEditor(entry: FileEntry) {
    if (!canEditFile(entry.name)) return
    editorEntry.value = entry
    showEditor.value = true
    deps.hideContextMenu()
  }

  function closeEditor() {
    showEditor.value = false
    editorEntry.value = null
  }

  function onEditorSaved() {
    void deps.refresh()
  }

  function openProperties(entry: FileEntry) {
    propertiesEntry.value = entry
    showProperties.value = true
    deps.hideContextMenu()
  }

  function closeProperties() {
    showProperties.value = false
    propertiesEntry.value = null
  }

  function onPropertiesSaved() {
    void deps.refresh()
  }

  function startRename(entry: FileEntry) {
    deps.hideContextMenu()
    renameEntry.value = entry
    renameValue.value = entry.name
    showRename.value = true
  }

  function cancelRename() {
    showRename.value = false
    renameEntry.value = null
    renameValue.value = ''
  }

  async function confirmRename() {
    const entry = renameEntry.value
    if (!entry) return
    const newName = renameValue.value.trim()
    if (!newName || newName === entry.name) {
      cancelRename()
      return
    }
    const dir = entry.path.substring(0, entry.path.lastIndexOf('/') + 1)
    const newPath = dir + newName
    showRename.value = false
    renameEntry.value = null
    try {
      await window.LiteConnect.sftpRename(deps.sessionId(), entry.path, newPath)
      void deps.refresh()
    } catch (err: any) {
      deps.setError(err.message || t('sftp.renameFailed'))
    }
  }

  async function deleteEntry(entry: FileEntry) {
    const recursiveDir = entry.isDirectory && !entry.isSymlink
    const label = recursiveDir
      ? t('sftp.typeFolder')
      : entry.isSymlink
        ? t('sftp.typeSymlink')
        : t('sftp.typeFile')
    try {
      await appConfirm({
        title: t('sftp.deleteTitle'),
        message: t('sftp.deleteMessage', { label, name: entry.name }),
        detail: recursiveDir ? t('sftp.deleteDetailDir') : t('sftp.deleteDetail'),
        confirmText: t('common.delete'),
        danger: true,
        tone: 'danger',
      })
    } catch {
      return
    }
    try {
      await window.LiteConnect.sftpDelete(deps.sessionId(), entry.path, recursiveDir)
      ElMessage.success(t('sftp.deleted'))
      void deps.refresh()
    } catch (err: any) {
      ElMessage.error(err.message || t('sftp.deleteFailed'))
    }
  }

  async function deleteMany(entries: FileEntry[]) {
    if (entries.length === 0) return
    try {
      await appConfirm({
        title: t('sftp.batchDeleteTitle'),
        message: t('sftp.batchDeleteMessage', { count: entries.length }),
        detail: t('sftp.batchDeleteDetail'),
        confirmText: t('common.delete'),
        danger: true,
        tone: 'danger',
      })
    } catch {
      return
    }
    let failed = 0
    for (const entry of entries) {
      try {
        const recursiveDir = entry.isDirectory && !entry.isSymlink
        await window.LiteConnect.sftpDelete(deps.sessionId(), entry.path, recursiveDir)
      } catch {
        failed++
      }
    }
    if (failed === 0) ElMessage.success(t('sftp.deletedCount', { count: entries.length }))
    else ElMessage.warning(t('sftp.batchDeleteResult', { ok: entries.length - failed, failed }))
    void deps.refresh()
  }

  function openInFolder(localPath: string) {
    window.LiteConnect.shellShowItemInFolder(localPath)
  }

  return {
    showEditor,
    editorEntry,
    showProperties,
    propertiesEntry,
    showRename,
    renameEntry,
    renameValue,
    renameInputRef,
    canEditFile,
    isArchiveName,
    startDownload,
    startDownloadMany,
    startDownloadDir,
    extractArchive,
    openEditor,
    closeEditor,
    onEditorSaved,
    openProperties,
    closeProperties,
    onPropertiesSaved,
    startRename,
    cancelRename,
    confirmRename,
    deleteEntry,
    deleteMany,
    openInFolder,
  }
}
