<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import TerminalSearchBar from '../terminal/TerminalSearchBar.vue'
import { useTerminalSearch } from '../../composables/terminal/useTerminalSearch'
import {
  dockerExecStateI18nKey,
  useDockerContainerExec,
} from '../../composables/docker/useDockerContainerExec'
import {
  createReconcileController,
  decideRetryCommit,
  shouldResetForTarget,
  type ReconcileController,
} from '../../composables/docker/dockerContainerTerminalReconcile'
import { useTheme, getTerminalColors, type TerminalPaletteId } from '../../composables/useTheme'
import {
  PASTE_CONFIRM_MAX_CHARS,
  normalizePasteConfirmMaxChars,
  shouldConfirmPaste,
  countPasteLines,
  buildPastePreview,
} from '../../utils/terminalPaste'
import { canMeasureTerminal } from '../../utils/terminalResizePolicy'
import { appConfirm } from '../../composables/useAppDialog'
import type { DockerExecShell } from '../../env.d'

const props = defineProps<{
  sessionId: string
  containerId: string
  containerName: string
  /** Container is running and not paused/restarting. */
  containerRunnable: boolean
  sshDisconnected?: boolean
  /** Parent detail tab is visible. */
  active: boolean
}>()

const { t } = useI18n()
const { theme, customColors } = useTheme()

const sessionIdRef = toRef(props, 'sessionId')
const {
  execState,
  execErrorCode,
  shell,
  exitCode,
  live,
  activate,
  deactivate,
  retry,
  retryWithSh,
  writeInput,
  resize,
  setDataHandler,
} = useDockerContainerExec(sessionIdRef)

const terminalHostRef = ref<HTMLDivElement | null>(null)
const statusLabel = computed(() =>
  t(dockerExecStateI18nKey(execState.value, execErrorCode.value, shell.value)),
)

const showRetrySh = computed(() => {
  if (execState.value !== 'error' && execState.value !== 'ended') return false
  return shell.value === 'bash'
})

const canStart = computed(
  () =>
    props.active &&
    props.containerRunnable &&
    !props.sshDisconnected &&
    !!props.sessionId &&
    !!props.containerId,
)

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let searchAddon: SearchAddon | null = null
let resizeObserver: ResizeObserver | null = null
let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null
let refreshRafId: number | null = null
let refreshGeneration = 0
let lastSentCols = 0
let lastSentRows = 0
let disposed = false
let onDataDisposable: { dispose: () => void } | null = null
/**
 * mount-ready gate: true only after onMounted has finished loadSettings +
 * createXterm, so the dataHandler is registered before any activate() call.
 * The watcher and onMounted both route through the reconcile controller,
 * which refuses to start until ready is true. This prevents the first mount
 * from never creating an xterm (terminalHostRef null at watcher time).
 */
let ready = false
/** Container/session the current live exec was started for (dedupe + stale guard). */
let activeExecContainerId: string | null = null
let activeExecSessionId: string | null = null
/**
 * Container/session whose content is currently rendered on the xterm screen.
 * DISTINCT from the live exec owner: stop clears the live owner but MUST NOT
 * clear this, so a start for a different container can detect that the screen
 * still shows the old container's bytes and reset() before writing new ones.
 * Only cleared when the xterm is disposed (component unmount).
 */
let renderedContainerId: string | null = null
let renderedSessionId: string | null = null
/**
 * Async reconcile controller: single-consumer dirty-flag loop that captures an
 * immutable target snapshot per round. Prevents in-flight start/stop from
 * dropping a later props change (A pending -> B): the B request sets dirty and
 * the runner loops again after A settles, stopping A and starting B.
 */
let reconcileCtl: ReconcileController | null = null

const fontSize = ref(14)
const scrollbackLines = ref(5000)
const pasteConfirmEnabled = ref(true)
const pasteConfirmMaxChars = ref(PASTE_CONFIRM_MAX_CHARS)
const fontFamily = ref('Cascadia Code, Fira Code, Consolas, Courier New, monospace')
const terminalPalette = ref<TerminalPaletteId>('auto')

const getTerminal = () => terminal
const getSearchAddon = () => searchAddon

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

function canFit(): boolean {
  if (!terminal || !fitAddon || !terminalHostRef.value) return false
  if (!props.active) return false
  return canMeasureTerminal({
    width: terminalHostRef.value.offsetWidth,
    height: terminalHostRef.value.offsetHeight,
  })
}

function performFitAndResize(): void {
  if (!canFit() || !terminal || !fitAddon) return
  try {
    const proposed = fitAddon.proposeDimensions()
    if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) return
    const needFit =
      proposed.cols !== terminal.cols || proposed.rows !== terminal.rows
    if (needFit) {
      if (terminal.hasSelection()) terminal.clearSelection()
      fitAddon.fit()
    }
    const cols = terminal.cols
    const rows = terminal.rows
    if (cols <= 0 || rows <= 0) return
    if (cols === lastSentCols && rows === lastSentRows) return
    lastSentCols = cols
    lastSentRows = rows
    resize(cols, rows)
  } catch {}
}

function scheduleFit(): void {
  if (!props.active) return
  if (resizeDebounceTimer) {
    clearTimeout(resizeDebounceTimer)
    resizeDebounceTimer = null
  }
  resizeDebounceTimer = setTimeout(() => {
    resizeDebounceTimer = null
    performFitAndResize()
  }, 80)
}

function cancelRefresh(): void {
  refreshGeneration += 1
  if (refreshRafId != null) {
    try {
      cancelAnimationFrame(refreshRafId)
    } catch {}
    refreshRafId = null
  }
}

function scheduleRefresh(): void {
  if (!props.active) return
  const gen = ++refreshGeneration
  if (refreshRafId != null) {
    try {
      cancelAnimationFrame(refreshRafId)
    } catch {}
    refreshRafId = null
  }
  refreshRafId = requestAnimationFrame(() => {
    refreshRafId = null
    void nextTick(() => {
      if (gen !== refreshGeneration || !props.active) return
      performFitAndResize()
      try {
        terminal?.refresh(0, (terminal?.rows || 1) - 1)
      } catch {}
    })
  })
}

async function pasteWithConfirm(text: string): Promise<void> {
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
    // paste goes through onData → writeInput (not SSH)
    terminal.paste(text)
  } catch {
    // cancelled
  } finally {
    await nextTick()
    if (props.active && getTerminal() === terminal) terminal.focus()
  }
}

function onKeyDown(e: KeyboardEvent): void {
  if (!props.active || !terminal) return
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault()
    e.stopPropagation()
    toggleSearch()
    return
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'v' || e.key === 'V')) {
    // Let browser paste; xterm attachCustomKeyEventHandler handles paste path via clipboard
  }
}

async function loadSettings(): Promise<void> {
  try {
    const [size, family, palette, scrollback, pasteConfirm, pasteMaxChars] = await Promise.all([
      window.LiteConnect.getTerminalFontSize(),
      window.LiteConnect.getTerminalFontFamily(),
      window.LiteConnect.getTerminalPalette(),
      window.LiteConnect.getTerminalScrollback(),
      window.LiteConnect.getTerminalPasteConfirmEnabled(),
      window.LiteConnect.getTerminalPasteConfirmMaxChars().catch(() => PASTE_CONFIRM_MAX_CHARS),
    ])
    fontSize.value = size
    fontFamily.value = family
    terminalPalette.value = (palette as TerminalPaletteId) || 'auto'
    scrollbackLines.value = scrollback
    pasteConfirmEnabled.value = pasteConfirm
    pasteConfirmMaxChars.value = normalizePasteConfirmMaxChars(pasteMaxChars)
  } catch {
    fontSize.value = 14
  }
}

function applyTheme(): void {
  if (!terminal) return
  terminal.options.theme = getTerminalColors(theme.value, customColors.value, terminalPalette.value)
  try {
    if (terminal.rows > 0) terminal.refresh(0, terminal.rows - 1)
  } catch {}
}

function onFontSettings(e: Event): void {
  const detail = (e as CustomEvent).detail || {}
  if (typeof detail.fontSize === 'number' && terminal) {
    fontSize.value = detail.fontSize
    terminal.options.fontSize = detail.fontSize
  }
  if (typeof detail.fontFamily === 'string' && terminal) {
    fontFamily.value = detail.fontFamily
    terminal.options.fontFamily = detail.fontFamily
  }
  scheduleRefresh()
}

function onPaletteChange(e: Event): void {
  const detail = (e as CustomEvent).detail || {}
  if (typeof detail.palette === 'string') {
    terminalPalette.value = detail.palette as TerminalPaletteId
    applyTheme()
  }
}

function onBehaviorChange(e: Event): void {
  const detail = (e as CustomEvent).detail || {}
  if (typeof detail.scrollback === 'number' && terminal) {
    scrollbackLines.value = detail.scrollback
    terminal.options.scrollback = detail.scrollback
  }
  if (typeof detail.pasteConfirmEnabled === 'boolean') {
    pasteConfirmEnabled.value = detail.pasteConfirmEnabled
  }
  if (detail.pasteConfirmMaxChars !== undefined) {
    pasteConfirmMaxChars.value = normalizePasteConfirmMaxChars(detail.pasteConfirmMaxChars)
  }
}

function createXterm(): void {
  if (!terminalHostRef.value || terminal) return
  terminal = new Terminal({
    cursorBlink: true,
    fontSize: fontSize.value,
    fontFamily: fontFamily.value,
    theme: getTerminalColors(theme.value, customColors.value, terminalPalette.value),
    allowProposedApi: true,
    scrollback: scrollbackLines.value,
  })
  fitAddon = new FitAddon()
  searchAddon = new SearchAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(searchAddon)
  terminal.open(terminalHostRef.value)
  bindSearchAddon(searchAddon)

  setDataHandler((data) => {
    if (!terminal) return
    try {
      terminal.write(data)
    } catch {}
  })

  onDataDisposable = terminal.onData((data) => {
    writeInput(data)
  })

  terminal.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === 'f' || ev.key === 'F')) {
      toggleSearch()
      return false
    }
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === 'v' || ev.key === 'V')) {
      void window.LiteConnect.clipboardReadText().then((text) => {
        if (text) void pasteWithConfirm(text)
      })
      return false
    }
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === 'c' || ev.key === 'C')) {
      if (terminal?.hasSelection()) {
        const sel = terminal.getSelection()
        if (sel) void window.LiteConnect.clipboardWriteText(sel)
        return false
      }
    }
    return true
  })

  if (typeof ResizeObserver !== 'undefined' && terminalHostRef.value) {
    resizeObserver = new ResizeObserver(() => scheduleFit())
    resizeObserver.observe(terminalHostRef.value)
  }
}

function disposeXterm(): void {
  cancelRefresh()
  if (resizeDebounceTimer) {
    clearTimeout(resizeDebounceTimer)
    resizeDebounceTimer = null
  }
  resizeObserver?.disconnect()
  resizeObserver = null
  disposeSearchListeners()
  try {
    onDataDisposable?.dispose()
  } catch {}
  onDataDisposable = null
  setDataHandler(null)
  try {
    terminal?.dispose()
  } catch {}
  terminal = null
  fitAddon = null
  searchAddon = null
  lastSentCols = 0
  lastSentRows = 0
  // xterm is gone -> screen content owner is no longer meaningful.
  renderedContainerId = null
  renderedSessionId = null
}

/**
 * Start an Exec for the IMMUTABLE target captured by the reconcile controller.
 * Must NOT read props.containerId/sessionId after the await - the caller passes
 * the round's snapshot so a late props change can't impersonate a different exec.
 * `shell` lets the retry bash/sh paths bypass the default 'bash'.
 *
 * Reset policy: if the xterm screen currently belongs to a DIFFERENT
 * container/session (tracked by renderedContainerId/SessionId, which survive
 * stop), reset() before starting so B's prompt doesn't append to A's scrollback.
 * Same container+session (e.g. bash->sh retry) keeps the screen so the user can
 * see the failure reason.
 */
async function startSession(
  target: { containerId: string; sessionId: string },
  nextShell: DockerExecShell,
): Promise<void> {
  if (!ready || !terminal) return
  if (shouldResetForTarget(renderedContainerId, renderedSessionId, target) && terminal) {
    try {
      terminal.reset()
    } catch {}
  }
  performFitAndResize()
  const cols = terminal.cols || 80
  const rows = terminal.rows || 24
  lastSentCols = 0
  lastSentRows = 0
  await activate(target.containerId, {
    shell: nextShell,
    cols,
    rows,
  })
  // Record the screen owner (not cleared by stop; only by xterm dispose).
  renderedContainerId = target.containerId
  renderedSessionId = target.sessionId
  scheduleRefresh()
  try {
    terminal.focus()
  } catch {}
}

async function stopSession(): Promise<void> {
  cancelRefresh()
  if (resizeDebounceTimer) {
    clearTimeout(resizeDebounceTimer)
    resizeDebounceTimer = null
  }
  await deactivate()
  // Clear the LIVE exec owner only. renderedContainerId/SessionId survive so a
  // later start for a different container can still detect the screen mismatch.
  activeExecContainerId = null
  activeExecSessionId = null
}

function ensureReconcileController(): ReconcileController {
  if (reconcileCtl) return reconcileCtl
  reconcileCtl = createReconcileController({
    getSnapshot: () => ({
      ready,
      active: props.active,
      sessionId: props.sessionId,
      containerId: props.containerId,
      sshDisconnected: !!props.sshDisconnected,
      containerRunnable: props.containerRunnable,
    }),
    getActiveExecContainerId: () => activeExecContainerId,
    getActiveExecSessionId: () => activeExecSessionId,
    setActiveExec: (cid, sid) => {
      activeExecContainerId = cid
      activeExecSessionId = sid
    },
    start: async (target) => {
      await startSession(target, 'bash')
    },
    stop: async () => {
      await stopSession()
    },
    isDisposed: () => disposed,
  })
  return reconcileCtl
}

function requestReconcile(): void {
  if (disposed) return
  ensureReconcileController().request()
}

watch(
  () =>
    [
      props.active,
      props.containerId,
      props.sessionId,
      props.sshDisconnected,
      props.containerRunnable,
    ] as const,
  () => {
    requestReconcile()
  },
  // Non-immediate: onMounted drives the first reconcile after xterm is ready.
)

watch(
  () => theme.value,
  () => applyTheme(),
)

watch(
  () => customColors.value,
  () => applyTheme(),
  { deep: true },
)

onMounted(async () => {
  window.addEventListener('terminal-font-settings-change', onFontSettings)
  window.addEventListener('terminal-palette-change', onPaletteChange)
  window.addEventListener('terminal-behavior-settings-change', onBehaviorChange)
  // 1. Load settings BEFORE creating xterm so the terminal is born with the
  //    correct font/scrollback/palette (no later re-apply churn).
  await loadSettings()
  // 2. Create xterm + bind dataHandler. terminalHostRef is now bound (mounted).
  //    dataHandler is registered inside createXterm BEFORE any activate() can
  //    run, so early prompt/bytes are never dropped.
  createXterm()
  if (terminal) {
    terminal.options.fontSize = fontSize.value
    terminal.options.fontFamily = fontFamily.value
    terminal.options.scrollback = scrollbackLines.value
    applyTheme()
  }
  // 3. Flip the ready gate. Only now may reconcile start an Exec.
  ready = true
  // 4. Single first start via the controller (no immediate-watcher double path).
  requestReconcile()
  scheduleRefresh()
})

onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('terminal-font-settings-change', onFontSettings)
  window.removeEventListener('terminal-palette-change', onPaletteChange)
  window.removeEventListener('terminal-behavior-settings-change', onBehaviorChange)
  void stopSession()
  reconcileCtl?.dispose()
  reconcileCtl = null
  disposeXterm()
  ready = false
})

async function onRetry(): Promise<void> {
  if (!ready || !terminal || !canStart.value) return
  // Capture immutable target at click time; never read props after the await
  // to represent this retry (props may change to B/C while pending).
  const target = {
    containerId: props.containerId,
    sessionId: props.sessionId,
  }
  const cols = terminal.cols || lastSentCols || 80
  const rows = terminal.rows || lastSentRows || 24
  lastSentCols = 0
  lastSentRows = 0
  await retry(cols, rows)
  const decision = decideRetryCommit({
    disposed,
    retryTarget: target,
    currentTarget: { containerId: props.containerId, sessionId: props.sessionId },
    canStart: canStart.value,
  })
  if (decision.kind === 'commit') {
    activeExecContainerId = decision.containerId
    activeExecSessionId = decision.sessionId
    renderedContainerId = decision.containerId
    renderedSessionId = decision.sessionId
  } else if (decision.kind === 'reconcile-only') {
    // Props changed or no longer startable: do not overwrite the controller's
    // owner with the stale retry target. Let the dirty-loop decide.
    requestReconcile()
  }
  // skip: disposed -> write nothing
  try {
    terminal.focus()
  } catch {}
}

async function onRetrySh(): Promise<void> {
  if (!ready || !terminal || !canStart.value) return
  // Capture immutable target; shell selection (sh) is preserved - never reset
  // to bash by reconcile.
  const target = {
    containerId: props.containerId,
    sessionId: props.sessionId,
  }
  const cols = terminal.cols || lastSentCols || 80
  const rows = terminal.rows || lastSentRows || 24
  lastSentCols = 0
  lastSentRows = 0
  await retryWithSh(cols, rows)
  const decision = decideRetryCommit({
    disposed,
    retryTarget: target,
    currentTarget: { containerId: props.containerId, sessionId: props.sessionId },
    canStart: canStart.value,
  })
  if (decision.kind === 'commit') {
    activeExecContainerId = decision.containerId
    activeExecSessionId = decision.sessionId
    renderedContainerId = decision.containerId
    renderedSessionId = decision.sessionId
  } else if (decision.kind === 'reconcile-only') {
    requestReconcile()
  }
  try {
    terminal.focus()
  } catch {}
}

function onHostClick(): void {
  if (props.active) {
    try {
      terminal?.focus()
    } catch {}
  }
}
</script>

<template>
  <div class="container-terminal" role="region" :aria-label="t('docker.terminal.title')">
    <div class="ct-toolbar">
      <div class="ct-meta">
        <span class="ct-badge">{{ t('docker.terminal.badge') }}</span>
        <span class="ct-name mono" :title="containerName">{{ containerName }}</span>
        <span class="ct-shell">{{ t('docker.terminal.shell', { shell }) }}</span>
        <span class="ct-state" :data-state="execState">{{ statusLabel }}</span>
        <span v-if="exitCode !== null && execState === 'ended'" class="ct-exit">
          {{ t('docker.terminal.exitCode', { code: exitCode }) }}
        </span>
      </div>
      <div class="ct-actions">
        <button
          type="button"
          class="ct-btn"
          :title="t('terminal.search')"
          @click="toggleSearch"
        >
          {{ t('docker.terminal.search') }}
        </button>
        <button
          v-if="execState === 'ended' || execState === 'error' || execState === 'disconnected'"
          type="button"
          class="ct-btn primary"
          :disabled="!canStart"
          @click="onRetry"
        >
          {{ t('docker.terminal.retry') }}
        </button>
        <button
          v-if="showRetrySh"
          type="button"
          class="ct-btn"
          :disabled="!canStart"
          @click="onRetrySh"
        >
          {{ t('docker.terminal.retrySh') }}
        </button>
      </div>
    </div>

    <div v-if="!containerRunnable && active" class="ct-banner warn">
      {{ t('docker.terminal.notRunning') }}
    </div>
    <div v-else-if="sshDisconnected && active" class="ct-banner warn">
      {{ t('docker.terminal.error.sshDisconnected') }}
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

    <div
      ref="terminalHostRef"
      class="ct-xterm"
      tabindex="0"
      @click="onHostClick"
      @keydown="onKeyDown"
    />
  </div>
</template>

<style scoped>
.container-terminal {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-primary);
}

.ct-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.ct-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-secondary);
}

.ct-badge {
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 2px 8px;
  letter-spacing: 0.02em;
}

.ct-name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.ct-shell {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--text-secondary);
}

.ct-state {
  color: var(--text-secondary);
}

.ct-state[data-state='attached'] {
  color: var(--success-color, #3ecf8e);
}

.ct-state[data-state='error'],
.ct-state[data-state='disconnected'] {
  color: var(--danger-color, #f56c6c);
}

.ct-exit {
  color: var(--text-secondary);
}

.ct-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ct-btn {
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.ct-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ct-btn.primary {
  border-color: var(--accent-color, #409eff);
  color: var(--accent-color, #409eff);
}

.ct-banner {
  padding: 8px 12px;
  font-size: 12px;
  flex-shrink: 0;
}

.ct-banner.warn {
  background: color-mix(in srgb, var(--warning-color, #e6a23c) 15%, transparent);
  color: var(--text-primary);
}

.ct-xterm {
  flex: 1;
  min-height: 0;
  padding: 4px;
  outline: none;
}

.ct-xterm :deep(.xterm) {
  height: 100%;
}

.ct-xterm :deep(.xterm-viewport) {
  overflow-y: auto !important;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
