import { getCurrentInstance, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type {
  DockerExecShell,
  DockerExecState,
  DockerTransportErrorCode,
} from '../../env.d'

export type DockerExecUiState = DockerExecState | 'idle'

const REQUEST_ID_RE = /^[a-f0-9]{32}$/
const TERMINAL_ID_RE = /^[a-f0-9]{32}$/

/** Cryptographically strong enough for correlation; 32 hex chars. */
export function createDockerExecRequestId(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function isDockerExecRequestId(id: unknown): id is string {
  return typeof id === 'string' && REQUEST_ID_RE.test(id)
}

export function isDockerExecTerminalId(id: unknown): id is string {
  return typeof id === 'string' && TERMINAL_ID_RE.test(id)
}

export function isDockerExecShell(v: unknown): v is DockerExecShell {
  return v === 'bash' || v === 'sh'
}

/**
 * Map stable error codes / exec state to zh-CN i18n keys under docker.terminal.*
 */
export function dockerExecStateI18nKey(
  state: DockerExecUiState,
  code?: string | null,
  shell?: DockerExecShell | null,
): string {
  if (state === 'idle') return 'docker.terminal.state.idle'
  if (state === 'connecting') return 'docker.terminal.state.connecting'
  if (state === 'attached') {
    if (shell === 'sh') return 'docker.terminal.state.attachedSh'
    return 'docker.terminal.state.attachedBash'
  }
  if (state === 'ended') return 'docker.terminal.state.ended'
  if (state === 'disconnected') return 'docker.terminal.state.disconnected'
  if (state === 'error') {
    if (code === 'container-not-found') return 'docker.terminal.error.containerNotFound'
    if (code === 'container-not-running') return 'docker.terminal.error.containerNotRunning'
    if (code === 'permission-denied') return 'docker.terminal.error.permissionDenied'
    if (code === 'ssh-disconnected') return 'docker.terminal.error.sshDisconnected'
    if (code === 'generation-stale') return 'docker.terminal.error.generationStale'
    if (code === 'request-timeout') return 'docker.terminal.error.timeout'
    if (code === 'attach-protocol-error') return 'docker.terminal.error.attachProtocol'
    if (code === 'output-overflow') return 'docker.terminal.error.outputOverflow'
    if (code === 'proxy-closed' || code === 'daemon-unavailable') {
      return 'docker.terminal.error.disconnected'
    }
    return 'docker.terminal.error.failed'
  }
  return 'docker.terminal.state.idle'
}

type PendingEarly = {
  requestId: string
  chunks: ArrayBuffer[]
  chunkBytes: number
  state: DockerExecUiState | null
  code: DockerTransportErrorCode | null
  exitCode: number | null | undefined
  /**
   * Set when pending raw TTY bytes exceeded EARLY_MAX_BYTES.
   * Raw bytes must never be silently dropped or truncated (would break UTF-8/ANSI).
   * The start is marked as a stable output-overflow error; late success terminalId
   * is stopped immediately and no truncated bytes are flushed to the data handler.
   */
  overflowed: boolean
}

const EARLY_MAX_BYTES = 512_000

type DataHandler = (data: Uint8Array) => void

/**
 * Container exec composable: start/stop/write/resize with requestId handshake.
 * Does not own xterm — caller writes bytes via onData callback.
 */
export function useDockerContainerExec(sessionId: Ref<string | null>) {
  const execState = ref<DockerExecUiState>('idle')
  const execErrorCode = ref<DockerTransportErrorCode | null>(null)
  const terminalId = ref<string | null>(null)
  const shell = ref<DockerExecShell>('bash')
  const exitCode = ref<number | null>(null)
  const activeContainerId = ref<string | null>(null)
  const active = ref(false)
  /** True when start returned ok and state is attached. */
  const live = ref(false)

  let unsubData: (() => void) | null = null
  let unsubState: (() => void) | null = null
  let disposed = false
  let startGeneration = 0
  let currentTerminalId: string | null = null
  let currentRequestId: string | null = null
  let pendingEarly: PendingEarly | null = null
  let ownerSession: string | null = null
  let dataHandler: DataHandler | null = null
  let lastCols = 0
  let lastRows = 0
  /**
   * terminalIds that were stopped immediately after a pending-overflow flush.
   * Late data/state events for these must not override the output-overflow
   * error already shown to the UI.
   */
  const overflowTerminated = new Set<string>()

  function resetLocal(): void {
    execState.value = 'idle'
    execErrorCode.value = null
    terminalId.value = null
    currentTerminalId = null
    currentRequestId = null
    pendingEarly = null
    exitCode.value = null
    live.value = false
    lastCols = 0
    lastRows = 0
    overflowTerminated.clear()
  }

  function applyState(
    state: DockerExecState,
    code?: DockerTransportErrorCode | null,
    nextExit?: number | null,
  ): void {
    execState.value = state
    if (state === 'error' && code) {
      execErrorCode.value = code
    }
    if (state === 'attached') {
      live.value = true
    }
    if (state === 'ended' || state === 'disconnected' || state === 'error') {
      live.value = false
    }
    if (nextExit !== undefined && nextExit !== null) {
      exitCode.value = nextExit
    }
  }

  function acceptEvent(payload: { terminalId?: string | null; requestId?: string }): boolean {
    if (disposed) return false
    if (!payload) return false
    const rid = payload.requestId
    // Reject events for terminals we already stopped due to pending overflow.
    if (payload.terminalId && overflowTerminated.has(payload.terminalId)) return false
    if (currentTerminalId && payload.terminalId === currentTerminalId) return true
    if (currentRequestId && rid === currentRequestId) return true
    if (pendingEarly && rid === pendingEarly.requestId) return true
    return false
  }

  function bufferEarlyData(requestId: string, data: ArrayBuffer): void {
    if (!pendingEarly || pendingEarly.requestId !== requestId) return
    // Already overflowed: do not accept more bytes (no truncation, no re-buffering).
    if (pendingEarly.overflowed) return
    pendingEarly.chunks.push(data)
    pendingEarly.chunkBytes += data.byteLength
    if (pendingEarly.chunkBytes > EARLY_MAX_BYTES) {
      // Hard limit reached: mark overflow, drop ALL pending bytes (no partial flush),
      // and immediately surface a stable output-overflow error. The late success
      // terminalId will be stopped in flushPendingEarly without flushing bytes.
      pendingEarly.overflowed = true
      pendingEarly.chunks = []
      pendingEarly.chunkBytes = 0
      pendingEarly.state = 'error'
      pendingEarly.code = 'output-overflow'
      applyState('error', 'output-overflow')
    }
  }

  function flushPendingEarly(requestId: string, tid: string): void {
    if (!pendingEarly || pendingEarly.requestId !== requestId) return
    const early = pendingEarly
    pendingEarly = null
    currentTerminalId = tid
    currentRequestId = requestId
    terminalId.value = tid
    if (early.overflowed) {
      // Do NOT flush truncated bytes to the data handler (would corrupt UTF-8/ANSI).
      // The start Promise resolved ok, but we already declared output-overflow.
      // Register the terminalId so late data/state events are rejected, then
      // immediately stop it. Keep the error state; clear currentTerminalId so a
      // fresh start can proceed without matching stale events.
      overflowTerminated.add(tid)
      currentTerminalId = null
      currentRequestId = null
      terminalId.value = null
      live.value = false
      void stopLateOverflowedTerminal(tid)
      return
    }
    for (const ab of early.chunks) {
      dataHandler?.(new Uint8Array(ab))
    }
    if (early.state) {
      applyState(early.state as DockerExecState, early.code, early.exitCode)
    }
  }

  async function stopLateOverflowedTerminal(tid: string): Promise<void> {
    if (typeof window === 'undefined' || !window.LiteConnect?.dockerStopContainerExec) return
    try {
      await window.LiteConnect.dockerStopContainerExec(tid)
    } catch {
      // idempotent
    }
  }

  async function stopExec(): Promise<void> {
    const tid = currentTerminalId
    currentTerminalId = null
    currentRequestId = null
    pendingEarly = null
    terminalId.value = null
    live.value = false
    if (tid && typeof window !== 'undefined' && window.LiteConnect?.dockerStopContainerExec) {
      try {
        await window.LiteConnect.dockerStopContainerExec(tid)
      } catch {
        // idempotent
      }
    }
  }

  async function startForContainer(
    containerId: string,
    nextShell: DockerExecShell,
    cols: number,
    rows: number,
  ): Promise<void> {
    if (disposed) return
    const sid = sessionId.value
    if (!sid || !containerId) {
      await stopExec()
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
    shell.value = nextShell

    await stopExec()
    if (disposed || gen !== startGeneration) return

    execState.value = 'connecting'
    execErrorCode.value = null
    exitCode.value = null
    live.value = false
    lastCols = 0
    lastRows = 0

    if (!window.LiteConnect?.dockerStartContainerExec) {
      execState.value = 'error'
      execErrorCode.value = 'request-failed'
      return
    }

    const requestId = createDockerExecRequestId()
    currentRequestId = requestId
    pendingEarly = {
      requestId,
      chunks: [],
      chunkBytes: 0,
      state: null,
      code: null,
      exitCode: undefined,
      overflowed: false,
    }

    const res = await window.LiteConnect.dockerStartContainerExec(sid, containerId, {
      shell: nextShell,
      requestId,
      cols,
      rows,
    })

    if (disposed || gen !== startGeneration || ownerSession !== sessionId.value) {
      pendingEarly = null
      currentRequestId = null
      if (res.ok) {
        try {
          await window.LiteConnect.dockerStopContainerExec(res.terminalId)
        } catch {}
      }
      return
    }

    if (!res.ok) {
      // If pending already overflowed, the output-overflow error must win
      // (it is the more specific resource-limit state). Do not override it.
      const overflowed = pendingEarly?.overflowed === true
      pendingEarly = null
      currentRequestId = null
      currentTerminalId = null
      terminalId.value = null
      if (!overflowed) {
        execState.value = 'error'
        execErrorCode.value = res.code
      }
      live.value = false
      return
    }

    lastCols = cols
    lastRows = rows
    flushPendingEarly(requestId, res.terminalId)
  }

  function ensureSubscribed(): void {
    if (unsubData || typeof window === 'undefined' || !window.LiteConnect) return
    unsubData = window.LiteConnect.onDockerContainerExecData((payload) => {
      if (!acceptEvent(payload)) return
      const rid = payload.requestId
      if (pendingEarly && rid === pendingEarly.requestId && !currentTerminalId) {
        bufferEarlyData(rid, payload.data)
        return
      }
      if (!payload.data) return
      dataHandler?.(new Uint8Array(payload.data))
    })
    unsubState = window.LiteConnect.onDockerContainerExecState((payload) => {
      if (!acceptEvent(payload)) return
      const rid = payload.requestId
      if (pendingEarly && rid === pendingEarly.requestId && !currentTerminalId) {
        // Once overflowed, do not let later attached/ended events override the
        // stable output-overflow error.
        if (pendingEarly.overflowed) return
        pendingEarly.state = payload.state
        if (payload.state === 'error' && payload.code) {
          pendingEarly.code = payload.code as DockerTransportErrorCode
        }
        if (payload.exitCode !== undefined) {
          pendingEarly.exitCode = payload.exitCode
        }
        return
      }
      applyState(
        payload.state,
        payload.code as DockerTransportErrorCode | undefined,
        payload.exitCode,
      )
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
    void stopExec()
    unsubscribeAll()
    pendingEarly = null
    dataHandler = null
  }

  function setDataHandler(handler: DataHandler | null): void {
    dataHandler = handler
  }

  /** Write keyboard/paste input only when live terminalId is active. */
  function writeInput(data: string): void {
    if (!live.value || !currentTerminalId) return
    if (execState.value !== 'attached') return
    if (!window.LiteConnect?.dockerWriteContainerExec) return
    void window.LiteConnect.dockerWriteContainerExec(currentTerminalId, data)
  }

  function resize(cols: number, rows: number): void {
    if (!currentTerminalId || !live.value) return
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) return
    if (cols < 1 || rows < 1 || cols > 1000 || rows > 1000) return
    if (cols === lastCols && rows === lastRows) return
    lastCols = cols
    lastRows = rows
    if (!window.LiteConnect?.dockerResizeContainerExec) return
    void window.LiteConnect.dockerResizeContainerExec(currentTerminalId, cols, rows)
  }

  async function activate(
    containerId: string,
    opts?: { shell?: DockerExecShell; cols?: number; rows?: number },
  ): Promise<void> {
    ensureSubscribed()
    const nextShell = opts?.shell && isDockerExecShell(opts.shell) ? opts.shell : 'bash'
    const cols = opts?.cols && opts.cols > 0 ? opts.cols : 80
    const rows = opts?.rows && opts.rows > 0 ? opts.rows : 24
    await startForContainer(containerId, nextShell, cols, rows)
  }

  async function deactivate(): Promise<void> {
    startGeneration += 1
    active.value = false
    await stopExec()
    activeContainerId.value = null
    execState.value = 'idle'
    execErrorCode.value = null
    live.value = false
  }

  /** User-triggered retry with /bin/sh after bash failure. */
  async function retryWithSh(cols: number, rows: number): Promise<void> {
    if (!activeContainerId.value) return
    await startForContainer(activeContainerId.value, 'sh', cols, rows)
  }

  /** User-triggered retry with same shell (or bash default). */
  async function retry(cols: number, rows: number): Promise<void> {
    if (!activeContainerId.value) return
    const next = shell.value === 'sh' ? 'sh' : 'bash'
    await startForContainer(activeContainerId.value, next, cols, rows)
  }

  watch(sessionId, (next, prev) => {
    if (next === prev) return
    startGeneration += 1
    void stopExec().then(() => {
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
    execState,
    execErrorCode,
    terminalId,
    shell,
    exitCode,
    activeContainerId,
    active,
    live,
    activate,
    deactivate,
    retry,
    retryWithSh,
    writeInput,
    resize,
    setDataHandler,
    stopExec,
    dispose,
    dockerExecStateI18nKey,
  }
}
