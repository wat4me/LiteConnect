import { computed, type ComputedRef, type Ref } from 'vue'
import type { Connection } from '../../env.d'
import type { ConnectionGroup, Session, SplitDropPayload } from '@/domain/session/types'
import type { SplitMode, SplitSide } from '@/domain/terminal/types'
import type { TerminalPwdTracker } from '@/domain/terminal/types'
import type { BatchCommandTarget } from '@/domain/snippets/types'
import { buildBatchSessionTarget } from '@/utils/session/sessionDisplay'
import { isNonRetryableSshError } from '@/utils/session/sshErrorRetry'

export type { SplitDropPayload }

/**
 * Session lifecycle + split wiring used by the SSH workspace.
 */
export function useSessionActions(deps: {
  groups: Ref<ConnectionGroup[]>
  connections: Ref<Connection[]>
  activeGroup: ComputedRef<ConnectionGroup | null>
  pwdTracker: TerminalPwdTracker
  getGroupBySessionId: (sessionId: string) => ConnectionGroup | null
  createSession: (connectionId: string) => Promise<string | null>
  removeSessionFromState: (sessionId: string) => void
  onCloseSession: (sessionId: string) => Promise<void>
  onSessionClosed: (sessionId: string) => void
  clearUnread: (sessionId: string) => void
  setSidebarTarget: (groupId: string | null, sessionId: string | null) => void
  setPreviewMode: (mode: SplitMode) => void
  setPreviewSide: (side: SplitSide | null) => void
  setSecondarySessionId: (sessionId: string | null) => void
  setSplitMode: (mode: SplitMode, side?: SplitSide) => void
  startSplitResize: (e: MouseEvent, el: HTMLElement) => void
}) {
  const batchSessions = computed<BatchCommandTarget[]>(() => {
    const sessions: BatchCommandTarget[] = []
    for (const group of deps.groups.value) {
      for (const s of group.sessions) {
        sessions.push(buildBatchSessionTarget(deps.connections.value, s))
      }
    }
    return sessions
  })

  /** Open session ids — TerminalWorkspace prunes retained panes after close. */
  const liveSessionIds = computed(() => {
    const ids: string[] = []
    for (const group of deps.groups.value) {
      for (const s of group.sessions) ids.push(s.id)
    }
    return ids
  })

  function handleSessionClosed(sessionId: string) {
    deps.clearUnread(sessionId)
    deps.onSessionClosed(sessionId)
  }

  /**
   * In-place reconnect: keep the same sessionId so TerminalTab / SFTP stay mounted.
   * On failure keep the tab and notify TerminalTab so it can reschedule auto-reconnect.
   * Falls back to legacy destroy+create only if sshReconnect is unavailable.
   */
  async function handleReconnect(sessionId: string) {
    const group = deps.getGroupBySessionId(sessionId)
    if (!group) return
    const connectionId = group.connectionId
    try {
      if (typeof window.LiteConnect.sshReconnect === 'function') {
        await window.LiteConnect.sshReconnect(sessionId, connectionId)
        const sess = group.sessions.find((s) => s.id === sessionId)
        if (sess) sess.pending = false
        return
      }
    } catch (err: any) {
      console.error('In-place reconnect failed:', err)
      const message = err?.message || String(err)
      window.dispatchEvent(
        new CustomEvent('ssh-reconnect-failed', {
          detail: {
            sessionId,
            message,
            nonRetryable: isNonRetryableSshError(message),
          },
        }),
      )
      return
    }
    try {
      await window.LiteConnect.sshDisconnect(sessionId)
    } catch {}
    deps.removeSessionFromState(sessionId)
    await deps.createSession(connectionId)
  }

  function handleCloseSession(sessionId: string) {
    deps.clearUnread(sessionId)
    return deps.onCloseSession(sessionId)
  }

  function onCdCommand(sessionId: string, command: string) {
    deps.pwdTracker.handleCd(sessionId, command)
  }

  function onPwdOutput(sessionId: string, pwd: string) {
    deps.pwdTracker.setPwd(sessionId, pwd)
  }

  function onDragSplitPreview(payload: SplitDropPayload | null) {
    if (!payload) {
      deps.setPreviewMode('none')
      deps.setPreviewSide(null)
      return
    }
    deps.setPreviewMode(payload.mode)
    deps.setPreviewSide(payload.side)
  }

  function onDragSplitCommit(payload: SplitDropPayload) {
    deps.setPreviewMode('none')
    deps.setPreviewSide(null)
    const group = deps.activeGroup.value
    if (group && group.activeSessionId === payload.sessionId) {
      const other = group.sessions.find((s: Session) => s.id !== payload.sessionId)
      if (other) {
        group.activeSessionId = other.id
        deps.setSidebarTarget(group.connectionId, other.id)
      }
    }
    deps.setSecondarySessionId(payload.sessionId)
    deps.setSplitMode(payload.mode, payload.side)
  }

  function onStartSplitResize(event: MouseEvent, container: HTMLElement) {
    deps.startSplitResize(event, container)
  }

  return {
    batchSessions,
    liveSessionIds,
    handleSessionClosed,
    handleReconnect,
    handleCloseSession,
    onCdCommand,
    onPwdOutput,
    onDragSplitPreview,
    onDragSplitCommit,
    onStartSplitResize,
  }
}
