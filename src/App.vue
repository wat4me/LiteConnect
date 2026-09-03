<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onBeforeUnmount, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ConnectionsView from './views/ConnectionsView.vue'
import TabBar from '@/components/app/TabBar.vue'
import AppTitlebar from '@/components/app/AppTitlebar.vue'
import AppDialogHost from '@/components/app/AppDialogHost.vue'

const SettingsView = defineAsyncComponent(() => import('./views/SettingsView.vue'))
const DatabaseView = defineAsyncComponent(() => import('./views/DatabaseView.vue'))
const SshWorkspace = defineAsyncComponent(() => import('@/components/workspace/SshWorkspace.vue'))
const HostKeyMismatchDialog = defineAsyncComponent(() => import('@/components/app/HostKeyMismatchDialog.vue'))
const DecryptionFailedDialog = defineAsyncComponent(() => import('@/components/app/DecryptionFailedDialog.vue'))
const KeyboardInteractiveDialog = defineAsyncComponent(() => import('@/components/app/KeyboardInteractiveDialog.vue'))
const OnboardingTips = defineAsyncComponent(() => import('@/components/app/OnboardingTips.vue'))
const GlobalJumpPalette = defineAsyncComponent(() => import('@/components/app/GlobalJumpPalette.vue'))
const ShortcutsHelpOverlay = defineAsyncComponent(() => import('@/components/app/ShortcutsHelpOverlay.vue'))
import type { AppBootstrapData } from './env.d'
import { ElMessage } from 'element-plus/es/components/message/index'
import { useTheme } from '@/composables/app/useTheme'
import {
  sanitizeFancyCursorStyle,
  useFancyCursor,
  type FancyCursorStyle,
} from '@/composables/app/useFancyCursor'
import {
  applyAppBackground,
  sanitizeAppBackgroundFit,
  clampBackgroundOverlay,
} from '@/composables/app/useAppBackground'
import { useTerminalPwd } from './composables/terminal/useTerminalPwd'
import { useSessionManager, HOME_ID } from './composables/session/useSessionManager'
import { useSidebarState } from '@/composables/workspace/useSidebarState'
import { useLatencyState } from './composables/session/useLatencyState'
import { useAppKeyboard } from '@/composables/app/useAppKeyboard'
import { useSplitTerminal } from './composables/terminal/useSplitTerminal'
import { useAiReplyBadge } from './composables/ai/useAiReplyBadge'
import { onAiReplyComplete } from './composables/ai/aiReplyEvents'
import { useSecurityDialogs } from '@/composables/app/useSecurityDialogs'
import { useAppNavigation } from '@/composables/app/useAppNavigation'
import { useWorkspacePanels } from '@/composables/workspace/useWorkspacePanels'
import { useDockerWorkspaceMode } from './composables/docker/useDockerWorkspaceMode'
import { useSessionActions } from './composables/session/useSessionActions'
import { useTitlebarConnection } from '@/composables/app/useTitlebarConnection'
import { useSnippetHotkeys } from '@/composables/snippets/useSnippetHotkeys'
import { useDockerSshBridge } from '@/composables/docker/useDockerSshBridge'
import { useTransferToasts } from '@/composables/app/useTransferToasts'

const { t } = useI18n()
const { theme, customColors } = useTheme()
const fancyCursorEnabled = ref(false)
const fancyCursorStyle = ref<FancyCursorStyle>('ring')
useFancyCursor(fancyCursorEnabled, fancyCursorStyle)
const pwdTracker = useTerminalPwd()
const { dbConnectionLabel } = useTitlebarConnection()

function onFancyCursorSettingsChange(e: Event) {
  const detail = (e as CustomEvent<{ enabled?: boolean; style?: string }>).detail
  if (typeof detail?.enabled === 'boolean') {
    fancyCursorEnabled.value = detail.enabled
  }
  if (detail?.style != null) {
    fancyCursorStyle.value = sanitizeFancyCursorStyle(detail.style)
  }
}

async function loadFancyCursorSettings() {
  try {
    const [enabled, style] = await Promise.all([
      window.LiteConnect.getFancyCursorEnabled(),
      window.LiteConnect.getFancyCursorStyle(),
    ])
    fancyCursorEnabled.value = enabled === true
    fancyCursorStyle.value = sanitizeFancyCursorStyle(style)
  } catch {
    fancyCursorEnabled.value = false
    fancyCursorStyle.value = 'ring'
  }
}

async function loadAppBackgroundSettings() {
  try {
    const bg = await window.LiteConnect.getAppBackground()
    applyAppBackground({
      imageUrl: bg?.imageUrl || '',
      fit: sanitizeAppBackgroundFit(bg?.fit),
      overlay: clampBackgroundOverlay(bg?.overlay),
    })
  } catch {
    applyAppBackground({ imageUrl: '' })
  }
}

function onAppBackgroundSettingsChange(e: Event) {
  const detail = (e as CustomEvent<{ imageUrl?: string; dataUrl?: string; fit?: string; overlay?: number }>).detail
  applyAppBackground({
    imageUrl: detail?.imageUrl || detail?.dataUrl || '',
    fit: sanitizeAppBackgroundFit(detail?.fit),
    overlay: clampBackgroundOverlay(detail?.overlay),
  })
}

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
  restoreWorkspaceTabs,
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
  settingsInitialTab,
  appMode,
  databaseMounted,
  sshWorkspaceMounted,
  settingsViewRef,
  isSshMode,
  isDatabaseMode,
  closeSettingsPage,
  openSettingsPage,
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
  enterDocker,
  enterTerminal,
  closeDockerTab,
  dockerTabOpen,
  applyModeForActiveSession,
  markSessionConnected,
  ensureSessionTracked,
  disconnectedSessionIds,
  forgetSession,
  pruneConnections,
} = useDockerWorkspaceMode({
  activeSessionId,
  activeConnectionId: computed(() => activeGroup.value?.connectionId ?? null),
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
  toggleSidebar()
}
function guardedToggleAiSidebar() {
  toggleAiSidebar()
}
function guardedToggleMonitorPanel() {
  toggleMonitorPanel()
}
function guardedToggleBatchPanel() {
  toggleBatchPanel()
}
function guardedToggleSnippetsPanel() {
  toggleSnippetsPanel()
}

/** Open the Docker sub-tab under the current SSH host (同列于终端 1 / 终端 2). */
function handleEnterDocker() {
  closeSettingsPage()
  if (appMode.value !== 'ssh') {
    appMode.value = 'ssh'
    ensureSshWorkspaceMounted()
  }
  if (isHomeActive.value || !dockerButtonEnabled.value) {
    ElMessage.warning(t('toolbar.dockerDisabled'))
    return
  }
  enterDocker()
}

function handleToggleDocker() {
  closeSettingsPage()
  if (appMode.value !== 'ssh') {
    appMode.value = 'ssh'
    ensureSshWorkspaceMounted()
  }
  if (isHomeActive.value || (!isDockerMode.value && !dockerButtonEnabled.value)) {
    ElMessage.warning(t('toolbar.dockerDisabled'))
    return
  }
  toggleDockerWorkspace()
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
  keyboardPrompt,
  handleKeyboardSubmit,
  handleKeyboardCancel,
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

const {
  batchSessions,
  liveSessionIds,
  handleSessionClosed,
  handleReconnect,
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

const { tryRunSnippetHotkey } = useSnippetHotkeys({
  activeSessionId,
  activeSession,
  connections,
  openSnippetPalette,
})

const { handleKeydown, handleWheel, handlePageZoomKeydown } = useAppKeyboard({
  isHomeActive,
  isSshWorkspace: isSshMode,
  activeGroup,
  toggleSidebar: guardedToggleSidebar,
  toggleAiSidebar: guardedToggleAiSidebar,
  toggleMonitor: guardedToggleMonitorPanel,
  toggleBatchPanel: guardedToggleBatchPanel,
  toggleSnippetsPanel: guardedToggleSnippetsPanel,
  toggleDocker: handleToggleDocker,
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
function trackSessionConnection(sessionId: string) {
  const sess = allSessions.value.find((s) => s.id === sessionId)
  ensureSessionTracked(sessionId, { connected: sess?.pending !== true })
}

watch(
  activeSessionId,
  (next) => {
    if (next) trackSessionConnection(next)
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
    for (const s of sessions) trackSessionConnection(s.id)
  },
  { immediate: true },
)

watch(
  () => groups.value.map((g) => g.connectionId),
  (ids) => {
    pruneConnections(ids)
  },
)

useDockerSshBridge({
  liveSessionIds,
  trackSessionConnection,
  markSessionConnected,
  forgetSession,
})

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
let unsubMcpConnect: (() => void) | null = null
let unsubMcpClose: (() => void) | null = null
let unsubMcpConnections: (() => void) | null = null

watch(
  [activeSessionId, aiSidebarVisible],
  ([sid, aiVisible]) => {
    if (sid && aiVisible) clearUnread(sid)
  },
  { immediate: true },
)

useTransferToasts()

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
  unsubReplyComplete = onAiReplyComplete((sessionId) => {
    if (sessionId === activeSessionId.value && aiSidebarVisible.value) return
    markUnread(sessionId)
  })
  if (typeof window.LiteConnect.onMcpCloseSession === 'function') {
    unsubMcpClose = window.LiteConnect.onMcpCloseSession((sessionId) => {
      void handleCloseSession(sessionId)
    })
  }
  if (typeof window.LiteConnect.onMcpConnectionsChanged === 'function') {
    unsubMcpConnections = window.LiteConnect.onMcpConnectionsChanged(() => {
      void loadConnections()
      window.dispatchEvent(new CustomEvent('connections-store-change'))
    })
  }
  unsubMcpConnect = window.LiteConnect.onMcpConnectRequest((payload) => {
    void (async () => {
      try {
        enterSsh()
        ensureSshWorkspaceMounted()
        const sessionId = await createSession(payload.connectionId)
        await window.LiteConnect.mcpReportConnectResult(payload.requestId, {
          sessionId: sessionId || undefined,
          error: sessionId ? undefined : 'CONNECT_FAILED',
        })
      } catch (err: any) {
        await window.LiteConnect.mcpReportConnectResult(payload.requestId, {
          error: err?.message || 'CONNECT_FAILED',
        })
      }
    })()
  })
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('keydown', handlePageZoomKeydown, true)
  window.addEventListener('wheel', handleWheel, { passive: false, capture: true })
  window.addEventListener('latency-settings-change', handleLatencySettingsChange)
  window.addEventListener('monitor-settings-change', handleMonitorSettingsChange)
  window.addEventListener('fancy-cursor-settings-change', onFancyCursorSettingsChange)
  window.addEventListener('app-background-settings-change', onAppBackgroundSettingsChange)
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
    fancyCursorEnabled.value = bootstrap.fancyCursorEnabled === true
    fancyCursorStyle.value = sanitizeFancyCursorStyle(bootstrap.fancyCursorStyle)
    applyAppBackground({
      imageUrl: bootstrap.appBackground?.imageUrl || '',
      fit: sanitizeAppBackgroundFit(bootstrap.appBackground?.fit),
      overlay: clampBackgroundOverlay(bootstrap.appBackground?.overlay),
    })

    if (!bootstrap.encryptionAvailable) {
      ElMessage.warning({
        message: t('app.bootstrapEncryptionWarn'),
        duration: 8000,
      })
    }

    if (!isDetachedWindow) {
      await restoreWorkspaceTabs()
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
  await Promise.all([loadFancyCursorSettings(), loadAppBackgroundSettings()])
  await Promise.all([loadConnections(), loadRecentConnections()])
  if (!isDetachedWindow) {
    await restoreWorkspaceTabs()
  }
  bootstrapPending.value = false
})

onBeforeUnmount(() => {
  unsubReplyComplete?.()
  unsubReplyComplete = null
  unsubMcpConnect?.()
  unsubMcpConnect = null
  unsubMcpClose?.()
  unsubMcpClose = null
  unsubMcpConnections?.()
  unsubMcpConnections = null
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('keydown', handlePageZoomKeydown, true)
  window.removeEventListener('wheel', handleWheel, { capture: true })
  window.removeEventListener('latency-settings-change', handleLatencySettingsChange)
  window.removeEventListener('monitor-settings-change', handleMonitorSettingsChange)
  window.removeEventListener('fancy-cursor-settings-change', onFancyCursorSettingsChange)
  window.removeEventListener('app-background-settings-change', onAppBackgroundSettingsChange)
})
</script>

<template>
  <div class="app-container">
    <!-- Wallpaper under all routes (connections / SSH / settings); toggled via html.has-app-bg -->
    <div class="app-bg-layer" aria-hidden="true"></div>

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
          :disconnected-session-ids="disconnectedSessionIds"
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
        :initial-tab="settingsInitialTab"
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
            @open-settings="openSettingsPage"
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
          :docker-tab-open="dockerTabOpen"
          :docker-button-enabled="dockerButtonEnabled"
          :active-session-ssh-disconnected="!!activeSessionId && !isActiveSessionConnected"
          :disconnected-session-ids="disconnectedSessionIds"
          @toggle-ai="guardedToggleAiSidebar"
          @toggle-files="guardedToggleSidebar"
          @toggle-monitor="guardedToggleMonitorPanel"
          @toggle-batch="guardedToggleBatchPanel"
          @toggle-snippets="guardedToggleSnippetsPanel"
          @toggle-docker="toggleDockerWorkspace"
          @select-docker="enterDocker"
          @close-docker="closeDockerTab"
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
          @cd-command="onCdCommand"
          @pwd-output="onPwdOutput"
          @ai-selection="(text, mode) => handleAiSelection(text, mode)"
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

    <KeyboardInteractiveDialog
      v-if="keyboardPrompt"
      :data="keyboardPrompt"
      @submit="handleKeyboardSubmit"
      @cancel="handleKeyboardCancel"
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
      @open-settings="() => { jumpPaletteVisible = false; openSettingsPage() }"
      @open-docker="() => { jumpPaletteVisible = false; handleEnterDocker() }"
    />
  </div>
</template>

<style scoped>
.app-container {
  /* Match BrowserWindow client area (see main.css note on 100vh clipping) */
  height: 100%;
  width: 100%;
  max-height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
  background: transparent;
}

.workspace {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  z-index: 1;
  border-top: 1px solid var(--border-color);
  background: transparent;
}

.workspace-top {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  height: var(--tab-height);
  min-height: var(--tab-height);
  max-height: var(--tab-height);
  background: var(--bg-secondary);
  overflow: hidden;
}

.workspace-top :deep(.tab-bar) {
  flex: 1;
  min-width: 0;
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
