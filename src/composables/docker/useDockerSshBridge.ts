import { onBeforeUnmount, watch, type ComputedRef, type Ref } from 'vue'

/**
 * Per-session SSH closed/error/reconnected listeners that keep Docker
 * workspace connection state in sync with the interactive SSH session.
 */
export function useDockerSshBridge(deps: {
  liveSessionIds: ComputedRef<string[]> | Ref<string[]>
  trackSessionConnection: (sessionId: string) => void
  markSessionConnected: (sessionId: string, connected: boolean) => void
  forgetSession: (sessionId: string) => void
}) {
  const dockerSshUnsubs = new Map<string, () => void>()

  function detachDockerSshListeners(sessionId: string) {
    const off = dockerSshUnsubs.get(sessionId)
    if (off) {
      off()
      dockerSshUnsubs.delete(sessionId)
    }
  }

  function attachDockerSshListeners(sessionId: string) {
    if (dockerSshUnsubs.has(sessionId)) return
    const offs: Array<() => void> = []
    offs.push(
      window.LiteConnect.onSshClosed(sessionId, () => {
        deps.markSessionConnected(sessionId, false)
      }),
    )
    offs.push(
      window.LiteConnect.onSshError(sessionId, () => {
        deps.markSessionConnected(sessionId, false)
      }),
    )
    if (typeof window.LiteConnect.onSshReconnected === 'function') {
      offs.push(
        window.LiteConnect.onSshReconnected(sessionId, () => {
          deps.markSessionConnected(sessionId, true)
        }),
      )
    }
    dockerSshUnsubs.set(sessionId, () => {
      for (const off of offs) off()
    })
  }

  watch(
    deps.liveSessionIds,
    (ids) => {
      const live = new Set(ids)
      for (const id of ids) {
        deps.trackSessionConnection(id)
        attachDockerSshListeners(id)
      }
      for (const id of [...dockerSshUnsubs.keys()]) {
        if (!live.has(id)) {
          detachDockerSshListeners(id)
          deps.forgetSession(id)
        }
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    for (const id of [...dockerSshUnsubs.keys()]) {
      detachDockerSshListeners(id)
    }
  })
}
