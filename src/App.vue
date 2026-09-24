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
import { useWorkspaceSplitController } from './composables/terminal/useWorkspaceSplitController'
import { useAiReplyBadge } from './composables/ai/useAiReplyBadge'
import { useAiApprovalHint } from './composables/ai/useAiApprovalHint'
import { disposeAiSessionState } from './composables/ai/useAiChat'
import { onAiReplyComplete } from './composables/ai/aiReplyEvents'
import { useSecurityDialogs } from '@/composables/app/useSecurityDialogs'
import { useAppNavigation } from '@/composables/app/useAppNavigation'
import { useAppWindowRouting } from '@/composables/app/useAppWindowRouting'
import { useWorkspacePanels } from '@/composables/workspace/useWorkspacePanels'
import { useDockerWorkspaceMode } from './composables/docker/useDockerWorkspaceMode'
import { useSessionActions } from './composables/session/useSessionActions'
import { useSnippetHotkeys } from '@/composables/snippets/useSnippetHotkeys'
import { useDockerSshBridge } from '@/composables/docker/useDockerSshBridge'
import { useTransferToasts } from '@/composables/app/useTransferToasts'
import { sshSessionWarnLevel } from '@shared/appResourceStats'

const { t } = useI18n()
const { theme, customColors } = useTheme()
const fancyCursorEnabled = ref(false)
const fancyCursorStyle = ref<FancyCursorStyle>('ring')
useFancyCursor(fancyCursorEnabled, fancyCursorStyle)
const pwdTracker = useTerminalPwd()

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

const session = useSessionManager({ pwdTracker, disposeAiSession: disposeAiSessionState })
const {
  groups,
  connections,
  recentConnections,
  connectingConnectionIds,
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
const terminalDropContainer = ref<HTMLElement | null>(null)

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

const { unreadSessions, markUnread, clearUnread, hasUnread } = useAiReplyBadge()

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
  hasSplitGroup,
  isResizing,
  previewMode,
  previewActive,
  previewSide,
  previewSessionId,
  splitPrimarySessionId,
  secondarySessionId,
  secondarySide,
  toggleHorizontal,
  toggleVertical,
  setSplitMode,
  setSplitPrimarySessionId,
  setSecondarySessionId,
  setSplitPreview,
  syncSplitAvailability,
  startSplitResize,
  resetSplitRatio,
  closeSplit,
  suspendSplit,
  restoreSplit,
  DIVIDER_SIZE,
} = useSplitTerminal()

const {
  isCrossHostSplit,
  selectSplitPaneSession,
  createSplitPaneSession,
  closeSplitPaneSession,
} = useWorkspaceSplitController({
  isSplit,
  activeSessionId,
  primarySessionId: splitPrimarySessionId,
  secondarySessionId,
  sidebarVisible,
  aiSidebarVisible,
  getGroupBySessionId,
  createSession,
  closeSession: async (sessionId) => {
    clearUnread(sessionId)
    await onCloseSession(sessionId)
  },
  setSidebarTarget,
  setPrimarySessionId: setSplitPrimarySessionId,
  setSecondarySessionId,
  closeSplit,
  suspendSplit,
  restoreSplit,
})

watch(hasSplitGroup, (split, wasSplit) => {
  if (!split || wasSplit) return
  if (isCrossHostSplit.value) {
    ElMessage.info({
      message: t('terminal.crossHostSplitSftpHidden'),
      duration: 5000,
      showClose: true,
    })
    return
  }
  const boundSession = activeGroup.value?.sessions.find(
    (session) => session.id === sidebarSessionId.value,
  ) ?? activeGroup.value?.sessions.find(
    (session) => session.id === splitPrimarySessionId.value,
  )
  const terminal = boundSession
    ? t('terminal.tabLabel', { n: boundSession.tabNumber })
    : t('terminal.primaryTerminal')
  ElMessage.info({
    message: t('terminal.splitSftpFollowHint', { terminal }),
    duration: 5000,
    showClose: true,
  })
})

function getActiveSplitPair() {
  const group = activeGroup.value
  const primaryId = group?.activeSessionId ?? null
  const retainedSecondaryId = isSplit.value && groups.value.some((candidate) => candidate.sessions.some(
    (session) => session.id === secondarySessionId.value && session.id !== primaryId,
  ))
    ? secondarySessionId.value
    : null
  const sameHostSecondaryId = group?.sessions.find((session) => session.id !== primaryId)?.id ?? null
  const secondaryId = retainedSecondaryId ?? sameHostSecondaryId
  return primaryId && secondaryId ? { primaryId, secondaryId } : null
}

function toggleHorizontalForActive() {
  const pair = getActiveSplitPair()
  if (!pair) return
  toggleHorizontal(pair.primaryId, pair.secondaryId)
}

function toggleVerticalForActive() {
  const pair = getActiveSplitPair()
  if (!pair) return
  toggleVertical(pair.primaryId, pair.secondaryId)
}

function selectWorkspaceSession(sessionId: string) {
  if (
    isSplit.value &&
    sessionId === secondarySessionId.value &&
    splitPrimarySessionId.value
  ) {
    onSwapSplitPanes({
      primarySessionId: splitPrimarySessionId.value,
      secondarySessionId: sessionId,
    })
    return
  }
  if (
    isSplit.value &&
    sessionId !== splitPrimarySessionId.value &&
    sessionId !== secondarySessionId.value
  ) {
    suspendSplit()
  }
  const group = getGroupBySessionId(sessionId)
  if (!group) return
  if (activeGroupId.value !== group.connectionId) onSelectGroup(group.connectionId)
  group.activeSessionId = sessionId
  setSidebarTarget(group.connectionId, sessionId)
}

function selectSplitGroup() {
  const primaryId = splitPrimarySessionId.value
  const secondaryId = secondarySessionId.value
  const primaryGroup = primaryId ? getGroupBySessionId(primaryId) : null
  const secondaryGroup = secondaryId ? getGroupBySessionId(secondaryId) : null
  if (
    !primaryId ||
    !secondaryId ||
    !primaryGroup ||
    !secondaryGroup
  ) {
    closeSplit()
    return
  }
  if (activeGroupId.value !== primaryGroup.connectionId) onSelectGroup(primaryGroup.connectionId)
  primaryGroup.activeSessionId = primaryId
  setSidebarTarget(primaryGroup.connectionId, primaryId)
  restoreSplit()
}

function selectConnectionGroup(connectionId: string) {
  showSettingsPage.value = false
  appMode.value = 'ssh'
  const primaryId = splitPrimarySessionId.value
  const primaryGroup = primaryId ? getGroupBySessionId(primaryId) : null
  if (hasSplitGroup.value && primaryGroup?.connectionId === connectionId) {
    primaryGroup.activeSessionId = primaryId
    setSidebarTarget(connectionId, primaryId)
    restoreSplit()
  } else if (isSplit.value) {
    suspendSplit()
  }
  onSelectGroup(connectionId)
}

async function createStandaloneSession(connectionId: string) {
  const wasSplit = isSplit.value
  if (wasSplit) suspendSplit()
  const sessionId = await createSession(connectionId)
  if (!sessionId && wasSplit) restoreSplit()
}

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
  if (isDockerMode.value || isCrossHostSplit.value) return
  toggleSidebar()
}
function guardedToggleAiSidebar() {
  if (isDockerMode.value || isSplit.value) return
  toggleAiSidebar()
}
function guardedAiSelection(text: string, mode: 'send' | 'insert') {
  if (isDockerMode.value || isSplit.value) return
  handleAiSelection(text, mode)
}

function jumpToAiApproval(sessionId: string) {
  if (isSplit.value) suspendSplit()
  const group = groups.value.find((g) => g.sessions.some((s) => s.id === sessionId))
  if (group) {
    if (activeGroupId.value !== group.connectionId) onSelectGroup(group.connectionId)
    if (activeSessionId.value !== sessionId) selectWorkspaceSession(sessionId)
  }
  if (isDockerMode.value) enterTerminal()
  aiSidebarVisible.value = true
}
function guardedToggleMonitorPanel() {
  if (isDockerMode.value) return
  toggleMonitorPanel()
}
function guardedToggleBatchPanel() {
  if (isDockerMode.value) return
  toggleBatchPanel()
}
function guardedToggleSnippetsPanel() {
  if (isDockerMode.value) return
  toggleSnippetsPanel()
}

/** Open the Docker sub-tab under the current SSH host (同列于终端 1 / 终端 2). */
function handleEnterDocker() {
  if (isDbWindow) return
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
  if (isDbWindow) return
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

const { pendingApprovalSessions, hasPending: hasAiApprovalPending } = useAiApprovalHint()

const {
  batchSessions,
  liveSessionIds,
  handleSessionClosed,
  handleReconnect,
  handleCloseSession,
  onCdCommand,
  onPwdOutput,
  onDragSplitCommit,
  onSwapSplitPanes,
} = useSessionActions({
  groups,
  connections,
  activeGroup,
  pwdTracker,
  getGroupBySessionId,
  onSelectGroup,
  createSession,
  removeSessionFromState,
  onCloseSession,
  onSessionClosed,
  clearUnread,
  setSidebarTarget,
  setSplitPreview,
  setSplitPrimarySessionId,
  setSecondarySessionId,
  setSplitMode,
})

let lastSshWindowWarnLevel = 0
watch(liveSessionIds, (ids) => {
  const level = sshSessionWarnLevel(ids.length)
  if (level == null) {
    lastSshWindowWarnLevel = 0
    return
  }
  if (level <= lastSshWindowWarnLevel) return
  lastSshWindowWarnLevel = level
  ElMessage.warning({
    message: t('app.sshWindowMemoryHint', { n: ids.length }),
    duration: 8000,
    showClose: true,
  })
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

watch(liveSessionIds, (ids) => syncSplitAvailability(ids.length, ids))

provide('theme', theme)
provide('customColors', customColors)
provide('pwdTracker', pwdTracker)

let unsubReplyComplete: (() => void) | null = null
let unsubAiApprovalNotification: (() => void) | null = null
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

const {
  launchParams,
  isDetachedWindow,
  isDbWindow,
  handleEnterDatabaseModule,
  handleEnterSshModule,
} = useAppWindowRouting({ appMode, enterDatabase, enterSsh })

onMounted(async () => {
  unsubAiApprovalNotification = window.LiteConnect.onAiApprovalNotificationClick((sessionId) => {
    enterSsh()
    ensureSshWorkspaceMounted()
    jumpToAiApproval(sessionId)
  })
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
  if (!isDetachedWindow && !isDbWindow) {
    await restoreWorkspaceTabs()
  }
  bootstrapPending.value = false
})

onBeforeUnmount(() => {
  unsubAiApprovalNotification?.()
  unsubAiApprovalNotification = null
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
      @enter-ssh="handleEnterSshModule"
      @enter-database="handleEnterDatabaseModule"
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
          :ai-approval-sessions="pendingApprovalSessions"
          :disconnected-session-ids="disconnectedSessionIds"
          :home-active="isHomeActive"
          :terminal-container="terminalDropContainer"
          :split-primary-session-id="splitPrimarySessionId"
          :split-secondary-session-id="secondarySessionId"
          :split-mode="splitMode"
          :split-group-active="isSplit"
          @select="selectConnectionGroup"
          @close="onCloseGroup"
          @select-home="() => enterSsh(true)"
          @quick-connect="(id) => { showSettingsPage = false; appMode = 'ssh'; onQuickConnect(id) }"
          @split-preview="setSplitPreview"
          @split-commit="onDragSplitCommit"
          @select-split="selectSplitGroup"
          @close-split="closeSplit"
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
            :connecting-connection-ids="connectingConnectionIds"
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
          :ai-approval-sessions="pendingApprovalSessions"
          :show-ai-unread="!aiSidebarVisible && !!activeSessionId && hasUnread(activeSessionId)"
          :show-ai-approval="!aiSidebarVisible && !!activeSessionId && hasAiApprovalPending(activeSessionId)"
          :ai-sidebar-visible="aiSidebarVisible"
          :sidebar-visible="sidebarVisible"
          :sftp-disabled="isCrossHostSplit"
          :ai-disabled="isSplit"
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
          :preview-active="previewActive"
          :preview-side="previewSide"
          :preview-session-id="previewSessionId"
          :divider-size="DIVIDER_SIZE"
          :split-primary-session-id="splitPrimarySessionId"
          :secondary-session-id="secondarySessionId"
          :secondary-side="secondarySide"
          :docker-mode="isDockerMode"
          :docker-tab-open="dockerTabOpen"
          :docker-button-enabled="dockerButtonEnabled"
          :disconnected-session-ids="disconnectedSessionIds"
          @jump-ai-approval="jumpToAiApproval"
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
          @select-session="selectWorkspaceSession"
          @close-session="handleCloseSession"
          @add-session="createStandaloneSession"
          @session-closed="handleSessionClosed"
          @reconnect="handleReconnect"
          @cd-command="onCdCommand"
          @pwd-output="onPwdOutput"
          @ai-selection="guardedAiSelection"
          @split-preview="setSplitPreview"
          @split-commit="onDragSplitCommit"
          @swap-split-panes="onSwapSplitPanes"
          @close-split="closeSplit"
          @select-split="selectSplitGroup"
          @toggle-horizontal="toggleHorizontalForActive"
          @toggle-vertical="toggleVerticalForActive"
          @start-split-resize="startSplitResize"
          @reset-split-ratio="resetSplitRatio"
          @set-secondary-session="setSecondarySessionId"
          @bind-terminal-container="(el) => { terminalDropContainer = el }"
          @select-split-pane-session="selectSplitPaneSession"
          @add-split-pane-session="createSplitPaneSession"
          @close-split-pane-session="closeSplitPaneSession"
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
