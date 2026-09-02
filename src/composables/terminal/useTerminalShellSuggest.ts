import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Terminal } from '@xterm/xterm'
import {
  buildShellSuggestions,
  extractSuggestPrefix,
  suggestCompletionSuffix,
  type ShellHistoryEntry,
  type ShellSuggestItem,
} from '@/utils/terminal/shellCommandSuggest'
import { looksLikeFailedShellOutput } from '@/utils/terminal/shellHistoryEligibility'

const HISTORY_SNIFF_MS = 1000

export function useTerminalShellSuggest(deps: {
  terminalRef: Ref<HTMLDivElement | undefined>
  getTerminal: () => Terminal | null
  connectionId: () => string
  sessionId: () => string
  isEffectiveActive: () => boolean
  disconnected: Ref<boolean>
  commandBuffer: Ref<string>
  commandBufferDirty: Ref<boolean>
  submitBufferedCommand: () => void
}) {
  const { t } = useI18n()

  const shellHistory = ref<ShellHistoryEntry[]>([])
  const commandSuggestEnabled = ref(false)
  const suggestActiveIndex = ref(-1)
  const suggestDismissed = ref(false)
  const suggestCursorOutOfView = ref(false)
  const suggestLeft = ref(12)
  const suggestTop = ref(12)
  const suggestPlaceAbove = ref(false)
  let suggestPosRaf: number | null = null
  let suggestScrollDisp: { dispose: () => void } | null = null

  let historySniffCmd: string | null = null
  let historySniffBuf = ''
  let historySniffTimer: ReturnType<typeof setTimeout> | null = null

  const suggestItems = computed(() => {
    if (!commandSuggestEnabled.value) return []
    if (suggestDismissed.value || deps.commandBufferDirty.value) return []
    if (!deps.isEffectiveActive() || deps.disconnected.value) return []
    const q = deps.commandBuffer.value
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

  function updateSuggestPosition() {
    const wrap = deps.terminalRef.value?.closest('.terminal-wrapper') as HTMLElement | null
    const term = deps.getTerminal()
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
      const list = await window.LiteConnect.listShellCommandHistory(deps.connectionId())
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
      const list = await window.LiteConnect.pushShellCommandHistory(deps.connectionId(), command)
      shellHistory.value = Array.isArray(list) ? list : shellHistory.value
    } catch {
      const item = { command, at: Date.now() }
      shellHistory.value = [item, ...shellHistory.value.filter((h) => h.command !== command)].slice(0, 200)
    }
  }

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
    const segment = extractSuggestPrefix(deps.commandBuffer.value)
    const { clearCount, write } = suggestCompletionSuffix(segment, item.command)
    let payload = ''
    if (clearCount > 0) payload += '\x7f'.repeat(clearCount)
    payload += write
    const full = deps.commandBuffer.value
    const re = /^(.*(?:&&|\|\||[;|])\s*)?(.*)$/s
    const m = full.match(re)
    const prefix = m?.[1] || ''
    const seg = m?.[2] || ''
    const leadingWs = seg.match(/^\s*/)?.[0] || ''
    deps.commandBuffer.value = `${prefix}${leadingWs}${item.command}`
    deps.commandBufferDirty.value = false
    hideSuggest()
    if (execute) {
      deps.submitBufferedCommand()
      payload += '\r'
    }
    if (payload) window.LiteConnect.sshWrite(deps.sessionId(), payload)
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
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const item = suggestItems.value[suggestActiveIndex.value]
      if (!item) return true
      event.preventDefault()
      applySuggestItem(item, true)
      return false
    }
    return true
  }

  function bindSuggestScroll(terminal: Terminal) {
    suggestScrollDisp?.dispose()
    suggestScrollDisp = terminal.onScroll(() => {
      if (suggestItems.value.length === 0) return
      scheduleSuggestPosition()
    })
  }

  watch(suggestItems, (list) => {
    if (suggestActiveIndex.value >= list.length) {
      suggestActiveIndex.value = -1
    }
  })

  watch(
    [deps.commandBuffer, suggestItems],
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

  function dispose() {
    if (suggestPosRaf != null) {
      cancelAnimationFrame(suggestPosRaf)
      suggestPosRaf = null
    }
    cancelHistorySniff()
    suggestScrollDisp?.dispose()
    suggestScrollDisp = null
  }

  return {
    suggestItems,
    suggestVisible,
    suggestActiveIndex,
    suggestLeft,
    suggestTop,
    suggestPlaceAbove,
    suggestDismissed,
    loadCommandSuggestSetting,
    onTerminalBehaviorSettingsChange,
    scheduleHistorySniff,
    feedHistorySniff,
    hideSuggest,
    onSuggestPick,
    handleSuggestKey,
    bindSuggestScroll,
    dispose,
  }
}
