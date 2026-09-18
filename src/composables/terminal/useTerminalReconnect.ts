import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { Terminal } from '@xterm/xterm'
import {
  clearAutoReconnectAttempts,
  noteAutoReconnectAttempt,
} from '@/composables/session/useAutoReconnectBudget'
import { isNonRetryableSshError } from '@/utils/session/sshErrorRetry'
import { sshDisconnectDetailKey } from '@/utils/session/sshDisconnectReason'

export function useTerminalReconnect(deps: {
  sessionId: () => string
  connectionId: () => string
  connectionName: () => string
  isActive: () => boolean
  workspaceVisible: () => boolean
  startDisconnected: boolean
  getTerminal: () => Terminal | null
  flushRenderBatch: () => void
  performResize: (opts?: { forceSshResize?: boolean }) => void
  scheduleTerminalRefresh: (force?: boolean) => void
  emitReconnect: (sessionId: string) => void
}) {
  const { t } = useI18n()

  const disconnected = ref(false)
  const neverConnected = ref(!!deps.startDisconnected)
  const disconnectDetail = ref('')
  const reconnecting = ref(false)
  const reconnectAttempt = ref(0)
  const autoReconnectExhausted = ref(false)
  const autoReconnectMaxRetries = ref(5)

  let autoReconnectTimer: ReturnType<typeof setTimeout> | null = null
  let autoReconnectEnabled = true
  let userDismissedAutoReconnect = false
  let appUnloading = false

  function clearAutoReconnectTimer() {
    if (autoReconnectTimer) {
      clearTimeout(autoReconnectTimer)
      autoReconnectTimer = null
    }
  }

  function noteDisconnectedAndMaybeReconnect(opts?: {
    message?: string
    reschedule?: boolean
  }) {
    if (appUnloading) return
    const wasDisconnected = disconnected.value
    disconnected.value = true
    if (opts?.message) {
      const key = sshDisconnectDetailKey(opts.message)
      if (key) disconnectDetail.value = t(key)
      else if (!disconnectDetail.value) disconnectDetail.value = opts.message
    }
    if (opts?.message && (!wasDisconnected || opts.reschedule)) {
      deps.flushRenderBatch()
      const term = deps.getTerminal()
      if (term) {
        term.writeln(`\r\n\x1b[1;31m--- ${opts.message} ---\x1b[0m`)
      }
    }
    if (!wasDisconnected && !deps.isActive() && deps.workspaceVisible()) {
      ElMessage.warning(t('terminal.disconnectedToast', { name: deps.connectionName() }))
    }
    if (opts?.reschedule) {
      reconnecting.value = false
      void scheduleAutoReconnect()
      return
    }
    if (autoReconnectTimer || reconnecting.value) return
    void scheduleAutoReconnect()
  }

  function markReconnectedInPlace() {
    clearAutoReconnectTimer()
    clearAutoReconnectAttempts(deps.connectionId())
    disconnected.value = false
    neverConnected.value = false
    disconnectDetail.value = ''
    reconnecting.value = false
    autoReconnectExhausted.value = false
    reconnectAttempt.value = 0
    userDismissedAutoReconnect = false
    const terminal = deps.getTerminal()
    if (terminal) {
      terminal.writeln('\r\n\x1b[1;32m--- Reconnected ---\x1b[0m\r\n')
    }
    deps.scheduleTerminalRefresh(true)
    nextTick(() => {
      try {
        deps.performResize({ forceSshResize: true })
      } catch {}
    })
  }

  function onReconnectFailed(event: Event) {
    const detail = (event as CustomEvent<{
      sessionId: string
      message?: string
      nonRetryable?: boolean
    }>).detail
    if (!detail || detail.sessionId !== deps.sessionId()) return
    const msg = detail.message
      ? `Reconnect failed: ${detail.message}`
      : 'Reconnect failed'
    if (detail.nonRetryable || isNonRetryableSshError(detail.message)) {
      clearAutoReconnectTimer()
      reconnecting.value = false
      disconnected.value = true
      autoReconnectExhausted.value = false
      const key = sshDisconnectDetailKey(detail.message)
      disconnectDetail.value = key ? t(key) : (detail.message || msg)
      deps.flushRenderBatch()
      const term = deps.getTerminal()
      if (term) {
        term.writeln(`\r\n\x1b[1;31m--- ${msg} ---\x1b[0m`)
      }
      return
    }
    noteDisconnectedAndMaybeReconnect({ message: msg, reschedule: true })
  }

  function handleReconnect() {
    clearAutoReconnectTimer()
    clearAutoReconnectAttempts(deps.connectionId())
    userDismissedAutoReconnect = false
    autoReconnectExhausted.value = false
    reconnectAttempt.value = 0
    reconnecting.value = true
    const terminal = deps.getTerminal()
    if (terminal) {
      terminal.writeln('\r\n\x1b[1;33m--- Reconnecting… ---\x1b[0m\r\n')
    }
    deps.emitReconnect(deps.sessionId())
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
      deps.connectionId(),
      autoReconnectMaxRetries.value,
    )
    reconnectAttempt.value = attempt
    if (!ok) {
      reconnecting.value = false
      autoReconnectExhausted.value = true
      ElMessage.warning(t('terminal.reconnectLimit', { name: deps.connectionName() }))
      return
    }

    autoReconnectExhausted.value = false
    reconnecting.value = true
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 15000)
    clearAutoReconnectTimer()
    autoReconnectTimer = setTimeout(() => {
      autoReconnectTimer = null
      if (appUnloading) return
      deps.emitReconnect(deps.sessionId())
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

  function applyNonRetryableError(error: string) {
    clearAutoReconnectTimer()
    reconnecting.value = false
    disconnected.value = true
    autoReconnectExhausted.value = false
    const key = sshDisconnectDetailKey(error)
    disconnectDetail.value = key ? t(key) : error
    deps.flushRenderBatch()
    const term = deps.getTerminal()
    if (term) {
      term.writeln(`\r\n\x1b[1;31m--- Error: ${error} ---\x1b[0m`)
    }
  }

  async function loadAutoReconnectSettings() {
    try {
      const [enabled, maxRetries] = await Promise.all([
        window.LiteConnect.getAutoReconnectEnabled(),
        window.LiteConnect.getAutoReconnectMaxRetries(),
      ])
      autoReconnectEnabled = enabled
      autoReconnectMaxRetries.value = maxRetries
    } catch {}
  }

  function applyStartDisconnected() {
    if (!deps.startDisconnected) return
    disconnected.value = true
    userDismissedAutoReconnect = true
  }

  function dispose() {
    appUnloading = true
    clearAutoReconnectTimer()
  }

  return {
    disconnected,
    neverConnected,
    disconnectDetail,
    reconnecting,
    reconnectAttempt,
    autoReconnectExhausted,
    autoReconnectMaxRetries,
    noteDisconnectedAndMaybeReconnect,
    markReconnectedInPlace,
    onReconnectFailed,
    handleReconnect,
    cancelAutoReconnect,
    onAppUnloading,
    onWrapperKeydown,
    applyNonRetryableError,
    loadAutoReconnectSettings,
    applyStartDisconnected,
    dispose,
  }
}
