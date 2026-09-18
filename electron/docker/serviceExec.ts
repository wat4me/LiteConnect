import { randomBytes } from 'crypto'
import type { WebContents } from 'electron'
import {
  buildCreateContainerExecBody,
  buildCreateContainerExecPath,
  buildInspectExecPath,
  buildResizeExecPath,
  buildStartExecBody,
  buildStartExecPath,
  isValidDockerContainerId,
  isValidDockerExecShell,
  isValidDockerExecSize,
  normalizeCreateExecResponse,
  normalizeExecInspect,
} from './containers'
import { startDockerExecAttachStream } from './execStream'
import {
  CHANNEL_EXEC_DATA,
  CHANNEL_EXEC_STATE,
  type DockerServiceContext,
  type OwnedExecTerminal,
} from './serviceContext'
import {
  isValidDockerExecRequestId,
  isValidDockerExecTerminalId,
} from './serviceIds'
import { dockerHttpRequest } from './transport'
import {
  DOCKER_EXEC_BATCH_FLUSH_MS,
  DOCKER_EXEC_INPUT_QUEUE_MAX_BYTES,
  DOCKER_EXEC_OUTPUT_QUEUE_MAX_BYTES,
  DOCKER_EXEC_RESIZE_TIMEOUT_MS,
  DOCKER_EXEC_WRITE_MAX_BYTES,
  DockerTransportError,
  type DockerExecDataEvent,
  type DockerExecStartOptions,
  type DockerExecState,
  type DockerExecStateEvent,
  type DockerTransportErrorCode,
} from './types'
import { safeWebContentsSend } from '../utils/validation'
export async function startContainerExec(
  ctx: DockerServiceContext,
  owner: WebContents,
  sessionId: string,
  containerId: string,
  options: DockerExecStartOptions,
): Promise<string> {
  if (!isValidDockerContainerId(containerId)) {
    throw new DockerTransportError('request-failed', 'Invalid container id', sessionId)
  }
  if (!isValidDockerExecShell(options.shell)) {
    throw new DockerTransportError('request-failed', 'Invalid exec shell', sessionId)
  }
  if (!isValidDockerExecRequestId(options.requestId)) {
    throw new DockerTransportError('request-failed', 'Invalid exec request id', sessionId)
  }
  if (!isValidDockerExecSize(options.cols) || !isValidDockerExecSize(options.rows)) {
    throw new DockerTransportError('request-failed', 'Invalid exec size', sessionId)
  }
  if (owner.isDestroyed()) {
    throw new DockerTransportError('request-failed', 'Renderer destroyed', sessionId)
  }
  if (!ctx.opener.hasSession(sessionId)) {
    throw new DockerTransportError('ssh-disconnected', 'SSH session not connected', sessionId)
  }
  const generation = ctx.opener.getSessionGeneration(sessionId)
  if (!ctx.isGenerationLive(sessionId, generation)) {
    throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
  }

  // Same owner: at most one active exec (logs use separate maps).
  const prevId = ctx.execOwnerIndex.get(owner.id)
  if (prevId) {
    stopContainerExec(ctx, owner, prevId)
  }

  const terminalId = randomBytes(16).toString('hex')
  const requestId = options.requestId
  const owned: OwnedExecTerminal = {
    terminalId,
    requestId,
    sessionId,
    generation,
    containerId,
    daemonExecId: '',
    shell: options.shell,
    owner,
    handle: null,
    closed: false,
    finalStateSent: false,
    sequence: 0,
    outQueue: [],
    outQueueBytes: 0,
    batchTimer: null,
    lastCols: 0,
    lastRows: 0,
    inQueueBytes: 0,
    destroyedListener: null,
  }
  ctx.execTerminals.set(terminalId, owned)
  ctx.execOwnerIndex.set(owner.id, terminalId)

  const onDestroyed = () => {
    stopContainerExecInternal(ctx, terminalId, 'disconnected', undefined, false)
  }
  owned.destroyedListener = onDestroyed
  try {
    owner.once('destroyed', onDestroyed)
  } catch {
    cleanupExecOwnership(ctx, owned)
    throw new DockerTransportError('request-failed', 'Renderer destroyed', sessionId)
  }

  try {
    const endpoint = await ctx.ensureTransport(sessionId)
    if (
      owned.closed ||
      endpoint.generation !== generation ||
      !ctx.isGenerationLive(sessionId, generation)
    ) {
      cleanupExecOwnership(ctx, owned)
      throw new DockerTransportError(
        'generation-stale',
        'SSH session generation changed',
        sessionId,
      )
    }

    // Create exec
    const createPath = buildCreateContainerExecPath(containerId)
    const createBody = buildCreateContainerExecBody(options.shell)
    let createRes: { statusCode: number; body: Buffer }
    try {
      createRes = await dockerHttpRequest(endpoint, 'POST', createPath, {
        body: createBody,
        headers: { 'Content-Type': 'application/json' },
        isLive: () => ctx.isEndpointLive(sessionId, generation) && !owned.closed,
        timeoutMs: 15_000,
      })
    } catch (err) {
      cleanupExecOwnership(ctx, owned)
      throw ctx.wrap(err, sessionId)
    }

    if (owned.closed || !ctx.isGenerationLive(sessionId, generation)) {
      cleanupExecOwnership(ctx, owned)
      throw new DockerTransportError(
        'generation-stale',
        'SSH session generation changed',
        sessionId,
      )
    }

    if (createRes.statusCode < 200 || createRes.statusCode >= 300) {
      cleanupExecOwnership(ctx, owned)
      if (createRes.statusCode === 404) {
        throw new DockerTransportError(
          'container-not-found',
          `Docker HTTP ${createRes.statusCode}`,
          sessionId,
        )
      }
      if (createRes.statusCode === 409) {
        throw new DockerTransportError(
          'container-not-running',
          `Docker HTTP ${createRes.statusCode}`,
          sessionId,
        )
      }
      if (createRes.statusCode === 401 || createRes.statusCode === 403) {
        throw new DockerTransportError(
          'permission-denied',
          `Docker HTTP ${createRes.statusCode}`,
          sessionId,
        )
      }
      throw new DockerTransportError(
        'request-failed',
        `Docker HTTP ${createRes.statusCode}`,
        sessionId,
      )
    }

    let daemonExecId: string
    try {
      const parsed = JSON.parse(createRes.body.toString('utf8'))
      daemonExecId = normalizeCreateExecResponse(parsed)
    } catch {
      cleanupExecOwnership(ctx, owned)
      throw new DockerTransportError(
        'request-failed',
        'Invalid create exec response',
        sessionId,
      )
    }
    owned.daemonExecId = daemonExecId

    if (owned.closed || !ctx.isGenerationLive(sessionId, generation)) {
      cleanupExecOwnership(ctx, owned)
      throw new DockerTransportError(
        'generation-stale',
        'SSH session generation changed',
        sessionId,
      )
    }

    const startPath = buildStartExecPath(daemonExecId)
    const startBody = buildStartExecBody()
    const handle = startDockerExecAttachStream({
      endpoint,
      apiPath: startPath,
      body: startBody,
      isLive: () =>
        !owned.closed &&
        ctx.isGenerationLive(sessionId, generation) &&
        ctx.isEndpointLive(sessionId, generation),
      callbacks: {
        onData: (chunk) => {
          if (owned.closed || ctx.execTerminals.get(terminalId) !== owned) return
          if (!ctx.isGenerationLive(sessionId, generation)) return
          enqueueExecData(ctx, owned, chunk)
        },
        onState: (state, code) => {
          if (ctx.execTerminals.get(terminalId) !== owned) return
          if (state === 'ended') {
            void onExecStreamFinal(ctx, owned, state, code)
            return
          }
          emitExecState(ctx, owned, state, code)
          if (state === 'disconnected' || state === 'error') {
            finalizeExecTerminal(ctx, owned)
          }
        },
      },
    })
    owned.handle = handle

    // Initial resize after attach path registered (best-effort; may race attach).
    void resizeContainerExec(ctx, owner, terminalId, options.cols, options.rows)

    return terminalId
  } catch (err) {
    cleanupExecOwnership(ctx, owned)
    if (!ctx.isGenerationLive(sessionId, generation)) {
      throw new DockerTransportError(
        'generation-stale',
        'SSH session generation changed',
        sessionId,
      )
    }
    throw ctx.wrap(err, sessionId)
  }
}

/**
 * Write input to an attached exec. Owner + terminalId required.
 * Does not parse as shell; raw bytes only. Hard size limit per write.
 */
export function writeContainerExec(
  ctx: DockerServiceContext,
  owner: WebContents,
  terminalId: string,
  data: string | Buffer,
): boolean {
  if (!isValidDockerExecTerminalId(terminalId)) return false
  const owned = ctx.execTerminals.get(terminalId)
  if (!owned || owned.closed) return false
  if (owned.owner !== owner) return false
  if (!ctx.isGenerationLive(owned.sessionId, owned.generation)) return false
  if (!owned.handle) return false

  let buf: Buffer
  if (typeof data === 'string') {
    buf = Buffer.from(data, 'utf8')
  } else if (Buffer.isBuffer(data)) {
    buf = data
  } else {
    return false
  }
  if (buf.length === 0) return true
  if (buf.length > DOCKER_EXEC_WRITE_MAX_BYTES) return false
  if (owned.inQueueBytes + buf.length > DOCKER_EXEC_INPUT_QUEUE_MAX_BYTES) {
    stopContainerExecInternal(ctx, terminalId, 'error', 'output-overflow', true)
    return false
  }
  owned.inQueueBytes += buf.length
  const ok = owned.handle.write(buf)
  // Approximate: assume socket drains; subtract after write attempt.
  owned.inQueueBytes = Math.max(0, owned.inQueueBytes - buf.length)
  if (!ok && owned.handle.pendingWriteBytes() > DOCKER_EXEC_INPUT_QUEUE_MAX_BYTES) {
    stopContainerExecInternal(ctx, terminalId, 'error', 'output-overflow', true)
    return false
  }
  return true
}

/**
 * Resize exec TTY. Validates size in main; dedupes identical dims; rejects stale terminal.
 */
export async function resizeContainerExec(
  ctx: DockerServiceContext,
  owner: WebContents,
  terminalId: string,
  cols: number,
  rows: number,
): Promise<boolean> {
  if (!isValidDockerExecTerminalId(terminalId)) return false
  if (!isValidDockerExecSize(cols) || !isValidDockerExecSize(rows)) return false
  const owned = ctx.execTerminals.get(terminalId)
  if (!owned || owned.closed) return false
  if (owned.owner !== owner) return false
  if (!ctx.isGenerationLive(owned.sessionId, owned.generation)) return false
  if (!owned.daemonExecId) return false
  if (owned.lastCols === cols && owned.lastRows === rows) return true

  try {
    const endpoint = await ctx.ensureTransport(owned.sessionId)
    if (
      owned.closed ||
      ctx.execTerminals.get(terminalId) !== owned ||
      endpoint.generation !== owned.generation ||
      !ctx.isGenerationLive(owned.sessionId, owned.generation)
    ) {
      return false
    }
    const apiPath = buildResizeExecPath(owned.daemonExecId, rows, cols)
    const res = await dockerHttpRequest(endpoint, 'POST', apiPath, {
      isLive: () =>
        !owned.closed &&
        ctx.execTerminals.get(terminalId) === owned &&
        ctx.isEndpointLive(owned.sessionId, owned.generation),
      timeoutMs: DOCKER_EXEC_RESIZE_TIMEOUT_MS,
    })
    if (owned.closed || ctx.execTerminals.get(terminalId) !== owned) return false
    if (res.statusCode >= 200 && res.statusCode < 300) {
      owned.lastCols = cols
      owned.lastRows = rows
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Stop exec attach. Idempotent. Only owning webContents may stop.
 * Closes attach socket only 闂?never container stop/kill.
 */
export function stopContainerExec(
  ctx: DockerServiceContext,
  owner: WebContents,
  terminalId: string,
): boolean {
  if (!isValidDockerExecTerminalId(terminalId)) return false
  const owned = ctx.execTerminals.get(terminalId)
  if (!owned) return true
  if (owned.owner !== owner) return false
  stopContainerExecInternal(ctx, terminalId, 'stopped', undefined, true)
  return true
}

export function enqueueExecData(ctx: DockerServiceContext, owned: OwnedExecTerminal, chunk: Buffer): void {
  if (!chunk.length) return
  owned.outQueue.push(chunk)
  owned.outQueueBytes += chunk.length
  if (owned.outQueueBytes > DOCKER_EXEC_OUTPUT_QUEUE_MAX_BYTES) {
    stopContainerExecInternal(ctx, owned.terminalId, 'error', 'output-overflow', true)
    return
  }
  if (!owned.batchTimer) {
    owned.batchTimer = setTimeout(() => {
      owned.batchTimer = null
      flushExecQueue(ctx, owned)
    }, DOCKER_EXEC_BATCH_FLUSH_MS)
  }
}

export function flushExecQueue(ctx: DockerServiceContext, owned: OwnedExecTerminal): void {
  if (!owned.outQueue.length) return
  const parts = owned.outQueue
  owned.outQueue = []
  owned.outQueueBytes = 0
  const merged = parts.length === 1 ? parts[0] : Buffer.concat(parts)
  owned.sequence += 1
  // Copy into ArrayBuffer for structured clone over IPC (raw bytes).
  const ab = merged.buffer.slice(
    merged.byteOffset,
    merged.byteOffset + merged.byteLength,
  ) as ArrayBuffer
  const payload: DockerExecDataEvent = {
    requestId: owned.requestId,
    terminalId: owned.terminalId,
    sequence: owned.sequence,
    data: ab,
  }
  try {
    safeWebContentsSend(owned.owner, CHANNEL_EXEC_DATA, payload)
  } catch {}
}

export function emitExecState(
  ctx: DockerServiceContext,
  owned: OwnedExecTerminal,
  state: DockerExecState,
  code?: DockerTransportErrorCode,
  exitCode?: number | null,
): void {
  if (owned.finalStateSent && state !== 'connecting' && state !== 'attached') {
    return
  }
  if (state === 'ended' || state === 'disconnected' || state === 'error') {
    if (owned.batchTimer) {
      clearTimeout(owned.batchTimer)
      owned.batchTimer = null
    }
    flushExecQueue(ctx, owned)
    owned.finalStateSent = true
  }
  if (!ctx.isGenerationLive(owned.sessionId, owned.generation)) {
    if (state === 'connecting' || state === 'attached') return
  }
  const payload: DockerExecStateEvent = {
    requestId: owned.requestId,
    terminalId: owned.terminalId,
    state,
    ...(code ? { code } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  }
  try {
    safeWebContentsSend(owned.owner, CHANNEL_EXEC_STATE, payload)
  } catch {}
}

export async function onExecStreamFinal(
  ctx: DockerServiceContext,
  owned: OwnedExecTerminal,
  state: DockerExecState,
  code?: DockerTransportErrorCode,
): Promise<void> {
  let exitCode: number | null | undefined
  if (
    state === 'ended' &&
    owned.daemonExecId &&
    !owned.closed &&
    ctx.isGenerationLive(owned.sessionId, owned.generation)
  ) {
    try {
      const endpoint = ctx.transport.getActiveEndpoint(owned.sessionId)
      if (endpoint && endpoint.generation === owned.generation) {
        const path = buildInspectExecPath(owned.daemonExecId)
        const res = await dockerHttpRequest(endpoint, 'GET', path, {
          isLive: () => ctx.isEndpointLive(owned.sessionId, owned.generation),
          timeoutMs: 5_000,
        })
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const summary = normalizeExecInspect(JSON.parse(res.body.toString('utf8')))
            exitCode = summary.exitCode
          } catch {
            // ignore inspect parse failures
          }
        }
      }
    } catch {
      // Inspect failure must not resurrect the stream.
    }
  }
  if (!owned.finalStateSent) {
    emitExecState(ctx, owned, state, code, exitCode)
  }
  finalizeExecTerminal(ctx, owned)
}

export function finalizeExecTerminal(ctx: DockerServiceContext, owned: OwnedExecTerminal): void {
  if (owned.closed) {
    cleanupExecOwnership(ctx, owned)
    return
  }
  owned.closed = true
  if (owned.batchTimer) {
    clearTimeout(owned.batchTimer)
    owned.batchTimer = null
  }
  detachExecDestroyedListener(owned)
  ctx.execTerminals.delete(owned.terminalId)
  if (ctx.execOwnerIndex.get(owned.owner.id) === owned.terminalId) {
    ctx.execOwnerIndex.delete(owned.owner.id)
  }
}

export function stopContainerExecInternal(
  ctx: DockerServiceContext,
  terminalId: string,
  reason: 'stopped' | 'disconnected' | 'error',
  code: DockerTransportErrorCode | undefined,
  notify: boolean,
): void {
  const owned = ctx.execTerminals.get(terminalId)
  if (!owned) return
  if (owned.closed) {
    cleanupExecOwnership(ctx, owned)
    return
  }
  owned.closed = true
  if (owned.batchTimer) {
    clearTimeout(owned.batchTimer)
    owned.batchTimer = null
  }
  try {
    if (reason === 'error') {
      owned.handle?.destroy('error', code)
    } else if (reason === 'disconnected') {
      owned.handle?.destroy('disconnected', code)
    } else {
      owned.handle?.destroy('stopped')
    }
  } catch {}
  owned.handle = null
  if (notify && !owned.finalStateSent) {
    if (reason === 'error') {
      emitExecState(ctx, owned, 'error', code || 'request-failed')
    } else {
      emitExecState(ctx, owned, 'disconnected', code)
    }
  }
  cleanupExecOwnership(ctx, owned)
}

export function cleanupExecOwnership(ctx: DockerServiceContext, owned: OwnedExecTerminal): void {
  owned.closed = true
  if (owned.batchTimer) {
    clearTimeout(owned.batchTimer)
    owned.batchTimer = null
  }
  try {
    owned.handle?.destroy('stopped')
  } catch {}
  owned.handle = null
  detachExecDestroyedListener(owned)
  ctx.execTerminals.delete(owned.terminalId)
  if (ctx.execOwnerIndex.get(owned.owner.id) === owned.terminalId) {
    ctx.execOwnerIndex.delete(owned.owner.id)
  }
}

export function detachExecDestroyedListener(owned: OwnedExecTerminal): void {
  if (!owned.destroyedListener) return
  try {
    owned.owner.removeListener('destroyed', owned.destroyedListener)
  } catch {}
  owned.destroyedListener = null
}

export function stopExecTerminalsForSession(
  ctx: DockerServiceContext,
  sessionId: string,
  reason: 'stopped' | 'disconnected',
  code?: DockerTransportErrorCode,
): void {
  for (const [id, owned] of [...ctx.execTerminals.entries()]) {
    if (owned.sessionId === sessionId) {
      stopContainerExecInternal(ctx, id, reason, code, true)
    }
  }
}
