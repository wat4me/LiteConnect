import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { MonitorData } from '@/env.d'
import { t } from '@/i18n'

type Entry = {
  data: Ref<MonitorData | null>
  error: Ref<string>
  starting: Ref<boolean>
  refCount: number
  unsub: (() => void) | null
  execSessionId: string | null
  started: boolean
  startPromise: Promise<void> | null
}

const entries = new Map<string, Entry>()

function getEntry(connectionId: string): Entry {
  let entry = entries.get(connectionId)
  if (!entry) {
    entry = {
      data: ref(null),
      error: ref(''),
      starting: ref(false),
      refCount: 0,
      unsub: null,
      execSessionId: null,
      started: false,
      startPromise: null,
    }
    entries.set(connectionId, entry)
  }
  return entry
}

async function startEntry(connectionId: string, sessionId: string) {
  const entry = getEntry(connectionId)
  if (entry.startPromise) {
    await entry.startPromise
  }
  if (entry.started && entry.unsub && !entry.error.value) {
    if (entry.execSessionId !== sessionId) {
      entry.execSessionId = sessionId
      await window.LiteConnect.monitorStart(connectionId, sessionId)
    }
    return
  }

  const run = (async () => {
    stopEntry(connectionId, false)
    entry.error.value = ''
    entry.execSessionId = sessionId
    entry.starting.value = true
    try {
      await window.LiteConnect.monitorStart(connectionId, sessionId)
      entry.unsub = window.LiteConnect.onMonitorData(connectionId, (d: MonitorData) => {
        entry.data.value = d
        entry.error.value = ''
      })
      entry.started = true
    } catch (err: any) {
      entry.error.value = err?.message || t('monitor.startFailed')
      entry.execSessionId = null
      entry.started = false
    } finally {
      entry.starting.value = false
    }
  })()
  entry.startPromise = run
  try {
    await run
  } finally {
    if (entry.startPromise === run) entry.startPromise = null
  }
}

function stopEntry(connectionId: string, clearData = true) {
  const entry = entries.get(connectionId)
  if (!entry) return
  entry.unsub?.()
  entry.unsub = null
  entry.started = false
  if (entry.execSessionId) {
    window.LiteConnect.monitorStop(connectionId).catch(() => {})
    entry.execSessionId = null
  }
  if (clearData) entry.data.value = null
}

/**
 * Shared monitor collector per SSH host (ref-counted).
 * Extra terminals on the same connection retarget exec without dropping the snapshot.
 */
export function useSharedMonitor(connectionId: Ref<string>, sessionId: Ref<string>) {
  let boundConnection: string | null = null

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

  async function bind(nextConnectionId: string, nextSessionId: string) {
    if (!nextConnectionId || !nextSessionId) return
    if (boundConnection === nextConnectionId) {
      attachEntry(nextConnectionId)
      const entry = getEntry(nextConnectionId)
      if (entry.execSessionId !== nextSessionId || !entry.started) {
        await startEntry(nextConnectionId, nextSessionId)
        data.value = entry.data.value
        error.value = entry.error.value
        starting.value = entry.starting.value
      }
      return
    }
    if (boundConnection) {
      const prev = getEntry(boundConnection)
      prev.refCount = Math.max(0, prev.refCount - 1)
      if (prev.refCount === 0) {
        stopEntry(boundConnection)
        entries.delete(boundConnection)
      }
    }
    const entry = getEntry(nextConnectionId)
    entry.refCount += 1
    boundConnection = nextConnectionId
    attachEntry(nextConnectionId)
    await startEntry(nextConnectionId, nextSessionId)
    data.value = entry.data.value
    error.value = entry.error.value
    starting.value = entry.starting.value
  }

  function retry() {
    const id = boundConnection || connectionId.value
    const sid = sessionId.value
    if (!id || !sid) return
    const entry = getEntry(id)
    entry.data.value = null
    entry.started = false
    data.value = null
    void startEntry(id, sid)
  }

  watch(
    [connectionId, sessionId],
    ([cid, sid]) => {
      void bind(cid, sid)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    stopWatchEntry?.()
    stopWatchEntry = null
    if (boundConnection) {
      const prev = getEntry(boundConnection)
      prev.refCount = Math.max(0, prev.refCount - 1)
      if (prev.refCount === 0) {
        stopEntry(boundConnection)
        entries.delete(boundConnection)
      }
      boundConnection = null
    }
  })

  return { data, error, starting, retry }
}
