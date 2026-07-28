<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileEntry } from '../../env.d.ts'
import { useSftpNavigation } from '../../composables/sftp/useSftpNavigation'
import { useSftpDirTree } from '../../composables/sftp/useSftpDirTree'
import { useTransfers, ensureTransferListeners } from '../../composables/sftp/useTransfers'
import { useContextMenu } from '../../composables/useContextMenu'
import { useSessionState } from '../../composables/session/useSessionState'
import { useSftpUpload } from '../../composables/sftp/useSftpUpload'
import { useSftpFileActions } from '../../composables/sftp/useSftpFileActions'
import type { TerminalPwdTracker } from '../../composables/terminal/useTerminalPwd'
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
  connectionName: string
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
  onQueued: () => openTransfersTab('upload'),
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
  if (!path || loading.value) return
  showPathInput.value = false
  if (path === currentPath.value) {
    await dirTree.expand(path)
    return
  }
  // loadDirectory + followPath reflow the tree; SftpDirTree locks scroll on click.
  await loadDirectory(path)
  saveCurrentState()
}

async function onTreeToggle(path: string) {
  await dirTree.toggleExpand(path)
}

let unsubClosed: (() => void) | null = null
let unsubReconnected: (() => void) | null = null

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
  await syncCwdForce()
  saveCurrentState()
}

async function handleRefresh() {
  const path = currentPath.value
  // Always clear "连接已断开" and force SFTP re-init attempt when not ready
  if (!sftpReady.value) {
    error.value = ''
  }
  const ok = await refresh()
  if (ok && path) {
    dirTree.ingestListing(path, files.value)
    await dirTree.followPath(path)
    error.value = ''
  } else if (path) {
    await dirTree.refreshNode(path)
  }
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
  await toggleFollowTerminalPath()
  saveCurrentState()
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
  if (!pwdTracker.hasSession(props.sessionId)) {
    pwdTracker.initSession(props.sessionId, homePath.value, terminalPath.value)
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

async function syncFromTrackedPwd(trackedPwd: string): Promise<boolean> {
  if (!sftpReady.value || !followTerminalPath.value) return false

  const cleanTracked = cleanRemotePath(trackedPwd)
  terminalPath.value = cleanTracked
  if (cleanTracked === currentPath.value) return true

  // Save the current known-good path before attempting to load the new one.
  // This is more reliable than pwdTracker.revertCd() because previousPwd can be
  // corrupted by rapid sequential cd commands.
  const knownGoodPath = currentPath.value

  // Use isFallback=true to prevent loadDirectory's internal revert logic
  // (which relies on previousPwd). We handle the revert ourselves here.
  const ok = await loadDirectory(cleanTracked, true)
  if (ok) {
    saveCurrentState()
    return true
  }

  // Failed to load the tracked path — revert to the last known-good path
  if (knownGoodPath) {
    terminalPath.value = knownGoodPath
    pwdTracker.setPwd(props.sessionId, knownGoodPath)
    // Don't need to reload since currentPath/files are still showing knownGoodPath
    saveCurrentState()
  }
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
  async (trackedPwd) => {
    if (!trackedPwd) return
    await syncFromTrackedPwd(trackedPwd)
  },
  { flush: 'post' }
)

watch(() => props.sessionId, async (newId, oldId) => {
  if (oldId) {
    saveCurrentState(oldId)
  }
  if (newId) {
    bindSessionClosedListener(newId)
    if (loadSavedState(newId)) {
      await initPwdTrackerAndSync()
      await reloadRestoredDirectory()
      saveCurrentState()
      return
    }
    resetState()
    await initSftp()
    await initPwdTrackerAndSync()
    saveCurrentState()
  }
})

onMounted(async () => {
  bindSessionClosedListener(props.sessionId)
  ensureTransferListeners()
  await loadDownloadConflict()
  bindConflictSettingsListener()
  window.addEventListener('sftp-upload-complete', onUploadCompleteEvent)

  if (!loadSavedState(props.sessionId)) {
    await initSftp()
    await initPwdTrackerAndSync()
    saveCurrentState()
  } else {
    await initPwdTrackerAndSync()
    await reloadRestoredDirectory()
    saveCurrentState()
  }
})

onBeforeUnmount(() => {
  saveCurrentState()
  unsubClosed?.()
  unsubReconnected?.()
  resetDragState()
  unbindConflictSettingsListener()
  window.removeEventListener('sftp-upload-complete', onUploadCompleteEvent)
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
          @sync-cwd="handleSyncCwd"
          @refresh="handleRefresh"
          @search="toggleFileSearch"
          @open-transfers="activeTab = 'transfers'"
          @upload-folder="pickAndUploadDirectory"
          @toggle-follow="handleToggleFollow"
          @close="emit('close')"
        />
        <SftpPathBar
          :current-path="currentPath || ''"
          :path-input="pathInput"
          :show-path-input="showPathInput"
          @update:path-input="pathInput = $event"
          @toggle="togglePathInput()"
          @submit="submitPathInput"
          @cancel="cancelPathInput"
          @blur-submit="submitPathInput"
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
          <AppIcon name="chevron-left" :size="16" />
        </button>
        <div class="transfers-header-title">
          <span>{{ t('sftp.transfers') }}</span>
          <span v-if="activeTransfers > 0" class="transfer-action-badge static">{{ activeTransfers }}</span>
        </div>
        <div style="flex:1"></div>
        <button type="button" class="ui-btn ui-btn-xs" @click="clearFinishedTransfers(transferDirection)">{{ t('sftp.clearRecords') }}</button>
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" @click="emit('close')" :title="t('sftp.closeSidebar')">
          <AppIcon name="close" :size="14" />
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
      :can-edit="canEditFile"
      :is-archive="isArchiveName"
      @dismiss="hideContextMenu"
      @open="onContextMenuOpen"
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
      :existing-files="files"
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

<style scoped>
.file-sidebar {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  overflow: hidden;
  user-select: none;
  position: relative;
  container-type: inline-size;
  /* Density tokens for list/tree icons — rem scales with OS/app zoom */
  --sftp-icon-size: 1.125rem;
  --sftp-icon-slot: 1.375rem;
  --sftp-row-min-height: 1.75rem;
  --sftp-row-font: 0.75rem;
}

/* Wider SFTP pane → slightly larger icons & row height (inherits into tree) */
@container (min-width: 340px) {
  .sidebar-content {
    --sftp-icon-size: 1.25rem;
    --sftp-icon-slot: 1.5rem;
    --sftp-row-min-height: 1.875rem;
    --sftp-row-font: 0.8125rem;
  }
}

@container (min-width: 440px) {
  .sidebar-content {
    --sftp-icon-size: 1.375rem;
    --sftp-icon-slot: 1.625rem;
    --sftp-row-min-height: 2rem;
    --sftp-row-font: 0.875rem;
  }
}

.transfer-action-badge {
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--accent);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-variant-numeric: tabular-nums;
}

.transfer-action-badge.static {
  position: static;
  box-shadow: none;
}

.sidebar-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-navigation {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px 8px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

/* path-action-btn kept for transfers header layout if needed */
.path-action-btn {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  opacity: 0.8;
}

.path-action-btn.confirm {
  opacity: 1;
  color: var(--accent);
}

.transfers-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.transfers-header-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.transfers-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-color);
  flex-wrap: wrap;
}

.transfer-direction-tabs {
  display: inline-flex;
  padding: 2px;
  border-radius: 7px;
  background: var(--bg-tertiary);
}

.transfer-direction-tab {
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.transfer-direction-tab span {
  margin-left: 3px;
  color: inherit;
  font-variant-numeric: tabular-nums;
}

.transfer-direction-tab.active {
  background: var(--bg-primary);
  color: var(--accent);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
}

.transfer-status-tabs {
  order: 3;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 3px;
}

.transfer-status-tabs button {
  height: 24px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.transfer-status-tabs button:hover,
.transfer-status-tabs button.active {
  color: var(--accent);
  background: var(--accent-bg);
}

.follow-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.follow-footer-text {
  min-width: 0;
}

.follow-footer-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.follow-footer-desc {
  font-size: 10px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.follow-switch {
  width: 38px;
  height: 22px;
  border: none;
  border-radius: 999px;
  background: var(--bg-tertiary);
  position: relative;
  cursor: pointer;
  transition: background 0.15s;
  flex-shrink: 0;
  padding: 0;
}

.follow-switch.on {
  background: var(--accent);
}

.follow-switch-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s;
}

.follow-switch.on .follow-switch-thumb {
  transform: translateX(16px);
}

.tree-drop-zone {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  border-radius: 8px;
  transition: box-shadow 0.15s, background 0.15s;
}

.tree-drop-zone.active {
  background: color-mix(in srgb, var(--accent) 4%, transparent);
}

.tree-drop-zone.target-current {
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 50%, transparent);
}

.drop-hint {
  flex-shrink: 0;
  margin: 0 8px 6px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px dashed color-mix(in srgb, var(--accent) 55%, transparent);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-primary));
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  pointer-events: none;
}

.drop-hint code {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 11px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.file-sidebar.is-file-drag .sidebar-navigation {
  opacity: 0.72;
  pointer-events: none;
}

.rename-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
}

.rename-modal {
  width: 360px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 18px;
}

.rename-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 14px;
}

.rename-original,
.rename-new {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.rename-new {
  margin-bottom: 16px;
}

.rename-label {
  width: 52px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: right;
}

.rename-original-name {
  flex: 1;
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  padding: 7px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

.rename-input {
  flex: 1;
  padding: 7px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

.rename-input:focus {
  border-color: var(--accent);
}

.rename-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.rename-cancel-btn {
  padding: 6px 16px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: none;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.rename-cancel-btn:hover {
  color: var(--text-primary);
  border-color: var(--text-secondary);
}

.rename-confirm-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.rename-confirm-btn:hover {
  background: var(--accent-hover);
}
</style>
