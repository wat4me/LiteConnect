import { ref, watch, onMounted, onBeforeUnmount, type Ref } from 'vue'
import type { ConnectionGroup } from './useSessionManager'

export function useLatencyState(deps: {
  groups: Ref<ConnectionGroup[]>
}) {
  const latencyMap = ref<Record<string, number>>({})
  const latencyEnabled = ref(true)
  const latencyIntervalMs = ref(10000)

  const probeSessions = new Map<string, string>()
  let monitorTimer: ReturnType<typeof setTimeout> | null = null
  let measuring = false
  let mounted = false
  let disposed = false
  let generation = 0
  let refreshPending = false
  const BACKGROUND_INTERVAL_MS = 60_000
  const MAX_CONCURRENT_PROBES = 4

  function pickProbeSession(group: ConnectionGroup): string | null {
    if (group.sessions.length === 0) return null
    if (group.activeSessionId && group.sessions.some((s) => s.id === group.activeSessionId)) {
      return group.activeSessionId
    }
    return group.sessions[0].id
  }

  function getProbeSession(connectionId: string): string | null {
    const group = deps.groups.value.find((g) => g.connectionId === connectionId)
    if (!group || group.sessions.length === 0) {
      probeSessions.delete(connectionId)
      return null
    }
    const current = probeSessions.get(connectionId)
    if (current && group.sessions.some((s) => s.id === current)) {
      return current
    }
    const next = pickProbeSession(group)
    if (next) probeSessions.set(connectionId, next)
    return next
  }

  async function measureAll() {
    if (!latencyEnabled.value || measuring || disposed || !mounted) return
    measuring = true
    refreshPending = false
    const version = generation
    try {
      pruneRemovedHosts()
      const ids = [...new Set(deps.groups.value.filter(group => group.sessions.length > 0).map(group => group.connectionId))]
      let cursor = 0
      async function worker() {
        while (cursor < ids.length && version === generation && latencyEnabled.value && !disposed) {
          const id = ids[cursor++]
          const sessionId = getProbeSession(id)
          if (!sessionId) continue
          let ms = -1
          try { ms = await window.LiteConnect.sshMeasureLatency(sessionId) } catch { /* Show unavailable for this round. */ }
          if (version === generation && !disposed && getProbeSession(id) === sessionId) latencyMap.value[id] = ms
        }
      }
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_PROBES, ids.length) }, worker))
    } finally {
      measuring = false
      scheduleNext(refreshPending && !document.hidden ? 0 : pollInterval())
    }
  }

  function pruneRemovedHosts() {
    const ids = new Set(deps.groups.value.filter(group => group.sessions.length > 0).map(group => group.connectionId))
    for (const id of new Set([...probeSessions.keys(), ...Object.keys(latencyMap.value)])) {
      if (ids.has(id)) continue
      probeSessions.delete(id)
      delete latencyMap.value[id]
    }
  }

  function pollInterval() {
    const configured = Math.max(1000, Math.min(60_000, Number(latencyIntervalMs.value) || 10_000))
    return document.hidden ? Math.max(BACKGROUND_INTERVAL_MS, configured) : configured
  }

  function scheduleNext(delay: number) {
    if (disposed || !mounted || !latencyEnabled.value || !deps.groups.value.some(group => group.sessions.length > 0)) return
    if (monitorTimer) clearTimeout(monitorTimer)
    monitorTimer = setTimeout(() => { monitorTimer = null; void measureAll() }, delay)
  }

  function stopMonitor() {
    if (monitorTimer) {
      clearTimeout(monitorTimer)
      monitorTimer = null
    }
  }

  function requestRefresh() {
    generation++
    stopMonitor()
    pruneRemovedHosts()
    refreshPending = latencyEnabled.value && !document.hidden
    if (!measuring) scheduleNext(refreshPending ? 0 : pollInterval())
  }

  watch([latencyEnabled, latencyIntervalMs], requestRefresh)
  watch(() => deps.groups.value.map(group => group.connectionId + ':' + group.sessions.map(session => session.id).join(',')).join('|'), requestRefresh)

  onMounted(() => {
    mounted = true
    document.addEventListener('visibilitychange', requestRefresh)
    requestRefresh()
  })
  onBeforeUnmount(() => {
    disposed = true
    generation++
    stopMonitor()
    document.removeEventListener('visibilitychange', requestRefresh)
  })

  function handleLatencySettingsChange(e: Event) {
    const detail = (e as CustomEvent).detail
    if (detail && detail.enabled !== undefined) {
      latencyEnabled.value = detail.enabled
    }
    if (detail && detail.intervalMs !== undefined) {
      latencyIntervalMs.value = detail.intervalMs
    }
  }

  return {
    latencyMap,
    latencyEnabled,
    latencyIntervalMs,
    handleLatencySettingsChange,
  }
}
