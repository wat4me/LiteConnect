import { getCurrentInstance, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type {
  DockerContainerAction,
  DockerContainerActionIpcResponse,
  DockerTransportErrorCode,
} from '../env.d'
import {
  canApplyContainerActionResult,
  mapActionResultToFeedback,
  type DockerActionFeedbackKind,
} from './dockerContainerActions'

export type DockerContainerActionUiState = {
  action: DockerContainerAction
  busy: boolean
}

export type DockerActionFeedback = {
  kind: DockerActionFeedbackKind
  action: DockerContainerAction
  containerId: string
}

/**
 * Per-container action busy state with session/generation guards.
 * - Same container: one in-flight IPC (dedupe rapid clicks).
 * - Busy stays true through success refresh until list/inspect refresh settles.
 * - Different containers may run in parallel (UI only disables busy rows).
 * - Late results after session switch / dispose never toast or refresh.
 */
export function useDockerContainerActions(sessionId: Ref<string | null>) {
  /** Busy map by containerId for current session. */
  const busyById = ref<Record<string, DockerContainerActionUiState>>({})
  const feedback = ref<DockerActionFeedback | null>(null)

  let actionGeneration = 0
  let ownerSessionId: string | null = null
  let disposed = false
  /** In-flight promises for renderer-side dedupe (same container). */
  const inflight = new Map<string, Promise<void>>()

  function clearBusy(): void {
    busyById.value = {}
  }

  function clearFeedback(): void {
    feedback.value = null
  }

  function resetForSession(nextId: string | null): void {
    actionGeneration += 1
    ownerSessionId = nextId
    inflight.clear()
    clearBusy()
    clearFeedback()
  }

  function isBusy(containerId: string): boolean {
    return !!busyById.value[containerId]?.busy
  }

  function getBusyAction(containerId: string): DockerContainerAction | null {
    const s = busyById.value[containerId]
    return s?.busy ? s.action : null
  }

  function setBusy(containerId: string, action: DockerContainerAction | null): void {
    if (!action) {
      if (!(containerId in busyById.value)) return
      const next = { ...busyById.value }
      delete next[containerId]
      busyById.value = next
      return
    }
    busyById.value = {
      ...busyById.value,
      [containerId]: { action, busy: true },
    }
  }

  function stillOwned(opts: {
    sid: string
    gen: number
  }): boolean {
    return canApplyContainerActionResult({
      disposed,
      resultSessionId: opts.sid,
      activeSessionId: sessionId.value,
      ownerSessionId,
      resultGen: opts.gen,
      currentGen: actionGeneration,
    })
  }

  async function runAction(
    containerId: string,
    action: DockerContainerAction,
    options?: {
      onSuccessRefresh?: () => Promise<void>
    },
  ): Promise<void> {
    const sid = sessionId.value
    if (!sid || disposed || !containerId) return

    const dedupeKey = `${sid}:${containerId}`
    const existing = inflight.get(dedupeKey)
    if (existing) return existing

    const gen = actionGeneration
    ownerSessionId = sid
    setBusy(containerId, action)

    const work = (async () => {
      let response: DockerContainerActionIpcResponse
      try {
        response = await window.LiteConnect.dockerContainerAction(sid, containerId, action)
      } catch {
        response = { ok: false, code: 'request-failed' as DockerTransportErrorCode }
      }

      if (!stillOwned({ sid, gen })) return

      const kind = mapActionResultToFeedback(response)
      // Show feedback when IPC settles; keep busy during success refresh.
      feedback.value = { kind, action, containerId }

      const needsRefresh = response.ok || kind === 'container-not-found'
      if (needsRefresh && options?.onSuccessRefresh) {
        try {
          await options.onSuccessRefresh()
        } catch {
          // Refresh failure must not leave permanent busy; feedback already set.
        }
      }
    })().finally(() => {
      if (inflight.get(dedupeKey) === work) {
        inflight.delete(dedupeKey)
      }
      // Clear busy only after IPC + optional refresh, and only if still owned.
      if (stillOwned({ sid, gen })) {
        if (busyById.value[containerId]?.busy) {
          setBusy(containerId, null)
        }
      }
    })

    inflight.set(dedupeKey, work)
    return work
  }

  watch(
    sessionId,
    (next, prev) => {
      if (next === prev) return
      resetForSession(next)
    },
    { immediate: true },
  )

  function dispose(): void {
    disposed = true
    actionGeneration += 1
    inflight.clear()
    clearBusy()
    clearFeedback()
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(dispose)
  }

  return {
    busyById,
    feedback,
    isBusy,
    getBusyAction,
    runAction,
    clearFeedback,
    resetForSession,
    dispose,
    // test helpers
    getActionGeneration: () => actionGeneration,
  }
}
