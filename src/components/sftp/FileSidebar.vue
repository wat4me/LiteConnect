<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { FileEntry } from '../../env.d.ts'
import type { SftpPathBookmark } from '@shared/types/sftp'
import { useSftpNavigation } from '../../composables/sftp/useSftpNavigation'
import { useSftpBookmarkActions } from '../../composables/sftp/useSftpBookmarkActions'
import { useSftpDirTree } from '../../composables/sftp/useSftpDirTree'
import { useTransfers, ensureTransferListeners } from '../../composables/sftp/useTransfers'
import { useContextMenu } from '@/composables/shared/useContextMenu'
import { useSessionState } from '../../composables/session/useSessionState'
import {
  registerSftpResource,
  unregisterSftpResource,
} from '@/composables/app/rendererResourceRegistry'
import { useSftpUpload } from '../../composables/sftp/useSftpUpload'
import { useSftpFileActions } from '../../composables/sftp/useSftpFileActions'
import {
  clearSftpFollowPausedByContainer,
  isSftpFollowPausedByContainer,
} from '../../composables/sftp/sftpFollowPause'
import type { TerminalPwdTracker } from '@/domain/terminal/types'
import SftpDirTree from './SftpDirTree.vue'
import SftpToolbar from './SftpToolbar.vue'
import SftpPathBar from './SftpPathBar.vue'
import SftpContextMenu from './SftpContextMenu.vue'
import TransferList from './TransferList.vue'
import UploadConfirmModal from './UploadConfirmModal.vue'
import FileEditorModal from './FileEditorModal.vue'
import FilePropertiesModal from './FilePropertiesModal.vue'
import AppIcon from '../icons/AppIcon.vue'

const { t } = useI18n()
const fileListRef = ref<InstanceType<typeof SftpDirTree> | null>(null)

const props = defineProps<{
  sessionId: string
  connectionId: string
  connectionName: string
  terminalLabel: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

type TabType = 'files' | 'transfers'

const activeTab = ref<TabType>('files')
const transferDirection = ref<'download' | 'upload'>('download')
const transferStatus = ref<'all' | 'active' | 'completed' | 'error'>('all')
const transferStatusFilters = computed(() => [
  { id: 'all' as const, label: t('sftp.filterAll') },
  { id: 'active' as const, label: t('sftp.filterActive') },
  { id: 'completed' as const, label: t('sftp.filterCompleted') },
  { id: 'error' as const, label: t('sftp.filterError') },
])
const pwdTracker = inject<TerminalPwdTracker>('pwdTracker')!

const {
  currentPath,
  files,
  loading,
  error,
  sftpReady,
  pathInput,
  showPathInput,
  homePath,
  shellHomePath,
  terminalPath,
  lastPathDebug,
  followTerminalPath,
  previousTerminalPath,
  initSftp,
  loadDirectory,
  navigateTo,
  syncCwd,
  syncCwdForce,
  toggleFollowTerminalPath,
  submitPathInput,
  togglePathInput,
  refresh,
  recoverAfterReconnect,
  resolvePath,
  cleanRemotePath,
} = useSftpNavigation(() => props.sessionId, pwdTracker)

const {
  pathBookmarks,
  currentConnectionBookmark,
  bookmarkError,
  addPathBookmark,
  toggleCurrentPathBookmark,
  handleAddBookmark,
  handleRenameBookmark,
  handleRemoveBookmark,
  handleMoveBookmark,
  handleEditBookmarkPath,
  handleReorderBookmark,
} = useSftpBookmarkActions(() => props.connectionId, currentPath)

async function handleOpenBookmark(bookmark: SftpPathBookmark): Promise<void> {
  await runExclusive(async () => {
    if (followTerminalPath.value) {
      followTerminalPath.value = false
      ElMessage.info(t('sftp.followPausedBookmark'))
    }
    await loadDirectory(bookmark.path)
    saveCurrentState()
  })
}

/** In-flight guard for toolbar / path actions (covers tree refresh after readdir). */
const actionBusy = ref(false)
/** Click lock only — do not drive toolbar opacity (that made the whole bar flash). */
const actionLocked = computed(() => loading.value || actionBusy.value)

/** Latest queued toolbar action while one is in flight (do not drop locate/follow). */
let pendingExclusive: (() => Promise<void>) | null = null

async function waitWhileLoading(): Promise<void> {
  while (loading.value) {
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** Serialize toolbar actions; coalesce extra clicks to the latest instead of no-op. */
async function runExclusive(fn: () => Promise<void>): Promise<void> {
  if (actionBusy.value) {
    pendingExclusive = fn
    return
  }
  actionBusy.value = true
  try {
    await waitWhileLoading()
    await fn()
    while (pendingExclusive) {
      const next = pendingExclusive
      pendingExclusive = null
      await waitWhileLoading()
      await next()
    }
  } finally {
    actionBusy.value = false
  }
}

/** 资源管理器式目录树：懒加载、跟随路径展开、不自动收起 */
const dirTree = useSftpDirTree(() => props.sessionId)

const {
  transfers,
  activeTransfers,
  downloadTransfers,
  uploadTransfers,
  cancelTransfer: cancelTransferAction,
  removeTransfer,
  clearFinishedTransfers,
  resumeTransfer,
  getSpeed,
  formatSize,
} = useTransfers(() => props.sessionId)

const visibleTransfers = computed(() => {
  const source = transferDirection.value === 'download'
    ? downloadTransfers.value
    : uploadTransfers.value
  const filtered = transferStatus.value === 'all' ? source : source.filter(([, item]) => {
    if (transferStatus.value === 'active') {
      return item.status === 'downloading' || item.status === 'uploading'
    }
    if (transferStatus.value === 'completed') return item.status === 'completed' || item.status === 'partial'
    return item.status === 'error' || item.status === 'skipped' || item.status === 'partial'
  })
  const priority = (status: string) => {
    if (status === 'error' || status === 'skipped' || status === 'partial') return 0
    if (status === 'downloading' || status === 'uploading') return 1
    return 2
  }
  return [...filtered].sort(([, a], [, b]) => priority(a.status) - priority(b.status))
})

const {
  contextMenuVisible,
  contextMenuX,
  contextMenuY,
  contextMenuEntry,
  hideContextMenu,
  onContextMenu,
} = useContextMenu()

const { persistSessionState, restoreSessionState, clearSessionState } = useSessionState()

function openTransfersTab(direction: 'upload' | 'download') {
  transferDirection.value = direction
  activeTab.value = 'transfers'
}

const {
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
} = useSftpUpload({
  sessionId: () => props.sessionId,
  currentPath,
  currentFiles: files,
  onQueued: () => openTransfersTab('upload'),
  onDropRejected: () => {
    ElMessage.warning(t('sftp.uploadRejectedArchive'))
  },
})

const {
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
} = useSftpFileActions({
  sessionId: () => props.sessionId,
  downloadConflict,
  refresh: async () => { await refresh() },
  onDownloadQueued: () => openTransfersTab('download'),
  setError: (msg) => { error.value = msg },
  hideContextMenu,
})

function cancelPathInput() {
  showPathInput.value = false
  pathInput.value = currentPath.value || ''
}

/** 当前目录列表变化时：写入树缓存 + 跟随展开路径（不收起其它节点） */
watch(
  [currentPath, files],
  async () => {
    if (!currentPath.value || !sftpReady.value) return
    dirTree.ingestListing(currentPath.value, files.value)
    await dirTree.followPath(currentPath.value)
  },
  { deep: true },
)

async function onTreeSelectDir(path: string) {
  if (!path || loading.value || actionBusy.value) return
  showPathInput.value = false
  if (path === currentPath.value) {
    await dirTree.expand(path)
    return
  }
  // loadDirectory + followPath reflow the tree; SftpDirTree locks scroll on click.
  await runExclusive(async () => {
    await loadDirectory(path)
    saveCurrentState()
  })
}

async function onTreeToggle(path: string) {
  await dirTree.toggleExpand(path)
}

let unsubClosed: (() => void) | null = null
let unsubReconnected: (() => void) | null = null
let unsubError: (() => void) | null = null

function onUploadCompleteEvent(e: Event) {
  const sessionId = (e as CustomEvent).detail?.sessionId as string | undefined
  if (sessionId === props.sessionId) void refresh()
}

function handleSessionClosed(sessionId: string) {
  if (props.sessionId !== sessionId) return
  // In-place reconnect may still deliver a late closed event; recoverAfterReconnect
  // will clear this. Keep path so refresh can retry after re-init.
  sftpReady.value = false
  if (!error.value || error.value === t('sftp.connectionDisconnected')) {
    error.value = t('sftp.connectionDisconnected')
  }
  saveCurrentState(sessionId)
}

function bindSessionClosedListener(sessionId: string) {
  unsubClosed?.()
  unsubClosed = window.LiteConnect.onSshClosed(sessionId, () => {
    handleSessionClosed(sessionId)
  })
  unsubError?.()
  unsubError = window.LiteConnect.onSshError(sessionId, () => {
    handleSessionClosed(sessionId)
  })
  unsubReconnected?.()
  unsubReconnected =
    window.LiteConnect.onSshReconnected?.(sessionId, () => {
      void handleSessionReconnected(sessionId)
    }) ?? null
}

function saveCurrentState(sessionId = props.sessionId) {
  persistSessionState(sessionId, {
    activeTab: activeTab.value,
    currentPath: currentPath.value,
    error: error.value,
    sftpReady: sftpReady.value,
    pathInput: pathInput.value,
    homePath: homePath.value,
    shellHomePath: shellHomePath.value,
    terminalPath: terminalPath.value,
    lastPathDebug: lastPathDebug.value,
    followTerminalPath: followTerminalPath.value,
    previousTerminalPath: previousTerminalPath.value,
  })
}

function loadSavedState(sessionId: string): boolean {
  const cached = restoreSessionState(sessionId)
  if (!cached) return false
  activeTab.value = cached.activeTab
  currentPath.value = cached.currentPath
  files.value = []
  error.value = cached.error
  sftpReady.value = cached.sftpReady
  pathInput.value = cached.pathInput
  homePath.value = cached.homePath
  shellHomePath.value = cached.shellHomePath
  terminalPath.value = cached.terminalPath
  lastPathDebug.value = cached.lastPathDebug
  followTerminalPath.value = cached.followTerminalPath
  previousTerminalPath.value = cached.previousTerminalPath
  // If SFTP is not ready, return false to trigger initSftp
  if (!sftpReady.value) return false
  return true
}

async function reloadRestoredDirectory() {
  if (activeTab.value === 'files' && sftpReady.value && currentPath.value && files.value.length === 0) {
    await loadDirectory(currentPath.value)
  }
}

function resetState() {
  files.value = []
  currentPath.value = ''
  terminalPath.value = ''
  previousTerminalPath.value = ''
  homePath.value = ''
  shellHomePath.value = ''
  pathInput.value = ''
  lastPathDebug.value = ''
  dirTree.reset()
  error.value = ''
  sftpReady.value = false
}

async function handleNavigate(entry: FileEntry) {
  await navigateTo(entry)
  saveCurrentState()
}

async function handleSyncCwd() {
  // Jump to live shell pwd, reload that directory listing, and scroll it into view.
  // Do not force-readdir the whole ancestor chain (that made the tree flash);
  // missing segments still re-fetch via followPath. Use 刷新 for a full chain reload.
  await runExclusive(async () => {
    const ok = await syncCwdForce()
    const path = currentPath.value
    if (path) {
      if (files.value.length) {
        dirTree.ingestListing(path, files.value)
      }
      // Expand ancestors if collapsed; only readdir when cache is missing a segment.
      await dirTree.followPath(path)
      fileListRef.value?.revealPath(path)
    }
    if (!ok && !error.value) {
      error.value = t('sftp.cannotGetCwd')
    }
    saveCurrentState()
  })
}

async function handleRefresh() {
  await runExclusive(async () => {
    const path = currentPath.value
    // Always clear "连接已断开" and force SFTP re-init attempt when not ready
    if (!sftpReady.value) {
      error.value = ''
    }
    const ok = await refresh()
    if (ok && path) {
      dirTree.ingestListing(path, files.value)
      // Force ancestors too: parent cache is why new shell-created dirs stayed hidden.
      await dirTree.refreshPathChain(path)
      error.value = ''
    } else if (path) {
      // The directory may be gone: reload the chain but do not fake a row for it.
      await dirTree.refreshPathChain(path, { injectPlaceholder: false })
    }
  })
}

/** Fold every side branch; keep only the chain to the current followed/locked path. */
async function handleCollapseTree() {
  await runExclusive(async () => {
    const path = currentPath.value
    if (path) {
      dirTree.collapseToPath(path)
      // Ensure listing for the kept path is still in the tree cache.
      if (files.value.length) {
        dirTree.ingestListing(path, files.value)
      }
      await dirTree.followPath(path)
      fileListRef.value?.revealPath(path)
    } else {
      dirTree.collapseAll()
    }
  })
}

async function handleSessionReconnected(sessionId: string) {
  if (props.sessionId !== sessionId) return
  error.value = ''
  sftpReady.value = false
  // Drop poisoned empty tree cache so followPath will re-fetch
  if (currentPath.value) {
    dirTree.reset()
  }
  const ok = await recoverAfterReconnect()
  if (ok && currentPath.value) {
    dirTree.ingestListing(currentPath.value, files.value)
    await dirTree.followPath(currentPath.value)
    error.value = ''
  }
  saveCurrentState()
}

function toggleFileSearch() {
  fileListRef.value?.toggleSearch()
}

function handleFileListKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault()
    e.stopPropagation()
    toggleFileSearch()
  }
}

async function handleToggleFollow() {
  await runExclusive(async () => {
    await toggleFollowTerminalPath()
    // User explicitly re-enabled follow after a container pause.
    if (followTerminalPath.value) {
      clearSftpFollowPausedByContainer(props.sessionId)
      const path = currentPath.value
      if (path) {
        // Same as locate: path may already match terminal cwd → no watch fire.
        await dirTree.followPath(path)
        fileListRef.value?.revealPath(path)
      }
    }
    saveCurrentState()
  })
}

async function handlePathSubmit() {
  await runExclusive(async () => {
    await submitPathInput()
    saveCurrentState()
  })
}

async function handleUploadFolder() {
  await runExclusive(async () => {
    await pickAndUploadDirectory()
  })
}

/** Apply host-only follow pause (docker exec, etc.). */
function applyContainerFollowPause(showToast: boolean) {
  if (!followTerminalPath.value) return
  followTerminalPath.value = false
  saveCurrentState()
  if (showToast) {
    ElMessage.info(t('sftp.followPausedContainer'))
  }
}

/** Terminal entered docker/k8s/etc. — SFTP stays on host; stop following cwd. */
function onPauseFollowEvent(e: Event) {
  const d = (e as CustomEvent<{ sessionId?: string; reason?: string }>).detail
  if (!d?.sessionId || d.sessionId !== props.sessionId) return
  applyContainerFollowPause(d.reason === 'container')
}

/** Sidebar may open after docker exec — honor session-level pause flag. */
function applyPendingContainerFollowPause() {
  if (!isSftpFollowPausedByContainer(props.sessionId)) return
  applyContainerFollowPause(false)
}

function onContextMenuDownload(entry: FileEntry) {
  startDownload(entry)
  hideContextMenu()
}

async function onContextMenuDownloadTo(entry: FileEntry) {
  hideContextMenu()
  if (entry.isDirectory) return
  const dir = await window.LiteConnect.selectDirectory()
  if (!dir) return
  startDownload(entry, dir)
}

function onContextMenuDelete(entry: FileEntry) {
  hideContextMenu()
  void deleteEntry(entry)
}

function onContextMenuOpen(entry: FileEntry) {
  void handleNavigate(entry)
  hideContextMenu()
}

function onContextMenuBookmark(entry: FileEntry) {
  hideContextMenu()
  if (!entry.isDirectory) return
  const existing = pathBookmarks.findConnectionPath(entry.path)
  if (!existing) {
    void addPathBookmark(entry.path, 'connection', false)
    return
  }
  void pathBookmarks.remove(existing.id)
    .then(() => { ElMessage.success(t('sftp.bookmarkRemoved')) })
    .catch(bookmarkError)
}

function onContextMenuExtract(entry: FileEntry) {
  void extractArchive(entry)
}

function onContextMenuDownloadDir(entry: FileEntry) {
  startDownloadDir(entry)
}

function onContextMenuEdit(entry: FileEntry) {
  openEditor(entry)
}

function onContextMenuRename(entry: FileEntry) {
  startRename(entry)
}

function onContextMenuProperties(entry: FileEntry) {
  openProperties(entry)
}

function initPwdTracker() {
  const home = (homePath.value || '').trim()
  const term = (terminalPath.value || '').trim()
  if (!pwdTracker.hasSession(props.sessionId) && (home.startsWith('/') || term.startsWith('/'))) {
    pwdTracker.initSession(props.sessionId, home || term, term || home)
  }
  // Sync terminalPath from the global tracker (may have been updated by cd commands from App.vue)
  const tracked = pwdTracker.getPwd(props.sessionId)
  if (tracked && tracked !== terminalPath.value) {
    terminalPath.value = tracked
  }
}

async function initPwdTrackerAndSync() {
  initPwdTracker()
  if (followTerminalPath.value && sftpReady.value && terminalPath.value && terminalPath.value !== currentPath.value) {
    await syncCwd()
    saveCurrentState()
  }
}

async function tryOpenFollowPath(logical: string): Promise<boolean> {
  const ok = await loadDirectory(logical, true)
  if (ok) return true
  try {
    const physical = await window.LiteConnect.sftpRealpath(props.sessionId, logical)
    const cleanPhysical = physical ? cleanRemotePath(physical) : ''
    if (cleanPhysical && cleanPhysical !== logical) {
      const opened = await loadDirectory(cleanPhysical, true)
      if (opened) {
        // Listing may be physical; keep the tracker on the logical shell path.
        terminalPath.value = logical
        return true
      }
    }
  } catch {
    // Missing path or realpath unsupported.
  }
  return false
}

async function syncFromTrackedPwd(trackedPwd: string): Promise<boolean> {
  if (!sftpReady.value || !followTerminalPath.value) return false

  let logical = cleanRemotePath(trackedPwd)
  terminalPath.value = logical
  if (logical === currentPath.value) return true

  if (await tryOpenFollowPath(logical)) {
    saveCurrentState()
    return true
  }

  // Optimistic `cd` (e.g. `cd v` which the shell rejected) — walk back until SFTP opens.
  let guard = 8
  while (guard-- > 0) {
    const prev = pwdTracker.revertCd(props.sessionId)
    if (!prev) break
    const next = cleanRemotePath(prev)
    if (next === logical && next === '/') break
    logical = next
    terminalPath.value = logical
    if (await tryOpenFollowPath(logical)) {
      saveCurrentState()
      return true
    }
    if (logical === '/') break
  }

  saveCurrentState()
  return false
}

async function handleTerminalCd(command: string): Promise<void> {
    if (!sftpReady.value) return
    const trackedPwd = pwdTracker.getPwd(props.sessionId)
    if (!trackedPwd) return
    await syncFromTrackedPwd(trackedPwd)
  }

watch(
  () => pwdTracker.state[props.sessionId]?.pwd,
  async () => {
    await runExclusive(async () => {
      const latest = pwdTracker.getPwd(props.sessionId)
      if (!latest) return
      await syncFromTrackedPwd(latest)
    })
  },
  { flush: 'post' }
)

watch(() => props.sessionId, async (newId, oldId) => {
  if (oldId) {
    unregisterSftpResource(oldId)
    saveCurrentState(oldId)
  }
  if (newId) {
    registerSftpResource(newId, () => ({ entryCount: sftpEntryCount() }))
    bindSessionClosedListener(newId)
    if (loadSavedState(newId)) {
      applyPendingContainerFollowPause()
      await initPwdTrackerAndSync()
      await reloadRestoredDirectory()
      saveCurrentState()
      return
    }
    resetState()
    await initSftp()
    applyPendingContainerFollowPause()
    await initPwdTrackerAndSync()
    saveCurrentState()
  }
})

function sftpEntryCount(): number {
  let n = 0
  for (const list of Object.values(dirTree.entriesByPath.value)) n += list.length
  return n
}

onMounted(async () => {
  void pathBookmarks.ensureLoaded().catch(bookmarkError)
  registerSftpResource(props.sessionId, () => ({ entryCount: sftpEntryCount() }))
  bindSessionClosedListener(props.sessionId)
  ensureTransferListeners()
  await loadDownloadConflict()
  bindConflictSettingsListener()
  window.addEventListener('sftp-upload-complete', onUploadCompleteEvent)
  window.addEventListener('sftp-pause-follow', onPauseFollowEvent)

  if (!loadSavedState(props.sessionId)) {
    await initSftp()
    applyPendingContainerFollowPause()
    await initPwdTrackerAndSync()
    saveCurrentState()
  } else {
    applyPendingContainerFollowPause()
    await initPwdTrackerAndSync()
    await reloadRestoredDirectory()
    saveCurrentState()
  }
})

onBeforeUnmount(() => {
  unregisterSftpResource(props.sessionId)
  saveCurrentState()
  unsubClosed?.()
  unsubError?.()
  unsubReconnected?.()
  resetDragState()
  unbindConflictSettingsListener()
  window.removeEventListener('sftp-upload-complete', onUploadCompleteEvent)
  window.removeEventListener('sftp-pause-follow', onPauseFollowEvent)
})

defineExpose({ handleTerminalCd, clearSessionState })
</script>

<template>
  <div
    class="file-sidebar"
    :class="{ 'is-file-drag': isDragOver }"
    @click="hideContextMenu"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    @keydown="handleFileListKeydown"
    tabindex="0"
  >
    <div v-if="activeTab === 'files'" class="sidebar-content">
      <div class="sidebar-navigation" :class="{ editing: showPathInput }">
        <SftpToolbar
          :active-transfers="activeTransfers"
          :follow-terminal-path="followTerminalPath"
          :terminal-label="terminalLabel"
          :terminal-target="connectionName ? `${connectionName} / ${terminalLabel}` : terminalLabel"
          :locked="actionLocked"
          @sync-cwd="handleSyncCwd"
          @refresh="handleRefresh"
          @collapse-tree="handleCollapseTree"
          @search="toggleFileSearch"
          @open-transfers="activeTab = 'transfers'"
          @upload-folder="handleUploadFolder"
          @toggle-follow="handleToggleFollow"
          @close="emit('close')"
        />
        <SftpPathBar
          :current-path="currentPath || ''"
          :path-input="pathInput"
          :show-path-input="showPathInput"
          :locked="actionLocked"
          :connection-bookmarks="pathBookmarks.grouped.value.connection"
          :global-bookmarks="pathBookmarks.grouped.value.global"
          :connection-bookmarked="!!currentConnectionBookmark"
          @update:path-input="pathInput = $event"
          @toggle="togglePathInput()"
          @submit="handlePathSubmit"
          @cancel="cancelPathInput"
          @blur-submit="handlePathSubmit"
          @toggle-bookmark="toggleCurrentPathBookmark"
          @add-bookmark="handleAddBookmark"
          @open-bookmark="handleOpenBookmark"
          @rename-bookmark="handleRenameBookmark"
          @remove-bookmark="handleRemoveBookmark"
          @move-bookmark="handleMoveBookmark"
          @edit-bookmark-path="handleEditBookmarkPath"
          @reorder-bookmark="handleReorderBookmark"
        />
      </div>

      <!-- 统一树：目录与文件保持同一层级浏览，进入多选后显示复选框 -->
      <div
        class="tree-drop-zone"
        :class="{
          active: isDragOver,
          'target-current': isDragOver && (!dropTargetPath || dropTargetPath === (currentPath || '/')),
        }"
      >
        <div v-if="isDragOver" class="drop-hint" aria-live="polite">
          {{ t('sftp.uploadTo') }} <code>{{ dropTargetPath || currentPath || '/' }}</code>
        </div>
        <SftpDirTree
          ref="fileListRef"
          :current-path="currentPath || '/'"
          :entries-of="dirTree.entriesOf"
          :is-expanded="dirTree.isExpanded"
          :is-loading="dirTree.isLoading"
          :loading="loading"
          :error="error"
          :active-transfers="activeTransfers"
          :can-edit="canEditFile"
          :external-drag-active="isDragOver"
          :drop-target-path="dropTargetPath"
          @select-dir="onTreeSelectDir"
          @toggle="onTreeToggle"
          @download="startDownload"
          @download-many="startDownloadMany"
          @delete-many="deleteMany"
          @retry="handleRefresh"
          @context-menu="onContextMenu"
          @edit="openEditor"
          @rename="startRename"
          @drop-target="onDropTarget"
        />
      </div>
    </div>

    <div v-else-if="activeTab === 'transfers'" class="sidebar-content">
      <div class="transfers-header">
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :title="t('sftp.backToFiles')" @click="activeTab = 'files'">
          <AppIcon name="chevron-left" size="md" />
        </button>
        <div class="transfers-header-title">
          <span>{{ t('sftp.transfers') }}</span>
          <span v-if="activeTransfers > 0" class="transfer-action-badge static">{{ activeTransfers }}</span>
        </div>
        <div style="flex:1"></div>
        <button type="button" class="ui-btn ui-btn-xs" @click="clearFinishedTransfers(transferDirection)">{{ t('sftp.clearRecords') }}</button>
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" @click="emit('close')" :title="t('sftp.closeSidebar')">
          <AppIcon name="close" size="sm" />
        </button>
      </div>
      <div class="transfers-toolbar">
        <div class="transfer-direction-tabs" :aria-label="t('sftp.transferDirection')">
          <button
            type="button"
            class="transfer-direction-tab"
            :class="{ active: transferDirection === 'download' }"
            @click="transferDirection = 'download'"
          >{{ t('sftp.download') }} <span>{{ downloadTransfers.length }}</span></button>
          <button
            type="button"
            class="transfer-direction-tab"
            :class="{ active: transferDirection === 'upload' }"
            @click="transferDirection = 'upload'"
          >{{ t('sftp.upload') }} <span>{{ uploadTransfers.length }}</span></button>
        </div>
        <div class="transfer-status-tabs">
          <button v-for="item in transferStatusFilters" :key="item.id" type="button" :class="{ active: transferStatus === item.id }" @click="transferStatus = item.id">
            {{ item.label }}
          </button>
        </div>
      </div>
      <TransferList
        :transfers="visibleTransfers"
        :direction="transferDirection"
        :empty-text="transferDirection === 'download' ? t('sftp.emptyDownloads') : t('sftp.emptyUploads')"
        :get-speed="getSpeed"
        @cancel="cancelTransferAction"
        @remove="removeTransfer"
        @open-folder="openInFolder"
        @resume="resumeTransfer"
      />
    </div>

    <SftpContextMenu
      :visible="contextMenuVisible"
      :x="contextMenuX"
      :y="contextMenuY"
      :entry="contextMenuEntry"
      :bookmarked="!!contextMenuEntry && contextMenuEntry.isDirectory && !!pathBookmarks.findConnectionPath(contextMenuEntry.path)"
      :can-edit="canEditFile"
      :is-archive="isArchiveName"
      @dismiss="hideContextMenu"
      @open="onContextMenuOpen"
      @bookmark="onContextMenuBookmark"
      @download="onContextMenuDownload"
      @download-to="onContextMenuDownloadTo"
      @download-dir="onContextMenuDownloadDir"
      @extract="onContextMenuExtract"
      @edit="onContextMenuEdit"
      @rename="onContextMenuRename"
      @properties="onContextMenuProperties"
      @delete="onContextMenuDelete"
    />

    <UploadConfirmModal
      :visible="showUploadConfirm"
      :files="uploadFiles"
      :target-path="uploadTargetPath"
      :existing-files="uploadTargetFiles"
      @confirm="(c) => confirmUpload(c)"
      @cancel="cancelUpload"
    />

    <FileEditorModal
      :visible="showEditor"
      :session-id="sessionId"
      :remote-path="editorEntry?.path || ''"
      :file-name="editorEntry?.name || ''"
      @close="closeEditor"
      @saved="onEditorSaved"
    />

    <FilePropertiesModal
      :visible="showProperties"
      :session-id="sessionId"
      :remote-path="propertiesEntry?.path || ''"
      :file-name="propertiesEntry?.name || ''"
      :initial-permissions="propertiesEntry?.permissions?.substring(1) || ''"
      @close="closeProperties"
      @refresh="onPropertiesSaved"
    />

    <div v-if="showRename" class="rename-overlay" @click.self="cancelRename">
      <div class="rename-modal">
        <div class="rename-title">{{ t('sftp.rename') }}</div>
        <div class="rename-original">
          <span class="rename-label">{{ t('sftp.originalName') }}</span>
          <span class="rename-original-name" :title="renameEntry?.name">{{ renameEntry?.name }}</span>
        </div>
        <div class="rename-new">
          <span class="rename-label">{{ t('sftp.newName') }}</span>
          <input
            ref="renameInputRef"
            v-model="renameValue"
            class="rename-input"
            @keydown.enter="confirmRename"
            @keydown.escape="cancelRename"
          />
        </div>
        <div class="rename-actions">
          <button class="rename-cancel-btn" @click="cancelRename">{{ t('common.cancel') }}</button>
          <button class="rename-confirm-btn" @click="confirmRename">{{ t('sftp.confirm') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="./FileSidebar.css"></style>
