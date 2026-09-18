import { ref, watch, onMounted, onBeforeUnmount, type Ref } from 'vue'
import type { ConnectionGroup } from './useSessionManager'

export function useLatencyState(deps: {
  groups: Ref<ConnectionGroup[]>
}) {
  const latencyMap = ref<Record<string, number>>({})
  const latencyEnabled = ref(true)
  const latencyIntervalMs = ref(10000)

  const probeSessions = new Map<string, string>()
  let monitorTimer: ReturnType<typeof setInterval> | null = null
  let measuring = false

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
    if (!latencyEnabled.value || measuring) return
    measuring = true
    try {
      const activeIds = new Set(deps.groups.value.map((g) => g.connectionId))
      for (const id of [...probeSessions.keys()]) {
        if (!activeIds.has(id)) {
          probeSessions.delete(id)
          delete latencyMap.value[id]
        }
      }
      const tasks = deps.groups.value.map(async (group) => {
        const sessionId = getProbeSession(group.connectionId)
        if (!sessionId) return
        try {
          const ms = await window.LiteConnect.sshMeasureLatency(sessionId)
          latencyMap.value[group.connectionId] = ms
        } catch {
          latencyMap.value[group.connectionId] = -1
        }
      })
      await Promise.all(tasks)
    } finally {
      measuring = false
    }
  }

  function startMonitor() {
    stopMonitor()
    if (!latencyEnabled.value) return
    void measureAll()
    monitorTimer = setInterval(() => void measureAll(), latencyIntervalMs.value)
  }

  function stopMonitor() {
    if (monitorTimer) {
      clearInterval(monitorTimer)
      monitorTimer = null
    }
  }

  watch(latencyIntervalMs, () => startMonitor())
  watch(latencyEnabled, (enabled) => {
    if (enabled) startMonitor()
    else stopMonitor()
  })

  onMounted(() => startMonitor())
  onBeforeUnmount(() => stopMonitor())

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
