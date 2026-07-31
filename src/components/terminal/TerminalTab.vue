<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, onActivated, onDeactivated, nextTick, inject, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import '@xterm/xterm/css/xterm.css'
import type { Theme, CustomColors } from '@/composables/app/useTheme'
import { usePasteDetection } from '../../composables/terminal/usePasteDetection'
import { useCommandBuffer } from '../../composables/terminal/useCommandBuffer'
import { useRenderBatch } from '../../composables/terminal/useRenderBatch'
import { useWriteQueue } from '../../composables/terminal/useWriteQueue'
import { useTerminalPwdQuery } from '../../composables/terminal/useTerminalPwdQuery'
import { useTerminalSearch } from '../../composables/terminal/useTerminalSearch'
import { useTerminalKeyHandler } from '../../composables/terminal/useTerminalKeyHandler'
import { useXtermInstance } from '../../composables/terminal/useXtermInstance'
import {
  buildShellSuggestions,
  extractSuggestPrefix,
  suggestCompletionSuffix,
  type ShellHistoryEntry,
  type ShellSuggestItem,
} from '@/utils/terminal/shellCommandSuggest'
import { looksLikeFailedShellOutput } from '@/utils/terminal/shellHistoryEligibility'
import { isContainerEnterCommand } from '@/utils/docker/containerEnterCommand'
import { markSftpFollowPausedByContainer } from '../../composables/sftp/sftpFollowPause'
import TerminalCommandSuggest from './TerminalCommandSuggest.vue'
import {
  clearAutoReconnectAttempts,
  noteAutoReconnectAttempt,
} from '../../composables/session/useAutoReconnectBudget'
import { appConfirm } from '@/composables/app/useAppDialog'
import AppIcon from '../icons/AppIcon.vue'
import {
  buildPastePreview,
  countPasteLines,
  shouldConfirmPaste,
} from '@/utils/terminal/terminalPaste'
import { isNonRetryableSshError } from '@/utils/session/sshErrorRetry'
import { focusLiveTerminal } from '@/utils/terminal/workspaceTerminalFocus'
import { computeEffectiveTerminalActive } from '@/utils/terminal/terminalResizePolicy'
import TerminalSearchBar from './TerminalSearchBar.vue'
import TerminalReconnectOverlay from './TerminalReconnectOverlay.vue'
import { fitFixedElement } from '@/utils/shared/popupPosition'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'

const props = withDefaults(
  defineProps<{
    sessionId: string
    connectionName: string
    connectionId: string
    /** Visible pane (primary or split secondary). Background tabs stay mounted but freeze paint. */
    active?: boolean
    /**
     * Terminal workspace host visible (false in Docker mode).
     * Combined with active for resize/blink/focus; SSH session stays connected either way.
     */
    workspaceVisible?: boolean
  }>(),
  { active: true, workspaceVisible: true },
)

const emit = defineEmits<{
  (e: 'closed', sessionId: string): void
  (e: 'cdCommand', sessionId: string, command: string): void
  (e: 'pwdOutput', sessionId: string, pwd: string): void
  (e: 'reconnect', sessionId: string): void
  (e: 'reconnect-all', connectionId: string): void
  (e: 'aiSelection', text: string, mode: 'send' | 'insert'): void
  (e: 'saveAsSnippet', text: string): void
}>()

const { t } = useI18n()
const terminalRef = ref<HTMLDivElement>()
const theme = inject<import('vue').Ref<Theme>>('theme')!
const customColors = inject<import('vue').Ref<CustomColors>>('customColors')!

const disconnected = ref(false)
const reconnecting = ref(false)
const reconnectAttempt = ref(0)
/** 自动重试已达上限，等待用户手动重连 */
const autoReconnectExhausted = ref(false)
let autoReconnectTimer: ReturnType<typeof setTimeout> | null = null
let autoReconnectEnabled = true
const autoReconnectMaxRetries = ref(5)
let userDismissedAutoReconnect = false
/** 应用正在关闭时不再调度重连（避免 X 掉窗口时误触发） */
let appUnloading = false
const selectionMenuVisible = ref(false)
const selectionMenuX = ref(0)
const selectionMenuY = ref(0)
const selectionMenuRef = ref<HTMLElement | null>(null)
const selectedText = ref('')
let selectionMenuPreferred = { x: 0, y: 0 }
let unsubData: (() => void) | null = null
let unsubClosed: (() => void) | null = null
let unsubReconnected: (() => void) | null = null
let unsubError: (() => void) | null = null

// Deferred so useXtermInstance can call flushRenderBatch without circular init
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

const shellHistory = ref<ShellHistoryEntry[]>([])
const commandSuggestEnabled = ref(false)
/** -1 means the popup is visible but no suggestion has been explicitly chosen. */
const suggestActiveIndex = ref(-1)
const suggestDismissed = ref(false)
const suggestCursorOutOfView = ref(false)
const suggestLeft = ref(12)
const suggestTop = ref(12)
const suggestPlaceAbove = ref(false)
let suggestPosRaf: number | null = null
let suggestScrollDisp: { dispose: () => void } | null = null

const {
  commandBuffer,
  commandBufferDirty,
  capturedSubmitLine,
  submitBufferedCommand,
  scheduleSubmit,
  cancelPendingSubmit,
  resetCommandBuffer,
  getVisibleCommandLine,
  extractCommandFromVisibleLine,
} = useCommandBuffer({
  getTerminal,
  onCdCommand: (cmd) => emit('cdCommand', props.sessionId, cmd),
  onSubmitted: (cmd) => {
    suggestDismissed.value = false
    if (cmd?.trim() && isContainerEnterCommand(cmd)) {
      // SFTP is host FS only — pause follow so container cwd does not drag the file tree.
      markSftpFollowPausedByContainer(props.sessionId)
      window.dispatchEvent(
        new CustomEvent('sftp-pause-follow', {
          detail: { sessionId: props.sessionId, reason: 'container' },
        }),
      )
    }
    // Always record shell history (used by command suggest). Do not gate on
    // suggest-enabled — paste/submit must still enter history when suggest is off.
    if (!cmd || !cmd.trim()) return
    scheduleHistorySniff(cmd.trim())
  },
})

const suggestItems = computed(() => {
  if (!commandSuggestEnabled.value) return []
  if (suggestDismissed.value || commandBufferDirty.value) return []
  if (!isEffectiveActive() || disconnected.value) return []
  const q = commandBuffer.value
  if (!q.trim()) return []
  return buildShellSuggestions({
    query: q,
    history: shellHistory.value,
    historyLimit: 5,
    systemLimit: 3,
    describe: (key) => t(key),
  })
})

const suggestVisible = computed(
  () => suggestItems.value.length > 0 && !suggestCursorOutOfView.value,
)

/** Buffer-based anchor (stable on blink); hide when cursor scrolled out of view. */
function updateSuggestPosition() {
  const wrap = terminalRef.value?.closest('.terminal-wrapper') as HTMLElement | null
  const term = getTerminal()
  if (!wrap || !term?.element) return

  const wrapRect = wrap.getBoundingClientRect()
  const panelW = Math.min(420, wrapRect.width - 16)
  const panelH = Math.min(160, wrapRect.height * 0.35)
  const gap = 14

  const core = term as unknown as {
    _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } }
  }
  const cell = core._core?._renderService?.dimensions?.css?.cell
  const cellW = cell?.width || 8
  const cellH = cell?.height || 16
  const screen =
    (term.element.querySelector('.xterm-screen') as HTMLElement | null) || term.element
  const screenRect = screen.getBoundingClientRect()
  const buf = term.buffer.active
  // Absolute cursor row vs viewport top
  const absCursorY = buf.baseY + buf.cursorY
  const rowInViewport = absCursorY - buf.viewportY
  if (rowInViewport < 0 || rowInViewport >= term.rows) {
    if (!suggestCursorOutOfView.value) suggestCursorOutOfView.value = true
    return
  }
  if (suggestCursorOutOfView.value) suggestCursorOutOfView.value = false

  let left = screenRect.left - wrapRect.left + buf.cursorX * cellW
  const cursorTop = screenRect.top - wrapRect.top + rowInViewport * cellH
  const cursorBottom = cursorTop + cellH

  const placeAbove =
    cursorBottom + gap + panelH > wrapRect.height - 8 && cursorTop - gap - panelH > 8
  left = Math.max(8, Math.min(left, wrapRect.width - panelW - 8))
  const top = placeAbove ? cursorTop - gap : cursorBottom + gap

  const nextLeft = Math.round(left)
  const nextTop = Math.round(top)
  if (suggestLeft.value !== nextLeft) suggestLeft.value = nextLeft
  if (suggestTop.value !== nextTop) suggestTop.value = nextTop
  if (suggestPlaceAbove.value !== placeAbove) suggestPlaceAbove.value = placeAbove
}

function scheduleSuggestPosition() {
  if (suggestPosRaf != null) return
  suggestPosRaf = requestAnimationFrame(() => {
    suggestPosRaf = null
    if (suggestItems.value.length === 0) return
    updateSuggestPosition()
  })
}

async function loadShellHistory() {
  try {
    const list = await window.LiteConnect.listShellCommandHistory(props.connectionId)
    shellHistory.value = Array.isArray(list) ? list : []
  } catch {
    shellHistory.value = []
  }
}

async function loadCommandSuggestSetting() {
  try {
    commandSuggestEnabled.value = await window.LiteConnect.getTerminalCommandSuggestEnabled()
  } catch {
    commandSuggestEnabled.value = false
  }
  if (commandSuggestEnabled.value) void loadShellHistory()
}

function onTerminalBehaviorSettingsChange(event: Event) {
  const enabled = (event as CustomEvent).detail?.commandSuggestEnabled
  if (typeof enabled !== 'boolean') return
  commandSuggestEnabled.value = enabled
  if (enabled) {
    suggestDismissed.value = false
    void loadShellHistory()
  } else {
    cancelHistorySniff()
    hideSuggest()
  }
}

async function pushShellHistory(command: string) {
  try {
    const list = await window.LiteConnect.pushShellCommandHistory(props.connectionId, command)
    shellHistory.value = Array.isArray(list) ? list : shellHistory.value
  } catch {
    // keep local optimistic entry
    const item = { command, at: Date.now() }
    shellHistory.value = [item, ...shellHistory.value.filter((h) => h.command !== command)].slice(0, 200)
  }
}

/** After Enter: sniff remote output briefly; skip history if clearly a failed invocation. */
const HISTORY_SNIFF_MS = 1000
let historySniffCmd: string | null = null
let historySniffBuf = ''
let historySniffTimer: ReturnType<typeof setTimeout> | null = null

function cancelHistorySniff() {
  if (historySniffTimer) {
    clearTimeout(historySniffTimer)
    historySniffTimer = null
  }
  historySniffCmd = null
  historySniffBuf = ''
}

function scheduleHistorySniff(command: string) {
  cancelHistorySniff()
  historySniffCmd = command
  historySniffBuf = ''
  historySniffTimer = setTimeout(() => {
    const cmd = historySniffCmd
    const buf = historySniffBuf
    historySniffTimer = null
    historySniffCmd = null
    historySniffBuf = ''
    if (!cmd) return
    if (looksLikeFailedShellOutput(buf)) return
    void pushShellHistory(cmd)
  }, HISTORY_SNIFF_MS)
}

function feedHistorySniff(chunk: string) {
  if (!historySniffCmd || !chunk) return
  historySniffBuf += chunk
  if (historySniffBuf.length > 12000) {
    historySniffBuf = historySniffBuf.slice(-8000)
  }
  if (looksLikeFailedShellOutput(historySniffBuf)) {
    cancelHistorySniff()
  }
}

function hideSuggest() {
  suggestDismissed.value = true
  suggestActiveIndex.value = -1
}

function applySuggestItem(item: ShellSuggestItem, execute = false) {
  const segment = extractSuggestPrefix(commandBuffer.value)
  const { clearCount, write } = suggestCompletionSuffix(segment, item.command)
  let payload = ''
  if (clearCount > 0) payload += '\x7f'.repeat(clearCount)
  payload += write
  // Local buffer: replace last segment
  const full = commandBuffer.value
  const re = /^(.*(?:&&|\|\||[;|])\s*)?(.*)$/s
  const m = full.match(re)
  const prefix = m?.[1] || ''
  const seg = m?.[2] || ''
  const leadingWs = seg.match(/^\s*/)?.[0] || ''
  commandBuffer.value = `${prefix}${leadingWs}${item.command}`
  commandBufferDirty.value = false
  hideSuggest()
  if (execute) {
    submitBufferedCommand()
    payload += '\r'
  }
  if (payload) window.LiteConnect.sshWrite(props.sessionId, payload)
}

function onSuggestPick(item: ShellSuggestItem) {
  applySuggestItem(item)
}

function handleSuggestKey(event: KeyboardEvent): boolean {
  if (!suggestVisible.value) return true
  if (event.key === 'Escape') {
    event.preventDefault()
    hideSuggest()
    return false
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    const n = suggestItems.value.length
    if (n > 0) suggestActiveIndex.value = suggestActiveIndex.value < 0 ? 0 : (suggestActiveIndex.value + 1) % n
    return false
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    const n = suggestItems.value.length
    if (n > 0) suggestActiveIndex.value = suggestActiveIndex.value < 0 ? n - 1 : (suggestActiveIndex.value - 1 + n) % n
    return false
  }
  // A plain Enter keeps normal terminal behavior until the user explicitly
  // chooses a row with ArrowUp/ArrowDown. Tab remains remote shell completion.
  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const item = suggestItems.value[suggestActiveIndex.value]
    if (!item) return true
    event.preventDefault()
    applySuggestItem(item, true)
    return false
  }
  return true
}

const {
  flushRenderBatch,
  scheduleRenderFlush,
  appendRenderBatch,
  resetRenderBatch,
  setRenderFrozen,
} = useRenderBatch(getTerminal)

flushRenderBatchFn = flushRenderBatch

/**
 * Foreground vs background for paint/resize only.
 * SSH data path stays subscribed; xterm instance is never recreated here.
 * Docker mode sets workspaceVisible=false so hidden host is not treated as foreground.
 */
function applyActiveState(isActive: boolean) {
  setRenderFrozen(!isActive)
  const terminal = getTerminal()
  if (terminal) {
    // Hidden panes / Docker: stop cursor blink repaints; keep buffer + SSH write path.
    terminal.options.cursorBlink = isActive
  }
  if (isActive) {
    attachResizeObserver()
    // Local fit/refresh; sshResize only if cols/rows changed (see useXtermInstance).
    scheduleTerminalRefresh(true)
  } else {
    cancelScheduledTerminalRefresh()
    detachResizeObserver()
    hideSelectionMenu()
  }
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
  // Locate cwd injects a shell probe: save/clear/restore uncommitted input so
  // the user does not end up with ghost text that cannot be backspaced.
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

/**
 * Send paste as normal keystrokes (CR newlines, no bracketed-paste wrappers).
 * `terminal.paste()` wraps `\x1b[200~…\x1b[201~` when the shell enabled bracketed
 * paste; some bash/zsh setups then do not put the line into ↑↓ history the same
 * way as typed input. Writing plain bytes matches hand-typing for remote history.
 */
function pasteAsTypedInput(text: string) {
  if (!text) return
  // Shells expect CR for "end of line", not bare LF.
  const payload = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r')
  handleTerminalUserInput(payload)
}

async function pasteWithConfirm(text: string) {
  const terminal = getTerminal()
  if (!terminal || !text) return
  try {
    if (pasteConfirmEnabled.value && shouldConfirmPaste(text, pasteConfirmMaxChars.value)) {
      const lines = countPasteLines(text)
      await appConfirm({
        title: t('terminal.pasteConfirmTitle'),
        message: t('terminal.pasteConfirmMessage', { lines, chars: text.length }),
        detail: buildPastePreview(text),
        confirmText: t('terminal.pasteConfirmAction'),
        cancelText: t('common.cancel'),
        tone: 'warning',
      })
    }
    pasteAsTypedInput(text)
  } catch {
    // User cancelled the confirmation.
  } finally {
    // Dialog/context-menu buttons take DOM focus. Restore xterm after Vue has
    // removed the overlay/menu so the next keystroke goes to SSH immediately.
    await nextTick()
    if (props.active && getTerminal() === terminal) terminal.focus()
  }
}

/** User keystrokes / paste → local command buffer + SSH PTY (same path for both). */
function handleTerminalUserInput(data: string) {
  updatePasteState(data)

  if (data.length === 1 && isLocallyEchoable(data) && !isPasting()) {
    pulseCursor()
  }

  const isSubmit = data === '\r' || data === '\n'
  const isCancel = data === '\x03' || data === '\x15'
  const isBackspace = data === '\x7f' || data === '\x08'
  const isTab = data === '\t' || data === '\x09'
  const isEscape = data.charCodeAt(0) === 0x1b
  const hasNewline = data.includes('\r') || data.includes('\n')

  // Strip bracketed-paste markers if any (legacy paste path / remote quirks).
  const plainChunk = data
    .replace(/\x1b\[200~/g, '')
    .replace(/\x1b\[201~/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')

  if (isSubmit) {
    hideSuggest()
    // Always capture the on-screen line at Enter — not the local buffer.
    // Tab-completion expands only on the remote PTY; commandBuffer stays a stale
    // prefix (e.g. "cd /home/doc" while the screen shows "cd /home/docker/").
    // Preferring the buffer (a0fe6e2) made SFTP follow jump to a missing path.
    // Restore pre-a0fe6e2 behavior: visible line is the source of truth on submit.
    capturedSubmitLine.value = getVisibleCommandLine().replace(/\[Pasted[^\]]*\]\s*/g, '')
    scheduleSubmit()
  } else if (isCancel) {
    cancelPendingSubmit()
    resetCommandBuffer()
    hideSuggest()
  } else if (isBackspace) {
    suggestDismissed.value = false
    if (commandBuffer.value.length > 0) commandBuffer.value = commandBuffer.value.slice(0, -1)
  } else if (data === '\x17') {
    suggestDismissed.value = false
    commandBuffer.value = commandBuffer.value.replace(/\S+\s*$/, '')
  } else if (isTab) {
    // Tab goes to remote shell completion; drop local suggest so they do not fight
    hideSuggest()
    commandBufferDirty.value = true
  } else if (isLocallyEchoable(data) && !isPasting()) {
    // Match pre-a0fe6e2: do not fold paste bytes into the local buffer.
    // pasteAsTypedInput still writes plain keystrokes to the PTY for shell history;
    // cd/follow inference uses the visible line (or hasNewline line scan) instead.
    suggestDismissed.value = false
    commandBuffer.value += data
  } else if (isEscape) {
    if (suggestVisible.value) {
      // Esc closes suggest only (handleKey); do not wipe buffer
    } else {
      commandBuffer.value = ''
      commandBufferDirty.value = true
    }
  } else if (hasNewline) {
    // Multi-line paste / embedded CR: scan lines for cd (same as pre-a0fe6e2).
    // Do not seed capturedSubmitLine from the local buffer — it may be a stale
    // prefix after tab-complete, and scheduleSubmit would double-apply the first cd.
    hideSuggest()
    commandBufferDirty.value = true
    const lines = plainChunk.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (/(?:^|[;&|]\s*)cd(?:\s|$)/.test(trimmed)) {
        setTimeout(() => {
          emit('cdCommand', props.sessionId, trimmed)
        }, 50)
      }
    }
    scheduleSubmit()
  }

  if (data.length > 32 || getWriteQueueLength() > 0) {
    enqueueWrite(data, props.sessionId)
  } else {
    window.LiteConnect.sshWrite(props.sessionId, data)
  }
}

const { handleKey: handleTerminalKey } = useTerminalKeyHandler({
  getTerminal,
  getFontSize: () => fontSize.value,
  setFontSize: (size) => {
    setFontSize(size)
    window.LiteConnect.setTerminalFontSize(size).catch(() => {})
  },
  toggleSearch,
  pasteText: pasteWithConfirm,
})

function handleKey(event: KeyboardEvent): boolean {
  if (!handleSuggestKey(event)) return false
  return handleTerminalKey(event)
}

watch(suggestItems, (list) => {
  if (suggestActiveIndex.value >= list.length) {
    suggestActiveIndex.value = -1
  }
})

watch(
  [commandBuffer, suggestItems],
  async () => {
    if (suggestItems.value.length === 0) {
      suggestCursorOutOfView.value = false
      return
    }
    await nextTick()
    scheduleSuggestPosition()
  },
  { flush: 'post' },
)

function isLocallyEchoable(data: string): boolean {
  if (data.length === 0) return false
  if (data.charCodeAt(0) === 0x1b) return false
  for (const ch of data) {
    const code = ch.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

let cursorPulseTimer: ReturnType<typeof setTimeout> | null = null

function pulseCursor() {
  if (!props.active || !terminalRef.value) return
  terminalRef.value.classList.add('cursor-pulse')
  if (cursorPulseTimer) clearTimeout(cursorPulseTimer)
  cursorPulseTimer = setTimeout(() => {
    terminalRef.value?.classList.remove('cursor-pulse')
    cursorPulseTimer = null
  }, 120)
}

function hideSelectionMenu() {
  selectionMenuVisible.value = false
}

useOutsideDismiss(
  () => selectionMenuVisible.value,
  hideSelectionMenu,
  () => [selectionMenuRef.value],
)

async function repositionSelectionMenu() {
  await nextTick()
  const el = selectionMenuRef.value
  if (!el || !selectionMenuVisible.value) return
  // Two rAFs: wait for teleported DOM + layout of conditional items (selection extras)
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  if (!selectionMenuRef.value || !selectionMenuVisible.value) return
  const pos = fitFixedElement(selectionMenuRef.value, selectionMenuPreferred)
  selectionMenuX.value = pos.left
  selectionMenuY.value = pos.top
}

function openSelectionMenu(event: MouseEvent) {
  const terminal = getTerminal()
  if (!terminal) return
  event.preventDefault()
  event.stopPropagation()
  const text = terminal.hasSelection() ? terminal.getSelection().trim() : ''
  selectedText.value = text
  selectionMenuPreferred = { x: event.clientX, y: event.clientY }
  // Provisional position; refined after measure so tall menus near edges stay in view
  selectionMenuX.value = event.clientX
  selectionMenuY.value = event.clientY
  selectionMenuVisible.value = true
  void repositionSelectionMenu()
}

function copySelection() {
  const terminal = getTerminal()
  const text = selectedText.value || (terminal?.hasSelection() ? terminal?.getSelection() : '') || ''
  if (!text) return
  window.LiteConnect.clipboardWriteText(text).catch(() => {})
  hideSelectionMenu()
}

async function pasteToTerminal() {
  const terminal = getTerminal()
  hideSelectionMenu()
  try {
    const text = await window.LiteConnect.clipboardReadText()
    if (text) await pasteWithConfirm(text)
  } catch {
    // Clipboard read/cancel should not leave the terminal unfocused.
  } finally {
    await nextTick()
    if (props.active && terminal && getTerminal() === terminal) terminal.focus()
  }
}

function clearScrollback() {
  getTerminal()?.clear()
  hideSelectionMenu()
  ElMessage.success(t('terminal.clearedBuffer'))
}

function clearScreenKeepScrollback() {
  // Send form-feed / clear command is remote; local clear leaves scrollback
  getTerminal()?.write('\x1b[H\x1b[2J')
  hideSelectionMenu()
}

function selectAllInTerminal() {
  getTerminal()?.selectAll()
  hideSelectionMenu()
}

function sendSelectionToAi(mode: 'send' | 'insert') {
  const text = selectedText.value || getTerminal()?.getSelection()?.trim() || ''
  if (!text) return
  emit('aiSelection', text, mode)
  hideSelectionMenu()
}

function saveSelectionAsSnippet() {
  const text = selectedText.value || getTerminal()?.getSelection()?.trim() || ''
  if (!text) return
  emit('saveAsSnippet', text)
  hideSelectionMenu()
}

function clearAutoReconnectTimer() {
  if (autoReconnectTimer) {
    clearTimeout(autoReconnectTimer)
    autoReconnectTimer = null
  }
}

/**
 * Unified disconnect path for closed / error / reconnect-failed.
 * - closed/error: only start auto-reconnect if not already in a reconnect attempt
 * - reconnect-failed (reschedule): clear reconnecting and schedule the next attempt
 */
function noteDisconnectedAndMaybeReconnect(opts?: {
  message?: string
  /** true when in-place sshReconnect IPC failed — must reschedule auto-retry */
  reschedule?: boolean
}) {
  if (appUnloading) return
  const wasDisconnected = disconnected.value
  disconnected.value = true
  // Avoid duplicate red lines when error + closed both fire for the same drop
  if (opts?.message && (!wasDisconnected || opts.reschedule)) {
    flushRenderBatch()
    const term = getTerminal()
    if (term) {
      term.writeln(`\r\n\x1b[1;31m--- ${opts.message} ---\x1b[0m`)
    }
  }
  if (opts?.reschedule) {
    reconnecting.value = false
    void scheduleAutoReconnect()
    return
  }
  // Already waiting on a timer or an in-flight reconnect — avoid double budget burn
  // when error + closed arrive together, or error fires during reconnect teardown.
  if (autoReconnectTimer || reconnecting.value) return
  void scheduleAutoReconnect()
}

function markReconnectedInPlace() {
  clearAutoReconnectTimer()
  clearAutoReconnectAttempts(props.connectionId)
  disconnected.value = false
  reconnecting.value = false
  autoReconnectExhausted.value = false
  reconnectAttempt.value = 0
  userDismissedAutoReconnect = false
  const terminal = getTerminal()
  if (terminal) {
    terminal.writeln('\r\n\x1b[1;32m--- Reconnected ---\x1b[0m\r\n')
  }
  scheduleTerminalRefresh(true)
  // Sync PTY size after shell is ready (force once after true reconnect)
  nextTick(() => {
    try {
      performResize({ forceSshResize: true })
    } catch {}
  })
}

function onReconnectFailed(event: Event) {
  const detail = (event as CustomEvent<{
    sessionId: string
    message?: string
    nonRetryable?: boolean
  }>).detail
  if (!detail || detail.sessionId !== props.sessionId) return
  const msg = detail.message
    ? `Reconnect failed: ${detail.message}`
    : 'Reconnect failed'
  // Host key / auth failures: show error and stop auto-retry (do not burn budget)
  if (detail.nonRetryable || isNonRetryableSshError(detail.message)) {
    clearAutoReconnectTimer()
    reconnecting.value = false
    disconnected.value = true
    autoReconnectExhausted.value = false
    flushRenderBatch()
    const term = getTerminal()
    if (term) {
      term.writeln(`\r\n\x1b[1;31m--- ${msg} ---\x1b[0m`)
    }
    return
  }
  noteDisconnectedAndMaybeReconnect({ message: msg, reschedule: true })
}

function handleReconnect() {
  // 手动重连：清零计数，不受自动上限限制
  clearAutoReconnectTimer()
  clearAutoReconnectAttempts(props.connectionId)
  userDismissedAutoReconnect = false
  autoReconnectExhausted.value = false
  reconnectAttempt.value = 0
  reconnecting.value = true
  const terminal = getTerminal()
  if (terminal) {
    terminal.writeln('\r\n\x1b[1;33m--- Reconnecting… ---\x1b[0m\r\n')
  }
  emit('reconnect', props.sessionId)
}

function handleReconnectAll() {
  clearAutoReconnectTimer()
  clearAutoReconnectAttempts(props.connectionId)
  userDismissedAutoReconnect = false
  autoReconnectExhausted.value = false
  reconnectAttempt.value = 0
  reconnecting.value = true
  const terminal = getTerminal()
  if (terminal) {
    terminal.writeln('\r\n\x1b[1;33m--- Reconnecting all sessions… ---\x1b[0m\r\n')
  }
  emit('reconnect-all', props.connectionId)
}

function cancelAutoReconnect() {
  userDismissedAutoReconnect = true
  clearAutoReconnectTimer()
  reconnecting.value = false
  autoReconnectExhausted.value = false
}

async function scheduleAutoReconnect() {
  if (appUnloading) return
  if (!autoReconnectEnabled || userDismissedAutoReconnect) return

  const { ok, attempt } = noteAutoReconnectAttempt(
    props.connectionId,
    autoReconnectMaxRetries.value,
  )
  reconnectAttempt.value = attempt
  if (!ok) {
    // 已达最大次数，停止自动重试，保留断开遮罩供手动重连
    reconnecting.value = false
    autoReconnectExhausted.value = true
    ElMessage.warning(t('terminal.reconnectLimit', { name: props.connectionName }))
    return
  }

  autoReconnectExhausted.value = false
  reconnecting.value = true
  // 指数退避：1s → 2s → 4s → 8s → …，上限 15s
  const delay = Math.min(1000 * Math.pow(2, attempt - 1), 15000)
  clearAutoReconnectTimer()
  autoReconnectTimer = setTimeout(() => {
    autoReconnectTimer = null
    if (appUnloading) return
    emit('reconnect', props.sessionId)
  }, delay)
}

function onAppUnloading() {
  appUnloading = true
  clearAutoReconnectTimer()
  reconnecting.value = false
}

function onWrapperKeydown(e: KeyboardEvent) {
  if (!disconnected.value) return
  if (e.key === 'r' || e.key === 'R') {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    e.preventDefault()
    handleReconnect()
  }
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
    feedHistorySniff(visibleData)
    appendRenderBatch(visibleData)
    scheduleRenderFlush()
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

  await loadTerminalSettings()
  attachSettingsListeners()
  await loadCommandSuggestSetting()
  window.addEventListener('terminal-behavior-settings-change', onTerminalBehaviorSettingsChange)

  const terminal = createTerminal(props.connectionName)
  if (!terminal) return

  bindSearchAddon(getSearchAddon())
  applyActiveState(isEffectiveActive())

  suggestScrollDisp?.dispose()
  suggestScrollDisp = terminal.onScroll(() => {
    if (suggestItems.value.length === 0) return
    scheduleSuggestPosition()
  })

  terminal.attachCustomKeyEventHandler(handleKey)

  // Typing and paste both go through handleTerminalUserInput → same PTY bytes.
  terminal.onData((data) => {
    handleTerminalUserInput(data)
  })

  unsubData = window.LiteConnect.onSshData(props.sessionId, (data) => {
    appendIncomingTerminalData(data)
  })
  void flushStartupNotices()

  unsubClosed = window.LiteConnect.onSshClosed(props.sessionId, () => {
    // 用户主动关标签/关应用时不应自动重连；仅窗口仍在时的意外断线才重试
    noteDisconnectedAndMaybeReconnect({ message: 'Connection closed' })
  })

  unsubReconnected = window.LiteConnect.onSshReconnected?.(props.sessionId, () => {
    markReconnectedInPlace()
    void flushStartupNotices()
  }) ?? null

  unsubError = window.LiteConnect.onSshError(props.sessionId, (error) => {
    // Drive disconnect + auto-reconnect (do not rely on a later closed event alone).
    // Host Key / auth failures need user action — do not burn auto-retry budget.
    if (isNonRetryableSshError(error)) {
      clearAutoReconnectTimer()
      reconnecting.value = false
      disconnected.value = true
      autoReconnectExhausted.value = false
      flushRenderBatch()
      const term = getTerminal()
      if (term) {
        term.writeln(`\r\n\x1b[1;31m--- Error: ${error} ---\x1b[0m`)
      }
      return
    }
    noteDisconnectedAndMaybeReconnect({ message: `Error: ${error}` })
  })

  window.addEventListener('request-terminal-pwd', onRequestTerminalPwd)
  window.addEventListener('ssh-reconnect-failed', onReconnectFailed)
  window.addEventListener('beforeunload', onAppUnloading)
  window.addEventListener('pagehide', onAppUnloading)

  try {
    const [enabled, maxRetries] = await Promise.all([
      window.LiteConnect.getAutoReconnectEnabled(),
      window.LiteConnect.getAutoReconnectMaxRetries(),
    ])
    autoReconnectEnabled = enabled
    autoReconnectMaxRetries.value = maxRetries
  } catch {}

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
  appUnloading = true
  window.removeEventListener('terminal-behavior-settings-change', onTerminalBehaviorSettingsChange)
  window.removeEventListener('request-terminal-pwd', onRequestTerminalPwd)
  window.removeEventListener('ssh-reconnect-failed', onReconnectFailed)
  window.removeEventListener('beforeunload', onAppUnloading)
  window.removeEventListener('pagehide', onAppUnloading)
  clearAutoReconnectTimer()
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
  if (suggestPosRaf != null) {
    cancelAnimationFrame(suggestPosRaf)
    suggestPosRaf = null
  }
  cancelHistorySniff()
  suggestScrollDisp?.dispose()
  suggestScrollDisp = null
  unsubData?.()
  unsubClosed?.()
  unsubReconnected?.()
  unsubError?.()
  disposeTerminal()
})

/**
 * Safe keyboard focus for the live xterm instance (no recreate).
 * No-op when disposed, inactive, workspace hidden, or not yet created.
 */
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
  <div class="terminal-wrapper" @contextmenu="openSelectionMenu" @keydown="onWrapperKeydown">
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
    <div ref="terminalRef" class="xterm-container"></div>
    <TerminalCommandSuggest
      :visible="suggestVisible"
      :items="suggestItems"
      :active-index="suggestActiveIndex"
      :left="suggestLeft"
      :top="suggestTop"
      :place-above="suggestPlaceAbove"
      @update:active-index="suggestActiveIndex = $event"
      @pick="onSuggestPick"
    />
    <Teleport to="body">
      <div
        v-if="selectionMenuVisible"
        ref="selectionMenuRef"
        class="terminal-selection-menu"
        :style="{ left: selectionMenuX + 'px', top: selectionMenuY + 'px' }"
        @click.stop
      >
        <button
          v-if="selectedText"
          class="terminal-selection-menu-item"
          @click="copySelection"
        >
          <AppIcon name="copy" size="sm" />
          <span>{{ t('terminal.copy') }}</span>
        </button>
        <button class="terminal-selection-menu-item" @click="pasteToTerminal">
          <AppIcon name="paste" size="sm" />
          <span>{{ t('terminal.paste') }}</span>
        </button>
        <button class="terminal-selection-menu-item" @click="selectAllInTerminal">
          <AppIcon name="select-all" size="sm" />
          <span>{{ t('terminal.selectAll') }}</span>
        </button>
        <button
          class="terminal-selection-menu-item"
          :title="t('terminal.clearScreenTitle')"
          @click="clearScreenKeepScrollback"
        >
          <AppIcon name="clear" size="sm" />
          <span>{{ t('terminal.clearScreen') }}</span>
        </button>
        <button
          class="terminal-selection-menu-item"
          :title="t('terminal.clearScrollbackTitle')"
          @click="clearScrollback"
        >
          <AppIcon name="delete" size="sm" />
          <span>{{ t('terminal.clearScrollback') }}</span>
        </button>
        <template v-if="selectedText">
          <div class="terminal-selection-menu-divider"></div>
          <button class="terminal-selection-menu-item" @click="sendSelectionToAi('send')">
            <AppIcon name="send" size="sm" />
            <span>{{ t('terminal.sendToAi') }}</span>
          </button>
          <button class="terminal-selection-menu-item" @click="sendSelectionToAi('insert')">
            <AppIcon name="ai-chat" size="sm" />
            <span>{{ t('terminal.insertToAi') }}</span>
          </button>
          <button class="terminal-selection-menu-item" @click="saveSelectionAsSnippet">
            <AppIcon name="file-text" size="sm" />
            <span>{{ t('terminal.saveAsSnippet') }}</span>
          </button>
        </template>
      </div>
    </Teleport>
    <TerminalReconnectOverlay
      :disconnected="disconnected"
      :reconnecting="reconnecting"
      :attempt="reconnectAttempt"
      :max-retries="autoReconnectMaxRetries"
      :exhausted="autoReconnectExhausted"
      @reconnect="handleReconnect"
      @reconnect-all="handleReconnectAll"
      @cancel-auto="cancelAutoReconnect"
      @keydown="onWrapperKeydown"
    />
  </div>
</template>

<style scoped>
.terminal-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
}

.xterm-container {
  width: 100%;
  height: 100%;
  padding: 4px;
}

/* 按键反馈：光标短暂高亮，提示按键已被客户端接收 */
.xterm-container.cursor-pulse :deep(.xterm-cursor-layer .xterm-cursor) {
  opacity: 1 !important;
  filter: brightness(1.4) drop-shadow(0 0 2px var(--accent, #4a9eff));
  transition: filter 0.05s ease-out;
}

.terminal-selection-menu {
  position: fixed;
  z-index: 10000;
  min-width: 150px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.terminal-selection-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}

.terminal-selection-menu-item:hover {
  background: var(--accent-bg);
  color: var(--accent);
}

.terminal-selection-menu-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--border-color);
}
</style>
