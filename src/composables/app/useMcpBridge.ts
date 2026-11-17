import { onBeforeUnmount, onMounted } from 'vue'
import { emitAppEvent } from '@/utils/shared/appEvents'

/**
 * Adapts MCP requests from the main process to the SSH workspace: opening a saved
 * connection on request, closing a session, and reloading connections that an MCP
 * client changed. The app shell supplies navigation and session actions.
 */
export function useMcpBridge(deps: {
  /** Bring the SSH workspace forward; resolves false when the user cancels leaving the current page. */
  enterSshWorkspace: () => Promise<boolean>
  createSession: (connectionId: string) => Promise<string | null | undefined>
  closeSession: (sessionId: string) => unknown
  reloadConnections: () => unknown
}) {
  const unsubscribers: Array<() => void> = []

  async function handleConnectRequest(payload: { requestId: string; connectionId: string }) {
    try {
      if (!await deps.enterSshWorkspace()) {
        await window.LiteConnect.mcpReportConnectResult(payload.requestId, { error: 'NAVIGATION_CANCELLED' })
        return
      }
      const sessionId = await deps.createSession(payload.connectionId)
      await window.LiteConnect.mcpReportConnectResult(payload.requestId, {
        sessionId: sessionId || undefined,
        error: sessionId ? undefined : 'CONNECT_FAILED',
      })
    } catch (err: any) {
      await window.LiteConnect.mcpReportConnectResult(payload.requestId, {
        error: err?.message || 'CONNECT_FAILED',
      })
    }
  }

  onMounted(() => {
    if (typeof window.LiteConnect.onMcpCloseSession === 'function') {
      unsubscribers.push(window.LiteConnect.onMcpCloseSession((sessionId) => {
        void deps.closeSession(sessionId)
      }))
    }
    if (typeof window.LiteConnect.onMcpConnectionsChanged === 'function') {
      unsubscribers.push(window.LiteConnect.onMcpConnectionsChanged(() => {
        void deps.reloadConnections()
        emitAppEvent('connections-store-change')
      }))
    }
    unsubscribers.push(window.LiteConnect.onMcpConnectRequest((payload) => {
      void handleConnectRequest(payload)
    }))
  })

  onBeforeUnmount(() => {
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
  })
}
