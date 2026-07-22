import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { Connection } from '../env.d'

export interface HostKeyMismatchData {
  connectionId: string
  host: string
  port: number
  existingFingerprint: string
  newFingerprint: string
  /** jump = bastion, target = destination host */
  role?: 'target' | 'jump'
}

export interface DecryptionFailedData {
  connectionId: string
  field: 'password' | 'privateKey' | 'apiKey'
  message: string
}

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

  let unsubHostKeyMismatch: (() => void) | null = null
  let unsubDecryptionFailed: (() => void) | null = null

  async function handleHostKeyAccept() {
    if (!hostKeyMismatchData.value) return
    const connectionId = hostKeyMismatchData.value.connectionId
    hostKeyMismatchVisible.value = false
    hostKeyMismatchData.value = null
    try {
      const sessionId = await window.LiteConnect.sshConfirmHostKey(connectionId)
      // Reconnect path: TerminalTab already mounted under sessionId (reconnected event clears UI).
      // First-connect path: no tab yet — adopt so we do not leave an orphan main-process session.
      if (sessionId && !deps.hasOpenSession?.(sessionId)) {
        await deps.adoptSession?.(connectionId, sessionId)
      }
    } catch (err: any) {
      console.error('Failed to confirm host key:', err)
    }
  }

  function handleHostKeyReject() {
    if (!hostKeyMismatchData.value) return
    const connectionId = hostKeyMismatchData.value.connectionId
    hostKeyMismatchVisible.value = false
    hostKeyMismatchData.value = null
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

  function subscribe() {
    unsubHostKeyMismatch = window.LiteConnect.onSshHostKeyMismatch((data) => {
      hostKeyMismatchData.value = data
      hostKeyMismatchVisible.value = true
    })
    unsubDecryptionFailed = window.LiteConnect.onSshDecryptionFailed((data) => {
      decryptionFailedData.value = data
      decryptionFailedVisible.value = true
    })
  }

  function unsubscribe() {
    unsubHostKeyMismatch?.()
    unsubHostKeyMismatch = null
    unsubDecryptionFailed?.()
    unsubDecryptionFailed = null
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
  }
}
