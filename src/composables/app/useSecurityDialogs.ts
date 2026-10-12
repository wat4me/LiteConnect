import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { Connection, KeyboardInteractivePrompt } from '@/env.d'
import type { DecryptionFailedData, HostKeyMismatchData } from '@/domain/app/security'
import { isSshHostKeyConfirmationRequired } from '@shared/sshHostKeyConfirmation'
import { ElMessage } from 'element-plus/es/components/message/index'
import { t } from '../../i18n'
import { sshDisconnectDetailKey } from '@/utils/session/sshDisconnectReason'
import { isSshConnectionCancelled } from '@shared/sshConnectionProgress'

export type { DecryptionFailedData, HostKeyMismatchData }

export function useSecurityDialogs(deps: {
  connections: Ref<Connection[]>
  onSelectHome: () => void
  editConnection: (conn: Connection) => void
  /**
   * Attach a newly confirmed SSH session to the workspace (first connect path).
   * When reconnect already owns the sessionId, this should no-op if the id exists.
   */
  adoptSession?: (connectionId: string, sessionId: string) => void | Promise<void>
  /** True if any open tab already uses this sessionId (in-place reconnect). */
  hasOpenSession?: (sessionId: string) => boolean
}) {
  const hostKeyMismatchVisible = ref(false)
  const hostKeyMismatchData = ref<HostKeyMismatchData | null>(null)
  const decryptionFailedVisible = ref(false)
  const decryptionFailedData = ref<DecryptionFailedData | null>(null)
  const keyboardPrompt = ref<KeyboardInteractivePrompt | null>(null)

  let unsubHostKeyMismatch: (() => void) | null = null
  let unsubDecryptionFailed: (() => void) | null = null
  let unsubKeyboard: (() => void) | null = null
  let unsubKeyboardClosed: (() => void) | undefined
  let unsubProgress: (() => void) | undefined
  type Prompt = { kind: 'host'; data: HostKeyMismatchData } | { kind: 'keyboard'; data: KeyboardInteractivePrompt }
  let queue: Prompt[] = []
  function showNext() {
    if (hostKeyMismatchData.value || keyboardPrompt.value) return
    const next = queue.shift()
    if (next?.kind === 'host') { hostKeyMismatchData.value = next.data; hostKeyMismatchVisible.value = true }
    else if (next) keyboardPrompt.value = next.data
  }
  function enqueue(prompt: Prompt) {
    queue.push(prompt)
    showNext()
  }

  async function handleHostKeyAccept() {
    if (!hostKeyMismatchData.value) return
    const connectionId = hostKeyMismatchData.value.connectionId
    hostKeyMismatchVisible.value = false
    hostKeyMismatchData.value = null
    showNext()
    try {
      const sessionId = await window.LiteConnect.sshConfirmHostKey(connectionId)
      // Reconnect path: TerminalTab already mounted under sessionId (reconnected event clears UI).
      // First-connect path: no tab yet — adopt so we do not leave an orphan main-process session.
      if (sessionId && !deps.hasOpenSession?.(sessionId)) {
        await deps.adoptSession?.(connectionId, sessionId)
      }
    } catch (err: any) {
      if (isSshHostKeyConfirmationRequired(err) || isSshConnectionCancelled(err)) return
      console.error('Failed to confirm host key:', err)
      const raw = err?.message || ''
      const detailKey = sshDisconnectDetailKey(raw)
      const reason = detailKey ? t(detailKey) : (raw || t('terminal.connectFailureHint'))
      const connection = deps.connections.value.find((item) => item.id === connectionId)
      ElMessage.error(connection
        ? t('terminal.connectFailedWithTarget', { name: connection.name, host: connection.host, reason })
        : reason)
    }
  }

  function handleHostKeyReject() {
    if (!hostKeyMismatchData.value) return
    const connectionId = hostKeyMismatchData.value.connectionId
    hostKeyMismatchVisible.value = false
    hostKeyMismatchData.value = null
    showNext()
    window.LiteConnect.sshRejectHostKey(connectionId).catch(() => {})
  }

  function handleDecryptionFailedGoEdit() {
    if (!decryptionFailedData.value) return
    const connId = decryptionFailedData.value.connectionId
    decryptionFailedVisible.value = false
    decryptionFailedData.value = null
    deps.onSelectHome()
    const conn = deps.connections.value.find((c) => c.id === connId)
    if (conn) {
      deps.editConnection(conn)
    }
  }

  function handleDecryptionFailedDismiss() {
    decryptionFailedVisible.value = false
    decryptionFailedData.value = null
  }

  function handleKeyboardSubmit(answers: string[]) {
    const req = keyboardPrompt.value
    keyboardPrompt.value = null
    showNext()
    if (!req) return
    void window.LiteConnect.sshReplyKeyboardInteractive(req.requestId, answers).catch(() => {})
  }

  function handleKeyboardCancel() {
    const req = keyboardPrompt.value
    keyboardPrompt.value = null
    showNext()
    if (!req) return
    void window.LiteConnect.sshReplyKeyboardInteractive(req.requestId, null).catch(() => {})
  }

  function subscribe() {
    unsubHostKeyMismatch = window.LiteConnect.onSshHostKeyMismatch((data) => {
      const current = hostKeyMismatchData.value
      if (current?.connectionId === data.connectionId) { hostKeyMismatchData.value = data; return }
      queue = queue.filter((item) => item.kind !== 'host' || item.data.connectionId !== data.connectionId)
      enqueue({ kind: 'host', data })
    })
    unsubDecryptionFailed = window.LiteConnect.onSshDecryptionFailed((data) => {
      decryptionFailedData.value = data
      decryptionFailedVisible.value = true
    })
    unsubKeyboard = window.LiteConnect.onSshKeyboardInteractive((data) => {
      enqueue({ kind: 'keyboard', data })
    })
    unsubKeyboardClosed = window.LiteConnect.onSshKeyboardInteractiveClosed?.((requestId) => {
      queue = queue.filter((item) => item.kind !== 'keyboard' || item.data.requestId !== requestId)
      if (keyboardPrompt.value?.requestId === requestId) keyboardPrompt.value = null
      showNext()
    })
    unsubProgress = window.LiteConnect.onSshConnectionProgress?.(({ connectionId, stage }) => {
      if (!['failed', 'cancelled', 'connected'].includes(stage)) return
      queue = queue.filter((item) => item.data.connectionId !== connectionId)
      if (hostKeyMismatchData.value?.connectionId === connectionId) { hostKeyMismatchData.value = null; hostKeyMismatchVisible.value = false }
      if (keyboardPrompt.value?.connectionId === connectionId) keyboardPrompt.value = null
      showNext()
    })
  }

  function unsubscribe() {
    unsubHostKeyMismatch?.()
    unsubHostKeyMismatch = null
    unsubDecryptionFailed?.()
    unsubDecryptionFailed = null
    unsubKeyboard?.()
    unsubKeyboard = null
    unsubKeyboardClosed?.()
    unsubProgress?.()
    queue = []
  }

  onMounted(subscribe)
  onBeforeUnmount(unsubscribe)

  return {
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
  }
}
