<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, onActivated, onDeactivated, nextTick, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import '@xterm/xterm/css/xterm.css'
import type { Theme, CustomColors } from '@/composables/app/useTheme'
import { usePasteDetection } from '../../composables/terminal/usePasteDetection'
import { useCommandBuffer } from '../../composables/terminal/useCommandBuffer'
import { useRenderBatch } from '../../composables/terminal/useRenderBatch'
import { useTerminalLocalEcho } from '../../composables/terminal/useTerminalLocalEcho'
import { createDelayedTerminalOutput, createTypingResponseTracker } from '../../composables/terminal/terminalTypingLatency'
import { useWriteQueue } from '../../composables/terminal/useWriteQueue'
import { useTerminalPwdQuery } from '../../composables/terminal/useTerminalPwdQuery'
import { useTerminalSearch } from '../../composables/terminal/useTerminalSearch'
import { useTerminalKeyHandler } from '../../composables/terminal/useTerminalKeyHandler'
import { useXtermInstance } from '../../composables/terminal/useXtermInstance'
import { useTerminalUserInput } from '../../composables/terminal/useTerminalUserInput'
import { useTerminalShellSuggest } from '../../composables/terminal/useTerminalShellSuggest'
import { useSftpPathBookmarks } from '../../composables/sftp/useSftpPathBookmarks'
import { useTerminalReconnect } from '../../composables/terminal/useTerminalReconnect'
import { useTerminalSelectionMenu } from '../../composables/terminal/useTerminalSelectionMenu'
import { useTerminalPasteConfirm } from '../../composables/terminal/useTerminalPasteConfirm'
import { isContainerEnterCommand } from '@/utils/docker/containerEnterCommand'
import { markSftpFollowPausedByContainer } from '../../composables/sftp/sftpFollowPause'
import TerminalCommandSuggest from './TerminalCommandSuggest.vue'
import AppIcon from '../icons/AppIcon.vue'
import { isNonRetryableSshError } from '@/utils/session/sshErrorRetry'
import { focusLiveTerminal } from '@/utils/terminal/workspaceTerminalFocus'
import { computeEffectiveTerminalActive } from '@/utils/terminal/terminalResizePolicy'
import {
  registerTerminalResource,
  unregisterTerminalResource,
} from '@/composables/app/rendererResourceRegistry'
import TerminalSearchBar from './TerminalSearchBar.vue'
import TerminalReconnectOverlay from './TerminalReconnectOverlay.vue'
import TerminalSelectionMenu from './TerminalSelectionMenu.vue'

const props = withDefaults(
  defineProps<{
    sessionId: string
    connectionName: string
    connectionId: string
    active?: boolean
    workspaceVisible?: boolean
    startDisconnected?: boolean
    /** Split screen closes AI; hide the selection actions that would reopen it. */
    aiDisabled?: boolean
  }>(),
  { active: true, workspaceVisible: true, startDisconnected: false, aiDisabled: false },
)

const emit = defineEmits<{
  (e: 'closed', sessionId: string): void
  (e: 'cdCommand', sessionId: string, command: string): void
  (e: 'pwdOutput', sessionId: string, pwd: string): void
  (e: 'reconnect', sessionId: string): void
  (e: 'aiSelection', text: string, mode: 'send' | 'insert'): void
  (e: 'saveAsSnippet', text: string): void
}>()

const { t } = useI18n()
const terminalRef = ref<HTMLDivElement>()
const theme = inject<import('vue').Ref<Theme>>('theme')!
const customColors = inject<import('vue').Ref<CustomColors>>('customColors')!

const readOnly = ref(false)
let readOnlyHintShown = false

function showReadOnlyHintOnce() {
  if (readOnlyHintShown) return
  readOnlyHintShown = true
  ElMessage.info(t('terminal.readOnlyHint'))
}

function toggleReadOnly() {
  readOnly.value = !readOnly.value
  if (!readOnly.value) readOnlyHintShown = false
  ElMessage.info(
    readOnly.value ? t('terminal.readOnlyOn') : t('terminal.readOnlyOff'),
  )
}

let unsubData: (() => void) | null = null
let unsubClosed: (() => void) | null = null
let unsubReconnected: (() => void) | null = null
let unsubError: (() => void) | null = null

let flushRenderBatchFn: (callback?: () => void) => void = (cb) => { cb?.() }

function isWorkspaceVisible(): boolean {
  return props.workspaceVisible !== false
}

function isEffectiveActive(): boolean {
  return computeEffectiveTerminalActive({
    active: !!props.active,
    workspaceVisible: isWorkspaceVisible(),
  })
}

const {
  getTerminal,
  getSearchAddon,
  fontSize,
  pasteConfirmEnabled,
  pasteConfirmMaxChars,
  terminalPalette,
  performResize,
  scheduleTerminalRefresh,
  cancelScheduledTerminalRefresh,
  attachResizeObserver,
  detachResizeObserver,
  applyTerminalTheme,
  attachSettingsListeners,
  loadTerminalSettings,
  createTerminal,
  disposeTerminal,
  setFontSize,
} = useXtermInstance({
  terminalRef,
  theme,
  customColors,
  getSessionId: () => props.sessionId,
  getFlushRenderBatch: () => flushRenderBatchFn,
  isWorkspaceVisible,
})

const { updatePasteState, isPasting } = usePasteDetection()

let onCommandSubmitted = (_cmd: string | null) => {}

const {
  commandBuffer,
  commandBufferDirty,
  capturedSubmitLine,
  scheduleSubmit,
  cancelPendingSubmit,
  resetCommandBuffer,
  getVisibleCommandLine,
  syncAfterTabCompletion,
  extractCommandFromVisibleLine,
} = useCommandBuffer({
  getTerminal,
  onCdCommand: (cmd) => emit('cdCommand', props.sessionId, cmd),
  onSubmitted: (cmd) => onCommandSubmitted(cmd),
})

const {
  flushRenderBatch,
  flushInteractiveResponse,
  scheduleRenderFlush,
  appendRenderBatch,
  resetRenderBatch,
  setRenderFrozen,
  isOutputPaused,
} = useRenderBatch(getTerminal, (paused) => {
  window.LiteConnect.sshSetOutputPaused(props.sessionId, paused)
})
const localEcho = useTerminalLocalEcho(getTerminal, terminalRef)

flushRenderBatchFn = flushRenderBatch

const reconnect = useTerminalReconnect({
  sessionId: () => props.sessionId,
  connectionId: () => props.connectionId,
  connectionName: () => props.connectionName,
  isActive: () => !!props.active,
  workspaceVisible: isWorkspaceVisible,
  startDisconnected: !!props.startDisconnected,
  getTerminal,
  flushRenderBatch,
  performResize,
  scheduleTerminalRefresh,
  emitReconnect: (sessionId) => emit('reconnect', sessionId),
})
const {
  disconnected,
  neverConnected,
  disconnectDetail,
  reconnecting,
  reconnectAttempt,
  autoReconnectExhausted,
  autoReconnectMaxRetries,
} = reconnect

const pathBookmarks = useSftpPathBookmarks(() => props.connectionId)
const suggest = useTerminalShellSuggest({
  terminalRef,
  getTerminal,
  connectionId: () => props.connectionId,
  sessionId: () => props.sessionId,
  isEffectiveActive,
  disconnected: reconnect.disconnected,
  commandBuffer,
  commandBufferDirty,
  cdBookmarks: () => {
    const grouped = pathBookmarks.grouped.value
    return [...grouped.connection, ...grouped.global]
  },
  ensureCdBookmarks: () => pathBookmarks.ensureLoaded(),
})
const {
  suggestVisible,
  suggestItems,
  suggestActiveIndex,
  suggestLeft,
  suggestTop,
  suggestPlaceAbove,
} = suggest

onCommandSubmitted = (cmd) => {
  suggest.suggestDismissed.value = false
  if (cmd?.trim() && isContainerEnterCommand(cmd)) {
    markSftpFollowPausedByContainer(props.sessionId)
    window.dispatchEvent(
      new CustomEvent('sftp-pause-follow', {
        detail: { sessionId: props.sessionId, reason: 'container' },
      }),
    )
  }
  if (!cmd || !cmd.trim()) return
  suggest.scheduleHistorySniff(cmd)
}

const {
  enqueueWrite,
  clearWriteQueue,
  getWriteQueueLength,
} = useWriteQueue()

const {
  processPwdQueryData,
  requestInteractivePwd,
  dispose: disposePwdQuery,
} = useTerminalPwdQuery({
  getTerminal,
  flushRenderBatch,
  writeToSsh: (data) => window.LiteConnect.sshWrite(props.sessionId, data),
  onPwdOutput: (pwd) => emit('pwdOutput', props.sessionId, pwd),
  getPendingInput: () => {
    if (commandBufferDirty.value) {
      return extractCommandFromVisibleLine() || commandBuffer.value
    }
    return commandBuffer.value
  },
  onLineClearedForPwd: () => {
    resetCommandBuffer()
  },
  onRestorePendingInput: (text) => {
    commandBuffer.value = text
    commandBufferDirty.value = false
  },
})

const {
  searchVisible,
  searchQuery,
  caseSensitive,
  useRegex,
  matchIndex,
  matchCount,
  setSearchInputRef,
  bindSearchAddon,
  disposeSearchListeners,
  toggleSearch,
  findNext,
  findPrevious,
  onSearchInput,
  onSearchKeydown,
  reRunSearch,
} = useTerminalSearch({ getTerminal, getSearchAddon })

let cursorPulseTimer: ReturnType<typeof setTimeout> | null = null
const typingResponse = createTypingResponseTracker()
let delayedOutput: ReturnType<typeof createDelayedTerminalOutput> | null = null
let typingDiagnosticsEnabled = false

function pulseCursor() {
  if (!props.active || !terminalRef.value) return
  terminalRef.value.classList.add('cursor-pulse')
  if (cursorPulseTimer) clearTimeout(cursorPulseTimer)
  cursorPulseTimer = setTimeout(() => {
    terminalRef.value?.classList.remove('cursor-pulse')
    cursorPulseTimer = null
  }, 120)
}

const { handleTerminalUserInput, hasPendingTabCompletion, syncPendingTabCompletion } = useTerminalUserInput({
  sessionId: () => props.sessionId,
  readOnly,
  showReadOnlyHintOnce,
  updatePasteState,
  isPasting,
  pulseCursor,
  syncAfterTabCompletion,
  suggest,
  capturedSubmitLine,
  getVisibleCommandLine,
  scheduleSubmit,
  cancelPendingSubmit,
  resetCommandBuffer,
  commandBuffer,
  commandBufferDirty,
  emitCdCommand: (command) => emit('cdCommand', props.sessionId, command),
  getWriteQueueLength,
  enqueueWrite,
  write: (data) => window.LiteConnect.sshWrite(props.sessionId, data),
})

const { pasteWithConfirm } = useTerminalPasteConfirm({
  getTerminal,
  pasteConfirmEnabled,
  pasteConfirmMaxChars,
  isActive: () => !!props.active,
  handleTerminalUserInput,
})

const selection = useTerminalSelectionMenu({
  getTerminal,
  isActive: () => !!props.active,
  pasteWithConfirm,
  onAiSelection: (text, mode) => emit('aiSelection', text, mode),
  onSaveAsSnippet: (text) => emit('saveAsSnippet', text),
})
const {
  selectionMenuVisible,
  selectionMenuX,
  selectionMenuY,
  selectedText,
} = selection

const { handleKey: handleTerminalKey } = useTerminalKeyHandler({
  getTerminal,
  getFontSize: () => fontSize.value,
  setFontSize: (size) => {
    setFontSize(size)
    window.LiteConnect.setTerminalFontSize(size).catch(() => {})
  },
  toggleSearch,
  pasteText: pasteWithConfirm,
  onBarePageKey: () => {
    ElMessage.info(t('terminal.pageScrollHint'))
  },
})

function handleKey(event: KeyboardEvent): boolean {
  if (!suggest.handleSuggestKey(event)) return false
  return handleTerminalKey(event)
}

function applyActiveState(isActive: boolean) {
  setRenderFrozen(!isActive)
  if (!isActive) localEcho.clear()
  const terminal = getTerminal()
  if (terminal) {
    terminal.options.cursorBlink = isActive
  }
  if (isActive) {
    attachResizeObserver()
    scheduleTerminalRefresh(true)
  } else {
    cancelScheduledTerminalRefresh()
    detachResizeObserver()
    selection.hideSelectionMenu()
  }
}

function onTerminalLocalEchoSettingChange(event: Event) {
  const enabled = (event as CustomEvent).detail?.localEchoEnabled
  if (typeof enabled === 'boolean') localEcho.setEnabled(enabled)
}

function clearScrollback() {
  getTerminal()?.clear()
  selection.hideSelectionMenu()
  ElMessage.success(t('terminal.clearedBuffer'))
}

function clearScreenKeepScrollback() {
  getTerminal()?.write('\x1b[H\x1b[2J')
  selection.hideSelectionMenu()
}

type TerminalPwdRequestDetail = {
  sessionId: string
  handled?: boolean
  resolve: (pwd: string) => void
  reject: (error: Error) => void
}

function onRequestTerminalPwd(event: Event) {
  const detail = (event as CustomEvent<TerminalPwdRequestDetail>).detail
  if (!detail || detail.sessionId !== props.sessionId) return
  detail.handled = true
  requestInteractivePwd().then(detail.resolve, detail.reject)
}

onActivated(() => {
  if (isEffectiveActive()) {
    attachResizeObserver()
    scheduleTerminalRefresh(true)
  }
})

onDeactivated(() => {
  detachResizeObserver()
})

watch(
  () => [props.active, props.workspaceVisible] as const,
  () => {
    applyActiveState(isEffectiveActive())
  },
)

function appendIncomingTerminalData(data: string) {
  if (!getTerminal()) return
  const visibleData = processPwdQueryData(data)
  if (visibleData.length > 0) {
    const now = performance.now()
    const typingSample = typingResponse.takeResponse()
    suggest.feedHistorySniff(visibleData)
    appendRenderBatch(visibleData)
    if (hasPendingTabCompletion()) {
      flushRenderBatch(syncPendingTabCompletion)
    } else {
      const flushed = !!typingSample && flushInteractiveResponse(
        typingDiagnosticsEnabled
          ? () => console.debug('[TerminalTyping]', {
              inputHandlerMs: Math.round(typingSample.inputHandlerMs),
              responseMs: Math.round(typingSample.responseMs),
              xtermQueueMs: Math.round(performance.now() - now),
            })
          : undefined,
      )
      if (!flushed) scheduleRenderFlush()
    }
  }
}

async function flushStartupNotices() {
  try {
    const notices = await window.LiteConnect.sshTakeStartupNotices(props.sessionId)
    for (const notice of notices) appendIncomingTerminalData(notice)
  } catch {
    // A notice is diagnostic only; never interrupt the terminal session.
  }
}

onMounted(async () => {
  if (!terminalRef.value) return

  try {
    typingDiagnosticsEnabled = sessionStorage.getItem('liteconnect:terminal-typing-diagnostics') === '1'
    if (import.meta.env.DEV) {
      const configuredDelay = Number(sessionStorage.getItem('liteconnect:terminal-simulated-latency-ms'))
      if (Number.isFinite(configuredDelay) && configuredDelay > 0) {
        delayedOutput = createDelayedTerminalOutput(appendIncomingTerminalData, Math.min(configuredDelay, 5000))
      }
    }
  } catch {
    typingDiagnosticsEnabled = false
  }

  await loadTerminalSettings()
  attachSettingsListeners()
  await suggest.loadCommandSuggestSetting()
  window.addEventListener('terminal-behavior-settings-change', suggest.onTerminalBehaviorSettingsChange)
  window.addEventListener('terminal-behavior-settings-change', onTerminalLocalEchoSettingChange)
  window.addEventListener('shell-command-history-cleared', suggest.onShellCommandHistoryCleared)

  const terminal = createTerminal(props.connectionName)
  if (!terminal) return
  void window.LiteConnect.getAllSettings().then((settings) => {
    localEcho.setEnabled(settings.terminalLocalEchoEnabled === true)
  }).catch(() => localEcho.setEnabled(false))
  registerTerminalResource(props.sessionId, () => {
    const current = getTerminal()
    if (!current) return null
    return { cols: current.cols, bufferLines: current.buffer.active.length }
  })

  bindSearchAddon(getSearchAddon())
  applyActiveState(isEffectiveActive())
  suggest.bindSuggestScroll(terminal)

  terminal.attachCustomKeyEventHandler(handleKey)

  terminal.onData((data) => {
    typingResponse.noteInput(data, !readOnly.value && !isPasting())
    localEcho.onInput(data, !readOnly.value && !isPasting() && isEffectiveActive() && !reconnect.disconnected.value)
    handleTerminalUserInput(data)
    typingResponse.finishInputHandler()
  })
  terminal.onWriteParsed(() => localEcho.reconcile())
  terminal.onResize(() => localEcho.clear())

  unsubData = window.LiteConnect.onSshData(props.sessionId, (data) => {
    if (delayedOutput) delayedOutput.push(data)
    else appendIncomingTerminalData(data)
  })
  void flushStartupNotices()

  unsubClosed = window.LiteConnect.onSshClosed(props.sessionId, () => {
    localEcho.clear()
    reconnect.noteDisconnectedAndMaybeReconnect({ message: 'Connection closed' })
  })

  unsubReconnected = window.LiteConnect.onSshReconnected?.(props.sessionId, () => {
    localEcho.clear()
    reconnect.markReconnectedInPlace()
    if (isOutputPaused()) window.LiteConnect.sshSetOutputPaused(props.sessionId, true)
    void flushStartupNotices()
  }) ?? null

  unsubError = window.LiteConnect.onSshError(props.sessionId, (error) => {
    localEcho.clear()
    if (isNonRetryableSshError(error)) {
      reconnect.applyNonRetryableError(error)
      return
    }
    reconnect.noteDisconnectedAndMaybeReconnect({ message: `Error: ${error}` })
  })

  window.addEventListener('request-terminal-pwd', onRequestTerminalPwd)
  window.addEventListener('ssh-reconnect-failed', reconnect.onReconnectFailed)
  window.addEventListener('beforeunload', reconnect.onAppUnloading)
  window.addEventListener('pagehide', reconnect.onAppUnloading)

  await reconnect.loadAutoReconnectSettings()
  reconnect.applyStartDisconnected()

  await nextTick()
  if (isEffectiveActive()) {
    attachResizeObserver()
    scheduleTerminalRefresh(true)
  }
})

watch([theme, customColors, terminalPalette], () => {
  applyTerminalTheme()
})

onBeforeUnmount(() => {
  unregisterTerminalResource(props.sessionId)
  window.removeEventListener('terminal-behavior-settings-change', suggest.onTerminalBehaviorSettingsChange)
  window.removeEventListener('terminal-behavior-settings-change', onTerminalLocalEchoSettingChange)
  window.removeEventListener('shell-command-history-cleared', suggest.onShellCommandHistoryCleared)
  window.removeEventListener('request-terminal-pwd', onRequestTerminalPwd)
  window.removeEventListener('ssh-reconnect-failed', reconnect.onReconnectFailed)
  window.removeEventListener('beforeunload', reconnect.onAppUnloading)
  window.removeEventListener('pagehide', reconnect.onAppUnloading)
  reconnect.dispose()
  disposePwdQuery()
  disposeSearchListeners()
  cancelPendingSubmit()
  clearWriteQueue()
  resetCommandBuffer()
  resetRenderBatch()
  if (cursorPulseTimer) {
    clearTimeout(cursorPulseTimer)
    cursorPulseTimer = null
  }
  suggest.dispose()
  localEcho.clear()
  delayedOutput?.dispose()
  unsubData?.()
  unsubClosed?.()
  unsubReconnected?.()
  unsubError?.()
  disposeTerminal()
})

function focusTerminal(): boolean {
  return focusLiveTerminal({
    active: isEffectiveActive(),
    getTerminal,
  })
}

defineExpose({
  focusTerminal,
  sessionId: props.sessionId,
})
</script>

<template>
  <div class="terminal-wrapper" @contextmenu="selection.openSelectionMenu" @keydown="reconnect.onWrapperKeydown">
    <div v-if="readOnly" class="read-only-badge" role="status">
      <AppIcon name="lock" size="xs" />
      <span>{{ t('terminal.readOnlyBadge') }}</span>
    </div>
    <TerminalSearchBar
      v-if="searchVisible"
      :search-query="searchQuery"
      :case-sensitive="caseSensitive"
      :use-regex="useRegex"
      :match-index="matchIndex"
      :match-count="matchCount"
      @update:search-query="searchQuery = $event"
      @update:case-sensitive="caseSensitive = $event"
      @update:use-regex="useRegex = $event"
      @set-input-ref="setSearchInputRef"
      @input="onSearchInput"
      @keydown="onSearchKeydown"
      @find-previous="findPrevious"
      @find-next="findNext"
      @re-run="reRunSearch"
      @close="toggleSearch"
    />
    <div ref="terminalRef" class="xterm-container" :class="{ 'local-echo-active': !!localEcho.text.value }">
      <span
        v-if="localEcho.text.value"
        class="terminal-local-echo"
        :style="{
          left: `${localEcho.left.value}px`,
          top: `${localEcho.top.value}px`,
          lineHeight: `${localEcho.cellHeight.value}px`,
          fontSize: `${localEcho.fontSize.value}px`,
          fontFamily: localEcho.fontFamily.value,
          color: localEcho.color.value,
        }"
      >{{ localEcho.text.value }}</span>
      <span
        v-if="localEcho.text.value"
        class="terminal-local-echo-caret"
        :style="{
          left: `${localEcho.left.value + localEcho.text.value.length * localEcho.cellWidth.value}px`,
          top: `${localEcho.top.value}px`,
          height: `${localEcho.cellHeight.value}px`,
          backgroundColor: localEcho.color.value,
        }"
      ></span>
    </div>
    <TerminalCommandSuggest
      :visible="suggestVisible"
      :items="suggestItems"
      :active-index="suggestActiveIndex"
      :left="suggestLeft"
      :top="suggestTop"
      :place-above="suggestPlaceAbove"
      @update:active-index="suggestActiveIndex = $event"
      @pick="suggest.onSuggestPick"
    />
    <TerminalSelectionMenu
      :visible="selectionMenuVisible"
      :x="selectionMenuX"
      :y="selectionMenuY"
      :selected-text="selectedText"
      :read-only="readOnly"
      :ai-disabled="aiDisabled"
      @set-ref="(el) => (selection.selectionMenuRef.value = el)"
      @copy="selection.copySelection"
      @paste="selection.pasteToTerminal"
      @select-all="selection.selectAllInTerminal"
      @clear-screen="clearScreenKeepScrollback"
      @clear-scrollback="clearScrollback"
      @toggle-read-only="toggleReadOnly"
      @send-to-ai="selection.sendSelectionToAi"
      @save-as-snippet="selection.saveSelectionAsSnippet"
    />
    <TerminalReconnectOverlay
      :disconnected="disconnected"
      :reconnecting="reconnecting"
      :attempt="reconnectAttempt"
      :max-retries="autoReconnectMaxRetries"
      :exhausted="autoReconnectExhausted"
      :never-connected="neverConnected"
      :detail="disconnectDetail"
      @reconnect="reconnect.handleReconnect"
      @cancel-auto="reconnect.cancelAutoReconnect"
      @keydown="reconnect.onWrapperKeydown"
    />
  </div>
</template>

<style scoped>
/*
 * Padding lives on the wrapper, not on .xterm-container.
 * FitAddon measures the terminal parent with border-box height and does not
 * subtract parent padding — padding on the fit host over-counts rows so the
 * canvas is taller than the content box. overflow:hidden ancestors then clip
 * the last row (descenders: y→V) and scrollback cannot show full glyphs.
 */
.terminal-wrapper {
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 4px;
  box-sizing: border-box;
}

.xterm-container {
  position: relative;
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
}

.terminal-local-echo {
  position: absolute;
  z-index: 3;
  opacity: 0.48;
  white-space: pre;
  pointer-events: none;
  user-select: none;
}

.terminal-local-echo-caret {
  position: absolute;
  z-index: 3;
  width: 2px;
  opacity: 0.7;
  pointer-events: none;
}

.xterm-container.local-echo-active :deep(.xterm-cursor-layer .xterm-cursor) {
  opacity: 0;
}

.read-only-badge {
  position: absolute;
  top: 8px;
  right: 12px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  pointer-events: none;
}

.xterm-container.cursor-pulse :deep(.xterm-cursor-layer .xterm-cursor) {
  opacity: 1 !important;
  filter: brightness(1.4) drop-shadow(0 0 2px var(--accent));
  transition: filter 0.05s ease-out;
}
</style>
