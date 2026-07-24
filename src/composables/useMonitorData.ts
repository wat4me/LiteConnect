import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { MonitorData } from '../env.d'
import { t } from '../i18n'

type Entry = {
  data: Ref<MonitorData | null>
  error: Ref<string>
  starting: Ref<boolean>
  refCount: number
  unsub: (() => void) | null
  monitoredSessionId: string | null
}

const entries = new Map<string, Entry>()

function getEntry(sessionId: string): Entry {
  let entry = entries.get(sessionId)
  if (!entry) {
    entry = {
      data: ref(null),
      error: ref(''),
      starting: ref(false),
      refCount: 0,
      unsub: null,
      monitoredSessionId: null,
    }
    entries.set(sessionId, entry)
  }
  return entry
}

async function startEntry(sessionId: string) {
  const entry = getEntry(sessionId)
  if (entry.monitoredSessionId === sessionId && entry.unsub && !entry.error.value) return

  stopEntry(sessionId)
  entry.error.value = ''
  entry.monitoredSessionId = sessionId
  entry.starting.value = true
  try {
    await window.LiteConnect.monitorStart(sessionId)
    entry.unsub = window.LiteConnect.onMonitorData(sessionId, (d: MonitorData) => {
      entry.data.value = d
      entry.error.value = ''
    })
  } catch (err: any) {
    entry.error.value = err?.message || t('monitor.startFailed')
    entry.monitoredSessionId = null
  } finally {
    entry.starting.value = false
  }
}

function stopEntry(sessionId: string) {
  const entry = entries.get(sessionId)
  if (!entry) return
  entry.unsub?.()
  entry.unsub = null
  if (entry.monitoredSessionId) {
    window.LiteConnect.monitorStop(entry.monitoredSessionId).catch(() => {})
    entry.monitoredSessionId = null
  }
  entry.data.value = null
}

/**
 * Shared monitor collector per SSH session (ref-counted).
 * Dock + side details can bind the same session without double start/stop races.
 */
export function useSharedMonitor(sessionId: Ref<string>) {
  let boundId: string | null = null

  const data = ref<MonitorData | null>(null)
  const error = ref('')
  const starting = ref(false)

  let stopWatchEntry: (() => void) | null = null

  function attachEntry(id: string) {
    stopWatchEntry?.()
    stopWatchEntry = null
    const entry = getEntry(id)
    data.value = entry.data.value
    error.value = entry.error.value
    starting.value = entry.starting.value

    const stop1 = watch(entry.data, (v) => {
      data.value = v
    })
    const stop2 = watch(entry.error, (v) => {
      error.value = v
    })
    const stop3 = watch(entry.starting, (v) => {
      starting.value = v
    })
    stopWatchEntry = () => {
      stop1()
      stop2()
      stop3()
    }
  }

  async function bind(id: string) {
    if (!id) return
    if (boundId === id) {
      attachEntry(id)
      return
    }
    if (boundId) {
      const prev = getEntry(boundId)
      prev.refCount = Math.max(0, prev.refCount - 1)
      if (prev.refCount === 0) {
        stopEntry(boundId)
        entries.delete(boundId)
      }
    }
    const entry = getEntry(id)
    entry.refCount += 1
    boundId = id
    attachEntry(id)
    await startEntry(id)
    data.value = entry.data.value
    error.value = entry.error.value
    starting.value = entry.starting.value
  }

  function retry() {
    const id = boundId || sessionId.value
    if (!id) return
    const entry = getEntry(id)
    entry.data.value = null
    data.value = null
    void startEntry(id)
  }

  watch(
    sessionId,
    (id) => {
      void bind(id)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    stopWatchEntry?.()
    stopWatchEntry = null
    if (boundId) {
      const entry = getEntry(boundId)
      entry.refCount = Math.max(0, entry.refCount - 1)
      if (entry.refCount === 0) {
        stopEntry(boundId)
        entries.delete(boundId)
      }
      boundId = null
    }
  })

  return { data, error, starting, retry }
}
