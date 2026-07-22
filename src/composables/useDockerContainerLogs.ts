import { getCurrentInstance, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type {
  DockerLogEntry,
  DockerLogStreamState,
  DockerLogTail,
  DockerTransportErrorCode,
} from '../env.d'
import {
  appendDockerLogEntries,
  clearDockerLogRingBuffer,
  createDockerLogRingBuffer,
  type DockerLogRingBuffer,
} from './dockerLogBuffer'

export type DockerLogsUiState = DockerLogStreamState | 'idle'

const TAILS: DockerLogTail[] = [100, 200, 500, 1000]
const REQUEST_ID_RE = /^[a-f0-9]{32}$/

export function isDockerLogTail(v: unknown): v is DockerLogTail {
  return typeof v === 'number' && (TAILS as number[]).includes(v)
}

/** Cryptographically strong enough for correlation; 32 hex chars. */
export function createDockerLogRequestId(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function isDockerLogRequestId(id: unknown): id is string {
  return typeof id === 'string' && REQUEST_ID_RE.test(id)
}

/**
 * Map stable error codes / stream state to zh-CN i18n keys under docker.logs.*
 */
export function dockerLogStateI18nKey(state: DockerLogsUiState, code?: string | null): string {
  if (state === 'idle') return 'docker.logs.state.idle'
  if (state === 'connecting') return 'docker.logs.state.connecting'
  if (state === 'streaming') return 'docker.logs.state.streaming'
  if (state === 'ended') return 'docker.logs.state.ended'
  if (state === 'disconnected') return 'docker.logs.state.disconnected'
  if (state === 'error') {
    if (code === 'container-not-found') return 'docker.logs.error.containerNotFound'
    if (code === 'permission-denied') return 'docker.logs.error.permissionDenied'
    if (code === 'ssh-disconnected') return 'docker.logs.error.sshDisconnected'
    if (code === 'generation-stale') return 'docker.logs.error.generationStale'
    if (code === 'request-timeout') return 'docker.logs.error.timeout'
    if (code === 'proxy-closed' || code === 'daemon-unavailable') {
      return 'docker.logs.error.disconnected'
    }
    return 'docker.logs.error.failed'
  }
  return 'docker.logs.state.idle'
}

type PendingEarly = {
  requestId: string
  entries: DockerLogEntry[]
  droppedFromMain: number
  state: DockerLogsUiState | null
  code: DockerTransportErrorCode | null
  entryChars: number
}

const EARLY_MAX_ENTRIES = 2_000
const EARLY_MAX_CHARS = 512_000

/**
 * Container log stream composable: start/stop, ring buffer, stale filter, auto-scroll flags.
 * Uses requestId handshake so events arriving before start Promise resolves are not lost.
 */
export function useDockerContainerLogs(sessionId: Ref<string | null>) {
  const entries = ref<DockerLogEntry[]>([])
  const droppedCount = ref(0)
  const streamState = ref<DockerLogsUiState>('idle')
  const streamErrorCode = ref<DockerTransportErrorCode | null>(null)
  const streamId = ref<string | null>(null)
  const tail = ref<DockerLogTail>(200)
  const follow = ref(true)
  const autoScroll = ref(true)
  const activeContainerId = ref<string | null>(null)
  const active = ref(false)

  let buffer: DockerLogRingBuffer = createDockerLogRingBuffer()
  /** Extra dropped count from main queue (merged into droppedCount display). */
  let mainDroppedTotal = 0
  let unsubData: (() => void) | null = null
  let unsubState: (() => void) | null = null
  let disposed = false
  let startGeneration = 0
  let currentStreamId: string | null = null
  let currentRequestId: string | null = null
  let pendingEarly: PendingEarly | null = null
  let ownerSession: string | null = null

  function syncBufferToUi(): void {
    entries.value = buffer.entries
    droppedCount.value = buffer.droppedCount + mainDroppedTotal
  }

  function clearUiOnly(): void {
    buffer = clearDockerLogRingBuffer(buffer)
    mainDroppedTotal = 0
    syncBufferToUi()
  }

  function resetLocal(): void {
    buffer = createDockerLogRingBuffer()
    mainDroppedTotal = 0
    syncBufferToUi()
    streamState.value = 'idle'
    streamErrorCode.value = null
    streamId.value = null
    currentStreamId = null
    currentRequestId = null
    pendingEarly = null
  }

  function applyDroppedFromMain(n: number): void {
    if (n > 0) {
      mainDroppedTotal += n
      syncBufferToUi()
    }
  }

  function applyEntries(list: DockerLogEntry[]): void {
    if (!list.length) return
    buffer = appendDockerLogEntries(buffer, list)
    syncBufferToUi()
  }

  function applyState(state: DockerLogStreamState, code?: DockerTransportErrorCode | null): void {
    streamState.value = state
    if (state === 'error' && code) {
      streamErrorCode.value = code
    }
  }

  function acceptEvent(payload: { streamId?: string; requestId?: string }): boolean {
    if (disposed) return false
    if (!payload) return false
    const rid = payload.requestId
    // Active stream: match streamId or current requestId
    if (currentStreamId && payload.streamId === currentStreamId) return true
    if (currentRequestId && rid === currentRequestId) return true
    // Pending start: only current pending requestId
    if (pendingEarly && rid === pendingEarly.requestId) return true
    return false
  }

  function bufferEarlyData(
    requestId: string,
    list: DockerLogEntry[],
    droppedFromMain: number,
  ): void {
    if (!pendingEarly || pendingEarly.requestId !== requestId) return
    for (const e of list) {
      pendingEarly.entries.push(e)
      pendingEarly.entryChars += e.text.length + (e.timestamp?.length || 0)
    }
    pendingEarly.droppedFromMain += droppedFromMain
    while (
      pendingEarly.entries.length > EARLY_MAX_ENTRIES ||
      pendingEarly.entryChars > EARLY_MAX_CHARS
    ) {
      const old = pendingEarly.entries.shift()
      if (!old) break
      pendingEarly.entryChars -= old.text.length + (old.timestamp?.length || 0)
      if (pendingEarly.entryChars < 0) pendingEarly.entryChars = 0
      pendingEarly.droppedFromMain += 1
    }
  }

  function flushPendingEarly(requestId: string, streamIdValue: string): void {
    if (!pendingEarly || pendingEarly.requestId !== requestId) return
    const early = pendingEarly
    pendingEarly = null
    currentStreamId = streamIdValue
    currentRequestId = requestId
    streamId.value = streamIdValue
    applyDroppedFromMain(early.droppedFromMain)
    applyEntries(early.entries)
    if (early.state) {
      applyState(early.state as DockerLogStreamState, early.code)
    }
  }

  async function stopStream(): Promise<void> {
    const sid = currentStreamId
    currentStreamId = null
    currentRequestId = null
    pendingEarly = null
    streamId.value = null
    if (sid && typeof window !== 'undefined' && window.LiteConnect?.dockerStopContainerLogs) {
      try {
        await window.LiteConnect.dockerStopContainerLogs(sid)
      } catch {
        // ignore — stop is best-effort / idempotent
      }
    }
  }

  async function startForContainer(containerId: string): Promise<void> {
    if (disposed) return
    const sid = sessionId.value
    if (!sid || !containerId) {
      await stopStream()
      resetLocal()
      activeContainerId.value = null
      active.value = false
      return
    }

    startGeneration += 1
    const gen = startGeneration
    ownerSession = sid
    activeContainerId.value = containerId
    active.value = true

    await stopStream()
    if (disposed || gen !== startGeneration) return
    buffer = createDockerLogRingBuffer()
    mainDroppedTotal = 0
    syncBufferToUi()
    streamState.value = 'connecting'
    streamErrorCode.value = null

    if (!window.LiteConnect?.dockerStartContainerLogs) {
      streamState.value = 'error'
      streamErrorCode.value = 'request-failed'
      return
    }

    const requestId = createDockerLogRequestId()
    currentRequestId = requestId
    pendingEarly = {
      requestId,
      entries: [],
      droppedFromMain: 0,
      state: null,
      code: null,
      entryChars: 0,
    }

    const res = await window.LiteConnect.dockerStartContainerLogs(sid, containerId, {
      tail: tail.value,
      follow: follow.value,
      requestId,
    })

    if (disposed || gen !== startGeneration || ownerSession !== sessionId.value) {
      pendingEarly = null
      currentRequestId = null
      if (res.ok) {
        try {
          await window.LiteConnect.dockerStopContainerLogs(res.streamId)
        } catch {}
      }
      return
    }

    if (!res.ok) {
      pendingEarly = null
      currentRequestId = null
      currentStreamId = null
      streamId.value = null
      streamState.value = 'error'
      streamErrorCode.value = res.code
      return
    }

    flushPendingEarly(requestId, res.streamId)
    // If no early state applied, stay connecting until main sends streaming/ended/error
    if (!streamState.value || streamState.value === 'connecting') {
      // already connecting or was set by early state
    }
  }

  function ensureSubscribed(): void {
    if (unsubData || typeof window === 'undefined' || !window.LiteConnect) return
    unsubData = window.LiteConnect.onDockerContainerLogData((payload) => {
      if (!acceptEvent(payload)) return
      const rid = payload.requestId
      const dropped = typeof payload.droppedFromMain === 'number' ? payload.droppedFromMain : 0
      // Still pending start resolve
      if (pendingEarly && rid === pendingEarly.requestId && !currentStreamId) {
        bufferEarlyData(rid, payload.entries || [], dropped)
        return
      }
      applyDroppedFromMain(dropped)
      applyEntries(payload.entries || [])
    })
    unsubState = window.LiteConnect.onDockerContainerLogState((payload) => {
      if (!acceptEvent(payload)) return
      const rid = payload.requestId
      if (pendingEarly && rid === pendingEarly.requestId && !currentStreamId) {
        pendingEarly.state = payload.state
        if (payload.state === 'error' && payload.code) {
          pendingEarly.code = payload.code as DockerTransportErrorCode
        }
        return
      }
      applyState(payload.state, payload.code as DockerTransportErrorCode | undefined)
    })
  }

  function unsubscribeAll(): void {
    try {
      unsubData?.()
    } catch {}
    try {
      unsubState?.()
    } catch {}
    unsubData = null
    unsubState = null
  }

  /** Explicit lifecycle hook for tests and non-component consumers. Idempotent. */
  function dispose(): void {
    if (disposed) return
    disposed = true
    startGeneration += 1
    void stopStream()
    unsubscribeAll()
    pendingEarly = null
  }

  async function activate(containerId: string): Promise<void> {
    ensureSubscribed()
    await startForContainer(containerId)
  }

  async function deactivate(): Promise<void> {
    startGeneration += 1
    active.value = false
    await stopStream()
    activeContainerId.value = null
    streamState.value = 'idle'
    streamErrorCode.value = null
  }

  function setTail(next: DockerLogTail): void {
    if (!isDockerLogTail(next) || next === tail.value) return
    tail.value = next
    if (active.value && activeContainerId.value) {
      void startForContainer(activeContainerId.value)
    }
  }

  function setFollow(next: boolean): void {
    if (next === follow.value) return
    follow.value = next
    if (active.value && activeContainerId.value) {
      void startForContainer(activeContainerId.value)
    }
  }

  function setAutoScroll(next: boolean): void {
    autoScroll.value = next
  }

  function clearLogs(): void {
    clearUiOnly()
  }

  watch(sessionId, (next, prev) => {
    if (next === prev) return
    startGeneration += 1
    void stopStream().then(() => {
      resetLocal()
      activeContainerId.value = null
      active.value = false
    })
  })

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      dispose()
    })
  }

  return {
    entries,
    droppedCount,
    streamState,
    streamErrorCode,
    streamId,
    tail,
    follow,
    autoScroll,
    activeContainerId,
    active,
    activate,
    deactivate,
    setTail,
    setFollow,
    setAutoScroll,
    clearLogs,
    stopStream,
    dispose,
    dockerLogStateI18nKey,
  }
}
