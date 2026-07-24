import { computed, getCurrentInstance, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { DockerAvailability } from '../env.d'

export type DockerProbeUiState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'result'; availability: DockerAvailability }
  | { kind: 'error'; reason: 'probe-failed' }

/**
 * Per-session Docker probe with generation / session stale guards.
 * Late results must never overwrite a newer session, generation, or refresh.
 */
export function useDockerProbe(sessionId: Ref<string | null>) {
  const ui = ref<DockerProbeUiState>({ kind: 'idle' })
  const probing = ref(false)

  /** Monotonic generation per active probe owner (sessionId). */
  let generation = 0
  let ownerSessionId: string | null = null
  let disposed = false

  const availability = computed<DockerAvailability | null>(() => {
    if (ui.value.kind === 'result') return ui.value.availability
    return null
  })

  const status = computed(() => availability.value?.status ?? null)

  function invalidate(): void {
    generation += 1
  }

  function resetForSession(nextId: string | null): void {
    invalidate()
    ownerSessionId = nextId
    probing.value = false
    if (!nextId) {
      ui.value = { kind: 'idle' }
      return
    }
    ui.value = { kind: 'idle' }
  }

  async function probe(options?: { silent?: boolean }): Promise<void> {
    const sid = sessionId.value
    if (!sid || disposed) return

    const gen = ++generation
    ownerSessionId = sid
    probing.value = true
    if (!options?.silent || ui.value.kind === 'idle') {
      ui.value = { kind: 'loading' }
    }

    try {
      const result = await window.LiteConnect.dockerProbe(sid)
      if (disposed) return
      if (gen !== generation) return
      if (ownerSessionId !== sid) return
      if (sessionId.value !== sid) return
      ui.value = { kind: 'result', availability: result }
    } catch {
      if (disposed) return
      if (gen !== generation) return
      if (ownerSessionId !== sid) return
      if (sessionId.value !== sid) return
      ui.value = { kind: 'error', reason: 'probe-failed' }
    } finally {
      if (!disposed && gen === generation && ownerSessionId === sid && sessionId.value === sid) {
        probing.value = false
      }
    }
  }

  function refresh(): void {
    void probe({ silent: ui.value.kind === 'result' })
  }

  watch(
    sessionId,
    (next, prev) => {
      if (next === prev) return
      resetForSession(next)
      if (next) void probe()
    },
    { immediate: true },
  )

  function dispose(): void {
    disposed = true
    invalidate()
  }

  // Register only when called from component setup(); tests call dispose() explicitly.
  if (getCurrentInstance()) {
    onBeforeUnmount(dispose)
  }

  return {
    ui,
    probing,
    availability,
    status,
    probe,
    refresh,
    invalidate,
    resetForSession,
    dispose,
  }
}

/** Pure helper for tests: decide if a late probe result may be applied. */
export function canApplyProbeResult(opts: {
  disposed: boolean
  resultGen: number
  currentGen: number
  ownerSessionId: string | null
  resultSessionId: string
  activeSessionId: string | null
}): boolean {
  if (opts.disposed) return false
  if (opts.resultGen !== opts.currentGen) return false
  if (opts.ownerSessionId !== opts.resultSessionId) return false
  if (opts.activeSessionId !== opts.resultSessionId) return false
  return true
}
