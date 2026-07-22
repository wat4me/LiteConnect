import { computed, getCurrentInstance, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type {
  DockerContainerInspectResult,
  DockerContainerSummary,
} from '../env.d'
import {
  filterContainers,
  resolveSelectionAfterRefresh,
  type DockerListStateFilter,
} from './dockerContainersFilter'

export type DockerContainersLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

/**
 * Container list + inspect with session/refresh/inspect generation guards.
 * - First load → loading; refresh keeps previous list.
 * - Late session / refresh / inspect results are discarded.
 */
export function useDockerContainers(sessionId: Ref<string | null>) {
  const containers = ref<DockerContainerSummary[]>([])
  const loadState = ref<DockerContainersLoadState>({ kind: 'idle' })
  const refreshing = ref(false)
  const stateFilter = ref<DockerListStateFilter>('all')
  const searchQuery = ref('')
  const selectedId = ref<string | null>(null)

  const inspectResult = ref<DockerContainerInspectResult | null>(null)
  const inspectLoading = ref(false)
  const inspectError = ref<string | null>(null)

  let listGeneration = 0
  let inspectGeneration = 0
  let ownerSessionId: string | null = null
  let disposed = false
  /** True once we have successfully loaded for current session (enables keep-list refresh). */
  let hasLoadedOnce = false

  const filteredContainers = computed(() =>
    filterContainers(containers.value, stateFilter.value, searchQuery.value),
  )

  const selectedContainer = computed(() => {
    const id = selectedId.value
    if (!id) return null
    return containers.value.find((c) => c.id === id) ?? null
  })

  function invalidateList(): void {
    listGeneration += 1
  }

  function invalidateInspect(): void {
    inspectGeneration += 1
  }

  function clearInspect(): void {
    invalidateInspect()
    inspectResult.value = null
    inspectLoading.value = false
    inspectError.value = null
  }

  function resetForSession(nextId: string | null): void {
    invalidateList()
    clearInspect()
    ownerSessionId = nextId
    containers.value = []
    selectedId.value = null
    hasLoadedOnce = false
    refreshing.value = false
    searchQuery.value = ''
    stateFilter.value = 'all'
    if (!nextId) {
      loadState.value = { kind: 'idle' }
      return
    }
    loadState.value = { kind: 'idle' }
  }

  function canApplyList(opts: {
    gen: number
    sid: string
  }): boolean {
    if (disposed) return false
    if (opts.gen !== listGeneration) return false
    if (ownerSessionId !== opts.sid) return false
    if (sessionId.value !== opts.sid) return false
    return true
  }

  function canApplyInspect(opts: {
    gen: number
    sid: string
    containerId: string
  }): boolean {
    if (disposed) return false
    if (opts.gen !== inspectGeneration) return false
    if (ownerSessionId !== opts.sid) return false
    if (sessionId.value !== opts.sid) return false
    if (selectedId.value !== opts.containerId) return false
    return true
  }

  async function loadList(options?: { keepExisting?: boolean }): Promise<void> {
    const sid = sessionId.value
    if (!sid || disposed) return

    const keep = options?.keepExisting === true && hasLoadedOnce && containers.value.length >= 0
    const gen = ++listGeneration
    ownerSessionId = sid

    if (keep) {
      refreshing.value = true
    } else {
      loadState.value = { kind: 'loading' }
      refreshing.value = false
    }

    try {
      const list = await window.LiteConnect.dockerListContainers(sid)
      if (!canApplyList({ gen, sid })) return
      containers.value = list
      hasLoadedOnce = true
      loadState.value = { kind: 'ready' }
      selectedId.value = resolveSelectionAfterRefresh(selectedId.value, list)
      if (!selectedId.value) {
        clearInspect()
      }
    } catch (err) {
      if (!canApplyList({ gen, sid })) return
      const message = err instanceof Error ? err.message : String(err)
      // Keep previous list on refresh failure
      if (!keep || !hasLoadedOnce) {
        containers.value = []
        selectedId.value = null
        clearInspect()
      }
      loadState.value = { kind: 'error', message }
    } finally {
      if (gen === listGeneration && ownerSessionId === sid && sessionId.value === sid) {
        refreshing.value = false
      }
    }
  }

  async function refresh(): Promise<void> {
    await loadList({ keepExisting: hasLoadedOnce })
  }

  function setStateFilter(next: DockerListStateFilter): void {
    stateFilter.value = next
  }

  function setSearchQuery(next: string): void {
    searchQuery.value = next
  }

  async function selectContainer(containerId: string | null): Promise<void> {
    if (selectedId.value === containerId) return
    selectedId.value = containerId
    clearInspect()
    if (!containerId) return
    await loadInspect(containerId)
  }

  async function loadInspect(containerId: string): Promise<void> {
    const sid = sessionId.value
    if (!sid || disposed || !containerId) return

    const gen = ++inspectGeneration
    inspectLoading.value = true
    inspectError.value = null
    inspectResult.value = null

    try {
      const result = await window.LiteConnect.dockerInspectContainer(sid, containerId)
      if (!canApplyInspect({ gen, sid, containerId })) return
      inspectResult.value = result
      inspectError.value = null
    } catch (err) {
      if (!canApplyInspect({ gen, sid, containerId })) return
      inspectResult.value = null
      inspectError.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (gen === inspectGeneration && sessionId.value === sid && selectedId.value === containerId) {
        inspectLoading.value = false
      }
    }
  }

  async function refreshInspect(): Promise<void> {
    const id = selectedId.value
    if (id) await loadInspect(id)
  }

  // Session switch only resets; parent loads when Docker is available (avoids race with probe).
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
    invalidateList()
    invalidateInspect()
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(dispose)
  }

  return {
    containers,
    filteredContainers,
    loadState,
    refreshing,
    stateFilter,
    searchQuery,
    selectedId,
    selectedContainer,
    inspectResult,
    inspectLoading,
    inspectError,
    loadList,
    refresh,
    setStateFilter,
    setSearchQuery,
    selectContainer,
    loadInspect,
    refreshInspect,
    clearInspect,
    resetForSession,
    dispose,
    // test helpers
    canApplyList,
    canApplyInspect,
    getListGeneration: () => listGeneration,
    getInspectGeneration: () => inspectGeneration,
  }
}

/** Pure helper for tests: late list result may apply. */
export function canApplyContainersListResult(opts: {
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

/** Pure helper for tests: late inspect result may apply. */
export function canApplyInspectResult(opts: {
  disposed: boolean
  resultGen: number
  currentGen: number
  ownerSessionId: string | null
  resultSessionId: string
  activeSessionId: string | null
  selectedId: string | null
  resultContainerId: string
}): boolean {
  if (opts.disposed) return false
  if (opts.resultGen !== opts.currentGen) return false
  if (opts.ownerSessionId !== opts.resultSessionId) return false
  if (opts.activeSessionId !== opts.resultSessionId) return false
  if (opts.selectedId !== opts.resultContainerId) return false
  return true
}
