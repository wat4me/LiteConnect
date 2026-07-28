<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onBeforeUnmount, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ConnectionsView from './views/ConnectionsView.vue'
import TabBar from './components/TabBar.vue'
import AppTitlebar from './components/AppTitlebar.vue'
import AppDialogHost from './components/AppDialogHost.vue'

const SettingsView = defineAsyncComponent(() => import('./views/SettingsView.vue'))
const DatabaseView = defineAsyncComponent(() => import('./views/DatabaseView.vue'))
const SshWorkspace = defineAsyncComponent(() => import('./components/SshWorkspace.vue'))
const HostKeyMismatchDialog = defineAsyncComponent(() => import('./components/HostKeyMismatchDialog.vue'))
const DecryptionFailedDialog = defineAsyncComponent(() => import('./components/DecryptionFailedDialog.vue'))
const OnboardingTips = defineAsyncComponent(() => import('./components/OnboardingTips.vue'))
const GlobalJumpPalette = defineAsyncComponent(() => import('./components/GlobalJumpPalette.vue'))
const ShortcutsHelpOverlay = defineAsyncComponent(() => import('./components/ShortcutsHelpOverlay.vue'))
import type { AppBootstrapData } from './env.d'
import { ElMessage } from 'element-plus/es/components/message/index'
import { useTheme } from './composables/useTheme'
import { useTerminalPwd } from './composables/terminal/useTerminalPwd'
import { useSessionManager, HOME_ID } from './composables/session/useSessionManager'
import { useSidebarState } from './composables/useSidebarState'
import { useLatencyState } from './composables/session/useLatencyState'
import { useAppKeyboard } from './composables/useAppKeyboard'
import { useSplitTerminal } from './composables/terminal/useSplitTerminal'
import { useAiReplyBadge } from './composables/ai/useAiReplyBadge'
import { useAiChat } from './composables/ai/useAiChat'
import { useSecurityDialogs } from './composables/useSecurityDialogs'
import { useAppNavigation } from './composables/useAppNavigation'
import { useWorkspacePanels } from './composables/useWorkspacePanels'
import { useDockerWorkspaceMode } from './composables/docker/useDockerWorkspaceMode'
import { useSessionActions } from './composables/session/useSessionActions'
import {
  formatSnippetPayloadForWrite,
  matchSnippetHotkey,
  pendingSnippetVars,
  resolveDynamicBuiltins,
  resolveSnippetCommand,
} from './utils/commandSnippets'
import { getSnippetContext } from './utils/sessionDisplay'
import { useTitlebarConnection } from './composables/useTitlebarConnection'

const { t } = useI18n()
const { theme, customColors } = useTheme()
const pwdTracker = useTerminalPwd()
const { dbConnectionLabel } = useTitlebarConnection()

const session = useSessionManager({ pwdTracker })
const {
  groups,
  connections,
  recentConnections,
  activeGroupId,
  isHomeActive,
  activeGroup,
  activeSession,
  activeSessionId,
  onConnect,
  onCloseGroup,
  onSelectGroup,
  onSelectHome,
  onQuickConnect,
  onSelectSession,
  onCloseSession,
  onSessionClosed,
  removeSessionFromState,
  createSession,
  adoptSession,
  hasOpenSession,
  syncConnectionName,
  getGroupBySessionId,
  getGroupByConnectionId,
  getLastSessionId,
  connectSidebar,
  loadConnections,
  loadRecentConnections,
  hydrateConnectionData,
} = session

const connectionsBootstrap = ref<Pick<AppBootstrapData, 'connections' | 'groups'> | null>(null)
const bootstrapPending = ref(true)
const jumpPaletteVisible = ref(false)
const shortcutsHelpVisible = ref(false)

const sidebar = useSidebarState({
  groups,
  activeGroupId,
  activeSessionId,
  HOME_ID,
  getGroupByConnectionId,
  getLastSessionId,
})

const {
  sidebarVisible,
  aiSidebarVisible,
  sidebarWidth,
  monitorWidth,
  monitorVisible,
  monitorEnabled,
  sidebarSessionId,
  sidebarGroupId,
  aiSelectionRequest,
  connectionsViewRef,
  fileSidebarRef,
  toggleSidebar,
  toggleAiSidebar,
  setSidebarTarget,
  syncSidebarState,
  startResize,
  startResizeRight,
  handleAiSelection,
  handleAiSelectionConsumed,
  handleMonitorSettingsChange,
} = sidebar

connectSidebar({
  sidebarVisible,
  aiSidebarVisible,
  sidebarGroupId,
  sidebarSessionId,
  fileSidebarRef,
  setSidebarTarget,
  syncSidebarState,
})

const {
  latencyMap,
  latencyEnabled,
  latencyIntervalMs,
  handleLatencySettingsChange,
} = useLatencyState({ groups })

const {
  splitMode,
  splitRatio,
  isSplit,
  isResizing,
  previewMode,
  previewSide,
  secondarySessionId,
  secondarySide,
  toggleHorizontal,
  toggleVertical,
  setSplitMode,
  setSecondarySessionId,
  setPreviewMode,
  setPreviewSide,
  syncSplitAvailability,
  startSplitResize,
  resetSplitRatio,
  DIVIDER_SIZE,
} = useSplitTerminal()

const {
  showSettingsPage,
  appMode,
  databaseMounted,
  sshWorkspaceMounted,
  settingsViewRef,
  isSshMode,
  isDatabaseMode,
  closeSettingsPage,
  enterSsh,
  enterDatabase,
  toggleSettingsPage,
  ensureSshWorkspaceMounted,
} = useAppNavigation({ onSelectHome })

const titlebarConnectionLabel = computed(() => {
  if (appMode.value === 'database') {
    return dbConnectionLabel.value || t('app.connectionManage')
  }
  if (isHomeActive.value || !activeGroup.value) {
    return t('app.connectionManage')
  }
  const conn = connections.value.find((c) => c.id === activeGroup.value!.connectionId)
  if (!conn) return t('app.connectionManage')
  if (conn.port && conn.port !== 22) {
    return `${conn.username}@${conn.host}:${conn.port}`
  }
  return `${conn.username}@${conn.host}`
})

watch(isHomeActive, (home) => {
  if (!home) ensureSshWorkspaceMounted()
})

const {
  batchPanelVisible,
  snippetsPanelVisible,
  batchInitialCommand,
  snippetPaletteVisible,
  snippetDraftCommand,
  toggleBatchPanel,
  toggleSnippetsPanel,
  openSnippetsPanelWithDraft,
  clearSnippetDraftCommand,
  openSnippetPalette,
  closeSnippetPalette,
  toggleMonitorPanel,
  openBatchWithCommand,
  clearBatchInitialCommand,
} = useWorkspacePanels(monitorVisible)

const {
  isDockerMode,
  dockerButtonEnabled,
  isActiveSessionConnected,
  toggleDockerWorkspace,
  enterTerminal,
  applyModeForActiveSession,
  markSessionConnected,
  ensureSessionTracked,
  forgetSession,
  withTerminalModeGuard,
} = useDockerWorkspaceMode({
  activeSessionId,
  panels: {
    aiSidebarVisible,
    sidebarVisible,
    monitorVisible,
    batchPanelVisible,
    snippetsPanelVisible,
    snippetPaletteVisible,
  },
})

function guardedToggleSidebar() {
  withTerminalModeGuard(toggleSidebar)
}
function guardedToggleAiSidebar() {
  withTerminalModeGuard(toggleAiSidebar)
}
function guardedToggleMonitorPanel() {
  withTerminalModeGuard(toggleMonitorPanel)
}
function guardedToggleBatchPanel() {
  withTerminalModeGuard(toggleBatchPanel)
}
function guardedToggleSnippetsPanel() {
  withTerminalModeGuard(toggleSnippetsPanel)
}

const {
  hostKeyMismatchVisible,
  hostKeyMismatchData,
  decryptionFailedVisible,
  decryptionFailedData,
  handleHostKeyAccept,
  handleHostKeyReject,
  handleDecryptionFailedGoEdit,
  handleDecryptionFailedDismiss,
} = useSecurityDialogs({
  connections,
  onSelectHome: () => enterSsh(true),
  editConnection: (conn) => {
    enterSsh(true)
    void Promise.resolve().then(() => {
      connectionsViewRef.value?.editConnection?.(conn)
    })
  },
  adoptSession,
  hasOpenSession,
})

const { unreadSessions, markUnread, clearUnread, hasUnread } = useAiReplyBadge()
const { onReplyComplete } = useAiChat()

const {
  batchSessions,
  liveSessionIds,
  handleSessionClosed,
  handleReconnect,
  handleReconnectAll,
  handleCloseSession,
  onCdCommand,
  onPwdOutput,
  onDragSplitPreview,
  onDragSplitCommit,
  onStartSplitResize,
} = useSessionActions({
  groups,
  connections,
  activeGroup,
  pwdTracker,
  getGroupBySessionId,
  createSession,
  removeSessionFromState,
  onCloseSession,
  onSessionClosed,
  clearUnread,
  setSidebarTarget,
  setPreviewMode,
  setPreviewSide,
  setSecondarySessionId,
  setSplitMode,
  startSplitResize,
})

/** Flatten all open sessions so TerminalWorkspace can keep every xterm mounted. */
const allSessions = computed(() => {
  const list: import('./composables/session/useSessionManager').Session[] = []
  for (const g of groups.value) {
    for (const s of g.sessions) list.push(s)
  }
  return list
})

let snippetHotkeyCache: Array<{
  id: string
  hotkey?: string
  command: string
  name: string
  sendMode?: 'run' | 'fill'
}> | null = null
let snippetHotkeyCacheAt = 0

async function refreshSnippetHotkeyCache() {
  try {
    const list = await window.LiteConnect.getCommandSnippets()
    snippetHotkeyCache = list
      .filter((s) => s.hotkey)
      .map((s) => ({
        id: s.id,
        hotkey: s.hotkey,
        command: s.command,
        name: s.name,
        sendMode: s.sendMode,
      }))
    snippetHotkeyCacheAt = Date.now()
  } catch {
    snippetHotkeyCache = []
  }
}

function tryRunSnippetHotkey(e: KeyboardEvent): boolean {
  if (!snippetHotkeyCache || Date.now() - snippetHotkeyCacheAt > 5000) {
    void refreshSnippetHotkeyCache()
  }
  const list = snippetHotkeyCache || []
  const hit = list.find((s) => matchSnippetHotkey(e, s.hotkey))
  if (!hit) return false
  const sid = activeSessionId.value
  if (!sid) return true
  void (async () => {
    const session = activeSession.value
    const ctx = session ? getSnippetContext(connections.value, session.connectionId) : null
    const dynamic = await resolveDynamicBuiltins()
    const merged = { ...(ctx || {}), ...dynamic }
    const pending = pendingSnippetVars(hit.command, merged)
    if (pending.length > 0) {
      openSnippetPalette()
      return
    }
    const resolved = resolveSnippetCommand(hit.command, merged, dynamic)
    const mode = hit.sendMode === 'fill' ? 'fill' : 'run'
    window.LiteConnect.sshWrite(sid, formatSnippetPayloadForWrite(resolved, mode))
  })()
  return true
}

const { handleKeydown } = useAppKeyboard({
  isHomeActive,
  isSshWorkspace: isSshMode,
  activeGroup,
  toggleSidebar: guardedToggleSidebar,
  toggleAiSidebar: guardedToggleAiSidebar,
  toggleMonitor: guardedToggleMonitorPanel,
  toggleBatchPanel: guardedToggleBatchPanel,
  toggleSnippetsPanel: guardedToggleSnippetsPanel,
  openSnippetPalette,
  openJumpPalette: () => { jumpPaletteVisible.value = true },
  openShortcutsHelp: () => { shortcutsHelpVisible.value = true },
  onSnippetHotkey: (e) => tryRunSnippetHotkey(e),
  onCloseGroup,
  onAddSession: createSession,
  onSelectSession,
  hostKeyMismatchVisible,
  decryptionFailedVisible,
  onHostKeyReject: () => handleHostKeyReject(),
  onDecryptionDismiss: () => handleDecryptionFailedDismiss(),
})

let prevDockerSessionId: string | null = null
watch(
  activeSessionId,
  (next) => {
    if (next) ensureSessionTracked(next)
    applyModeForActiveSession(prevDockerSessionId, next)
    prevDockerSessionId = next
  },
  {
    immediate: true,
    // Apply the per-session snapshot before createSession/adoptSession performs
    // its intentional post-connect `sidebarVisible = true`. With the default
    // pre-flush timing this watcher ran later and hid the freshly opened SFTP.
    flush: 'sync',
  },
)

watch(
  allSessions,
  (sessions) => {
    for (const s of sessions) ensureSessionTracked(s.id)
  },
  { immediate: true },
)

/** Per-session SSH closed/reconnected listeners for Docker button + workspace. */
const dockerSshUnsubs = new Map<string, () => void>()

function detachDockerSshListeners(sessionId: string) {
  const off = dockerSshUnsubs.get(sessionId)
  if (off) {
    off()
    dockerSshUnsubs.delete(sessionId)
  }
}

function attachDockerSshListeners(sessionId: string) {
  if (dockerSshUnsubs.has(sessionId)) return
  const offs: Array<() => void> = []
  offs.push(
    window.LiteConnect.onSshClosed(sessionId, () => {
      markSessionConnected(sessionId, false)
    }),
  )
  if (typeof window.LiteConnect.onSshReconnected === 'function') {
    offs.push(
      window.LiteConnect.onSshReconnected(sessionId, () => {
        markSessionConnected(sessionId, true)
      }),
    )
  }
  dockerSshUnsubs.set(sessionId, () => {
    for (const off of offs) off()
  })
}

watch(
  liveSessionIds,
  (ids) => {
    const live = new Set(ids)
    for (const id of ids) {
      ensureSessionTracked(id)
      attachDockerSshListeners(id)
    }
    for (const id of [...dockerSshUnsubs.keys()]) {
      if (!live.has(id)) {
        detachDockerSshListeners(id)
        forgetSession(id)
      }
    }
  },
  { immediate: true },
)

watch(
  () => (activeGroup.value ? activeGroup.value.sessions.map((s) => s.id) : null),
  (ids) => {
    // activeGroup 变 null 时保留分屏，切回终端不丢布局
    if (!ids) return
    syncSplitAvailability(ids.length, ids)
  },
)

provide('theme', theme)
provide('customColors', customColors)
provide('pwdTracker', pwdTracker)

let unsubReplyComplete: (() => void) | null = null

watch(
  [activeSessionId, aiSidebarVisible],
  ([sid, aiVisible]) => {
    if (sid && aiVisible) clearUnread(sid)
  },
  { immediate: true },
)

function onTransferFinished(e: Event) {
  const d = (e as CustomEvent).detail as {
    fileName?: string
    direction?: string
    status?: string
    error?: string
  } | undefined
  if (!d) return
  const name = d.fileName || t('common.file')
  const dirLabel = d.direction === 'upload' ? t('common.upload') : t('common.download')
  if (d.status === 'completed') {
    ElMessage.success(t('app.transferComplete', { direction: dirLabel, name }))
  } else if (d.status === 'error') {
    ElMessage.error(
      d.error
        ? t('app.transferFailedWithError', { direction: dirLabel, name, error: d.error })
        : t('app.transferFailed', { direction: dirLabel, name }),
    )
  }
}

function onBatchFinished(e: Event) {
  const d = (e as CustomEvent).detail as {
    success?: number
    error?: number
    cancelled?: number
    total?: number
    cancelledByUser?: boolean
  } | undefined
  if (!d) return
  if (d.cancelledByUser) {
    ElMessage.info(
      t('app.batchCancelled', {
        success: d.success || 0,
        error: d.error || 0,
        cancelled: d.cancelled || 0,
      }),
    )
    return
  }
  if ((d.error || 0) > 0) {
    ElMessage.warning(t('app.batchDoneWithError', { success: d.success || 0, error: d.error || 0 }))
  } else {
    ElMessage.success(t('app.batchDoneAll', { success: d.success || 0, total: d.total || 0 }))
  }
}

/** Detached multi-window launch: ?detached=1&connectionId=uuid */
function readLaunchParams() {
  try {
    const params = new URLSearchParams(window.location.search)
    return {
      detached: params.get('detached') === '1',
      connectionId: params.get('connectionId') || '',
    }
  } catch {
    return { detached: false, connectionId: '' }
  }
}

const launchParams = readLaunchParams()
const isDetachedWindow = launchParams.detached && !!launchParams.connectionId

onMounted(async () => {
  unsubReplyComplete = onReplyComplete((sessionId) => {
    if (sessionId === activeSessionId.value && aiSidebarVisible.value) return
    markUnread(sessionId)
  })
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('latency-settings-change', handleLatencySettingsChange)
  window.addEventListener('monitor-settings-change', handleMonitorSettingsChange)
  window.addEventListener('sftp-transfer-finished', onTransferFinished)
  window.addEventListener('batch-command-finished', onBatchFinished)
  void refreshSnippetHotkeyCache()
  try {
    const bootstrap = await window.LiteConnect.getAppBootstrap()
    hydrateConnectionData({
      connections: bootstrap.connections,
      recentConnections: bootstrap.recentConnections,
    })
    connectionsBootstrap.value = {
      connections: bootstrap.connections,
      groups: bootstrap.groups,
    }
    latencyEnabled.value = bootstrap.latencyEnabled
    latencyIntervalMs.value = bootstrap.latencyIntervalMs
    monitorEnabled.value = bootstrap.monitorEnabled

    if (!bootstrap.encryptionAvailable) {
      ElMessage.warning({
        message: t('app.bootstrapEncryptionWarn'),
        duration: 8000,
      })
    }

    bootstrapPending.value = false

    if (isDetachedWindow && launchParams.connectionId) {
      // Auto-connect target host for detached workspace window
      const exists = bootstrap.connections.some((c) => c.id === launchParams.connectionId)
      if (exists) {
        void onConnect(launchParams.connectionId)
      } else {
        ElMessage.error(t('connections.openInNewWindowFailed'))
      }
    }
    return
  } catch (err) {
    console.error('[App Bootstrap]', err)
  }
  const encAvailable = await window.LiteConnect.isEncryptionAvailable()
  if (!encAvailable) {
    ElMessage.warning({
      message: t('app.bootstrapEncryptionWarn'),
      duration: 8000,
    })
  }
  latencyEnabled.value = await window.LiteConnect.getLatencyEnabled()
  latencyIntervalMs.value = await window.LiteConnect.getLatencyIntervalMs()
  monitorEnabled.value = await window.LiteConnect.getMonitorEnabled()
  await Promise.all([loadConnections(), loadRecentConnections()])
  bootstrapPending.value = false
})

onBeforeUnmount(() => {
  unsubReplyComplete?.()
  unsubReplyComplete = null
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('latency-settings-change', handleLatencySettingsChange)
  window.removeEventListener('monitor-settings-change', handleMonitorSettingsChange)
  window.removeEventListener('sftp-transfer-finished', onTransferFinished)
  window.removeEventListener('batch-command-finished', onBatchFinished)
  for (const id of [...dockerSshUnsubs.keys()]) {
    detachDockerSshListeners(id)
  }
})
</script>

<template>
  <div class="app-container">
    <AppTitlebar
      :app-mode="appMode"
      :show-settings-page="showSettingsPage"
      :connection-label="titlebarConnectionLabel"
      @enter-ssh="enterSsh"
      @enter-database="enterDatabase"
      @toggle-settings="toggleSettingsPage"
      @open-shortcuts="shortcutsHelpVisible = true"
    />

    <div class="workspace">
      <div v-show="!showSettingsPage && appMode === 'ssh'" class="workspace-top">
        <TabBar
          :groups="groups"
          :active-group-id="activeGroupId"
          :recent-connections="recentConnections"
          :connections="connections"
          :latency-map="latencyEnabled ? latencyMap : null"
          :latency-enabled="latencyEnabled"
          :unread-sessions="unreadSessions"
          :home-active="isHomeActive"
          @select="(id) => { showSettingsPage = false; appMode = 'ssh'; onSelectGroup(id) }"
          @close="onCloseGroup"
          @select-home="() => enterSsh(true)"
          @quick-connect="(id) => { showSettingsPage = false; appMode = 'ssh'; onQuickConnect(id) }"
        />
      </div>

      <SettingsView
        v-if="showSettingsPage"
        ref="settingsViewRef"
        @close="closeSettingsPage"
      />

      <div v-show="!showSettingsPage" class="app-main-body">
        <div v-show="isSshMode && isHomeActive" class="home-module">
          <ConnectionsView
            ref="connectionsViewRef"
            :initial-data="connectionsBootstrap"
            :initial-data-pending="bootstrapPending"
            @connect="onConnect"
            @connection-saved="syncConnectionName"
          />
        </div>

        <div v-show="isDatabaseMode" class="home-module">
          <DatabaseView v-if="databaseMounted" />
        </div>

        <SshWorkspace
          v-if="sshWorkspaceMounted"
          v-show="isSshMode && !isHomeActive"
          :active-group="activeGroup"
          :active-session="activeSession"
          :active-session-id="activeSessionId"
          :connections="connections"
          :live-session-ids="liveSessionIds"
          :all-sessions="allSessions"
          :unread-sessions="unreadSessions"
          :show-ai-unread="!aiSidebarVisible && !!activeSessionId && hasUnread(activeSessionId)"
          :ai-sidebar-visible="aiSidebarVisible"
          :sidebar-visible="sidebarVisible"
          :sidebar-width="sidebarWidth"
          :sidebar-session-id="sidebarSessionId"
          :ai-selection-request="aiSelectionRequest"
          :monitor-visible="monitorVisible"
          :monitor-width="monitorWidth"
          :batch-panel-visible="batchPanelVisible"
          :snippets-panel-visible="snippetsPanelVisible"
          :snippet-palette-visible="snippetPaletteVisible"
          :snippet-draft-command="snippetDraftCommand"
          :batch-sessions="batchSessions"
          :batch-initial-command="batchInitialCommand"
          :split-mode="splitMode"
          :split-ratio="splitRatio"
          :is-split="isSplit"
          :is-resizing="isResizing"
          :preview-mode="previewMode"
          :preview-side="previewSide"
          :divider-size="DIVIDER_SIZE"
          :secondary-session-id="secondarySessionId"
          :secondary-side="secondarySide"
          :docker-mode="isDockerMode"
          :docker-button-enabled="dockerButtonEnabled"
          :active-session-ssh-disconnected="!!activeSessionId && !isActiveSessionConnected"
          @toggle-ai="guardedToggleAiSidebar"
          @toggle-files="guardedToggleSidebar"
          @toggle-monitor="guardedToggleMonitorPanel"
          @toggle-batch="guardedToggleBatchPanel"
          @toggle-snippets="guardedToggleSnippetsPanel"
          @toggle-docker="toggleDockerWorkspace"
          @back-to-terminal="enterTerminal"
          @close-ai="aiSidebarVisible = false"
          @close-files="sidebarVisible = false"
          @close-monitor="monitorVisible = false"
          @close-batch="batchPanelVisible = false"
          @close-snippets="snippetsPanelVisible = false"
          @ai-selection-consumed="handleAiSelectionConsumed"
          @start-resize="startResize"
          @start-resize-right="startResizeRight"
          @bind-file-sidebar="(el) => { fileSidebarRef.value = el }"
          @select-session="onSelectSession"
          @close-session="handleCloseSession"
          @add-session="createSession"
          @session-closed="handleSessionClosed"
          @reconnect="handleReconnect"
          @reconnect-all="handleReconnectAll"
          @cd-command="onCdCommand"
          @pwd-output="onPwdOutput"
          @ai-selection="(text, mode) => withTerminalModeGuard(() => handleAiSelection(text, mode))"
          @split-preview="onDragSplitPreview"
          @split-commit="onDragSplitCommit"
          @toggle-horizontal="toggleHorizontal"
          @toggle-vertical="toggleVertical"
          @start-split-resize="onStartSplitResize"
          @reset-split-ratio="resetSplitRatio"
          @set-secondary-session="setSecondarySessionId"
          @send-to-batch="openBatchWithCommand"
          @clear-batch-initial="clearBatchInitialCommand"
          @close-snippet-palette="closeSnippetPalette"
          @clear-snippet-draft="clearSnippetDraftCommand"
          @save-as-snippet="openSnippetsPanelWithDraft"
        />
      </div>
    </div>

    <HostKeyMismatchDialog
      v-if="hostKeyMismatchVisible"
      :data="hostKeyMismatchData"
      @accept="handleHostKeyAccept"
      @reject="handleHostKeyReject"
    />

    <DecryptionFailedDialog
      v-if="decryptionFailedVisible"
      :data="decryptionFailedData"
      @edit="handleDecryptionFailedGoEdit"
      @dismiss="handleDecryptionFailedDismiss"
    />

    <AppDialogHost />

    <OnboardingTips />

    <ShortcutsHelpOverlay
      :visible="shortcutsHelpVisible"
      @close="shortcutsHelpVisible = false"
    />

    <GlobalJumpPalette
      :visible="jumpPaletteVisible"
      :connections="connections"
      @close="jumpPaletteVisible = false"
      @connect="(id) => { jumpPaletteVisible = false; showSettingsPage = false; appMode = 'ssh'; onQuickConnect(id) }"
      @open-home="() => { jumpPaletteVisible = false; showSettingsPage = false; enterSsh(true) }"
      @open-settings="() => { jumpPaletteVisible = false; showSettingsPage = true }"
    />
  </div>
</template>

<style scoped>
.app-container {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.workspace {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  border-top: 1px solid var(--border-color);
}

.workspace-top {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  height: var(--tab-height);
  min-height: var(--tab-height);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.workspace-top :deep(.tab-bar) {
  flex: 1;
  min-width: 0;
  border-bottom: none;
}

.app-main-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.home-module {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.home-module > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
</style>
