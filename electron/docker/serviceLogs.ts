import { randomBytes } from 'crypto'
import type { WebContents } from 'electron'
import {
  buildContainerLogsPath,
  buildInspectContainerPath,
  isValidDockerContainerId,
  isValidDockerLogFollow,
  isValidDockerLogTail,
  readContainerTtyFromInspect,
} from './containers'
import { startDockerLogHttpStream } from './logStream'
import {
  CHANNEL_LOG_DATA,
  CHANNEL_LOG_STATE,
  type DockerServiceContext,
  type OwnedLogStream,
  logOwnerKey,
} from './serviceContext'
import { isValidDockerLogRequestId, isValidDockerLogStreamId } from './serviceIds'
import { dockerHttpRequest } from './transport'
import {
  DOCKER_LOG_BATCH_FLUSH_MS,
  DOCKER_LOG_MAIN_QUEUE_MAX_CHARS,
  DOCKER_LOG_MAIN_QUEUE_MAX_ENTRIES,
  DockerTransportError,
  type DockerContainerLogDataEvent,
  type DockerContainerLogStateEvent,
  type DockerLogEntry,
  type DockerLogStreamOptionsWithRequest,
  type DockerLogStreamState,
  type DockerTransportErrorCode,
} from './types'
import { safeWebContentsSend } from '../utils/validation'

/**
 * Start container log stream for a renderer owner.
 * requestId (renderer) correlates events before streamId is returned from IPC.
 * Returns unpredictable streamId only after ownership is registered.
 * Re-start for same owner/session/container stops the previous stream first.
 */
export async function startContainerLogs(
  ctx: DockerServiceContext,
  owner: WebContents,
  sessionId: string,
  containerId: string,
  options: DockerLogStreamOptionsWithRequest,
): Promise<string> {
  if (!isValidDockerContainerId(containerId)) {
    throw new DockerTransportError('request-failed', 'Invalid container id', sessionId)
  }
  if (!isValidDockerLogTail(options.tail) || !isValidDockerLogFollow(options.follow)) {
    throw new DockerTransportError('request-failed', 'Invalid log options', sessionId)
  }
  if (!isValidDockerLogRequestId(options.requestId)) {
    throw new DockerTransportError('request-failed', 'Invalid log request id', sessionId)
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

  const ownerKey = logOwnerKey(owner, sessionId, containerId)
  const prevId = ctx.logOwnerIndex.get(ownerKey)
  if (prevId) {
    stopContainerLogs(ctx, owner, prevId)
  }

  const streamId = randomBytes(16).toString('hex')
  const requestId = options.requestId
  const owned: OwnedLogStream = {
    streamId,
    requestId,
    sessionId,
    generation,
    containerId,
    owner,
    handle: null,
    closed: false,
    finalStateSent: false,
    queue: [],
    queueChars: 0,
    pendingDroppedFromMain: 0,
    batchTimer: null,
    destroyedListener: null,
  }
  ctx.logStreams.set(streamId, owned)
  ctx.logOwnerIndex.set(ownerKey, streamId)

  const onDestroyed = () => {
    stopContainerLogsInternal(ctx, streamId, 'disconnected', undefined, false)
  }
  owned.destroyedListener = onDestroyed
  try {
    owner.once('destroyed', onDestroyed)
  } catch {
    cleanupLogOwnership(ctx, owned)
    throw new DockerTransportError('request-failed', 'Renderer destroyed', sessionId)
  }

  try {
    const endpoint = await ctx.ensureTransport(sessionId)
    if (
      owned.closed ||
      endpoint.generation !== generation ||
      !ctx.isGenerationLive(sessionId, generation)
    ) {
      cleanupLogOwnership(ctx, owned)
      throw new DockerTransportError(
        'generation-stale',
        'SSH session generation changed',
        sessionId,
      )
    }

    // Determine TTY from inspect (trusted); default non-TTY multiplex if inspect fails with not-found later.
    let tty = false
    try {
      const inspectPath = buildInspectContainerPath(containerId)
      const inspectRes = await dockerHttpRequest(endpoint, 'GET', inspectPath, {
        isLive: () => ctx.isEndpointLive(sessionId, generation) && !owned.closed,
        timeoutMs: 15_000,
      })
      if (owned.closed || !ctx.isGenerationLive(sessionId, generation)) {
        cleanupLogOwnership(ctx, owned)
        throw new DockerTransportError(
          'generation-stale',
          'SSH session generation changed',
          sessionId,
        )
      }
      if (inspectRes.statusCode === 404) {
        cleanupLogOwnership(ctx, owned)
        throw new DockerTransportError(
          'container-not-found',
          `Docker HTTP ${inspectRes.statusCode}`,
          sessionId,
        )
      }
      if (inspectRes.statusCode < 200 || inspectRes.statusCode >= 300) {
        cleanupLogOwnership(ctx, owned)
        if (inspectRes.statusCode === 401 || inspectRes.statusCode === 403) {
          throw new DockerTransportError(
            'permission-denied',
            `Docker HTTP ${inspectRes.statusCode}`,
            sessionId,
          )
        }
        throw new DockerTransportError(
          'request-failed',
          `Docker HTTP ${inspectRes.statusCode}`,
          sessionId,
        )
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(inspectRes.body.toString('utf8'))
      } catch {
        cleanupLogOwnership(ctx, owned)
        throw new DockerTransportError(
          'request-failed',
          'Invalid JSON from Docker inspect',
          sessionId,
        )
      }
      tty = readContainerTtyFromInspect(parsed)
    } catch (err) {
      if (owned.closed) {
        throw new DockerTransportError(
          'generation-stale',
          'SSH session generation changed',
          sessionId,
        )
      }
      throw ctx.wrap(err, sessionId)
    }

    if (owned.closed || !ctx.isGenerationLive(sessionId, generation)) {
      cleanupLogOwnership(ctx, owned)
      throw new DockerTransportError(
        'generation-stale',
        'SSH session generation changed',
        sessionId,
      )
    }

    const apiPath = buildContainerLogsPath(containerId, options.tail, options.follow)
    const handle = startDockerLogHttpStream({
      endpoint,
      apiPath,
      tty,
      isLive: () =>
        !owned.closed &&
        ctx.isGenerationLive(sessionId, generation) &&
        ctx.isEndpointLive(sessionId, generation),
      callbacks: {
        onEntries: (entries) => {
          if (owned.closed || ctx.logStreams.get(streamId) !== owned) return
          if (!ctx.isGenerationLive(sessionId, generation)) return
          enqueueLogEntries(ctx, owned, entries)
        },
        onState: (state, code) => {
          if (ctx.logStreams.get(streamId) !== owned) return
          emitLogState(ctx, owned, state, code)
          if (
            state === 'ended' ||
            state === 'disconnected' ||
            state === 'error'
          ) {
            finalizeLogStream(ctx, owned)
          }
        },
      },
    })
    owned.handle = handle
    return streamId
  } catch (err) {
    cleanupLogOwnership(ctx, owned)
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
 * Stop a log stream. Idempotent. Only the owning webContents may stop.
 * Returns true if streamId was known (or already gone after prior stop).
 */
export function stopContainerLogs(
  ctx: DockerServiceContext,
  owner: WebContents,
  streamId: string,
): boolean {
  if (!isValidDockerLogStreamId(streamId)) return false
  const owned = ctx.logStreams.get(streamId)
  if (!owned) return true
  if (owned.owner !== owner) return false
  stopContainerLogsInternal(ctx, streamId, 'stopped', undefined, true)
  return true
}

export function enqueueLogEntries(
  ctx: DockerServiceContext,
  owned: OwnedLogStream,
  entries: DockerLogEntry[],
): void {
  for (const e of entries) {
    const chars = e.text.length + (e.timestamp?.length || 0)
    owned.queue.push(e)
    owned.queueChars += chars
  }
  // Bound main-side queue: drop oldest and count for UI
  while (
    owned.queue.length > DOCKER_LOG_MAIN_QUEUE_MAX_ENTRIES ||
    owned.queueChars > DOCKER_LOG_MAIN_QUEUE_MAX_CHARS
  ) {
    const dropped = owned.queue.shift()
    if (!dropped) break
    owned.queueChars -= dropped.text.length + (dropped.timestamp?.length || 0)
    if (owned.queueChars < 0) owned.queueChars = 0
    owned.pendingDroppedFromMain += 1
  }
  if (!owned.batchTimer) {
    owned.batchTimer = setTimeout(() => {
      owned.batchTimer = null
      flushLogQueue(owned)
    }, DOCKER_LOG_BATCH_FLUSH_MS)
  }
}

export function flushLogQueue(owned: OwnedLogStream): void {
  if (!owned.queue.length && owned.pendingDroppedFromMain === 0) return
  // Allow final flush even if generation just changed so dropped delta is reported once.
  const entries = owned.queue
  const droppedFromMain = owned.pendingDroppedFromMain
  owned.queue = []
  owned.queueChars = 0
  owned.pendingDroppedFromMain = 0
  const payload: DockerContainerLogDataEvent = {
    streamId: owned.streamId,
    requestId: owned.requestId,
    entries,
    droppedFromMain,
  }
  try {
    safeWebContentsSend(owned.owner, CHANNEL_LOG_DATA, payload)
  } catch {}
}

export function emitLogState(
  ctx: DockerServiceContext,
  owned: OwnedLogStream,
  state: DockerLogStreamState,
  code?: DockerTransportErrorCode,
): void {
  if (owned.finalStateSent && state !== 'connecting' && state !== 'streaming') {
    return
  }
  if (state === 'ended' || state === 'disconnected' || state === 'error') {
    // Flush pending lines + dropped delta before final state
    if (owned.batchTimer) {
      clearTimeout(owned.batchTimer)
      owned.batchTimer = null
    }
    flushLogQueue(owned)
    owned.finalStateSent = true
  }
  if (ctx.logStreams.get(owned.streamId) !== owned && state !== 'connecting') {
    if (state !== 'streaming' && !owned.finalStateSent) return
  }
  if (!ctx.isGenerationLive(owned.sessionId, owned.generation)) {
    if (state === 'connecting' || state === 'streaming') return
  }
  const payload: DockerContainerLogStateEvent = {
    streamId: owned.streamId,
    requestId: owned.requestId,
    state,
    ...(code ? { code } : {}),
  }
  try {
    safeWebContentsSend(owned.owner, CHANNEL_LOG_STATE, payload)
  } catch {}
}

export function finalizeLogStream(ctx: DockerServiceContext, owned: OwnedLogStream): void {
  if (owned.closed) {
    cleanupLogOwnership(ctx, owned)
    return
  }
  owned.closed = true
  if (owned.batchTimer) {
    clearTimeout(owned.batchTimer)
    owned.batchTimer = null
  }
  detachDestroyedListener(owned)
  ctx.logStreams.delete(owned.streamId)
  const key = logOwnerKey(owned.owner, owned.sessionId, owned.containerId)
  if (ctx.logOwnerIndex.get(key) === owned.streamId) {
    ctx.logOwnerIndex.delete(key)
  }
}

export function stopContainerLogsInternal(
  ctx: DockerServiceContext,
  streamId: string,
  reason: 'stopped' | 'disconnected',
  code: DockerTransportErrorCode | undefined,
  notify: boolean,
): void {
  const owned = ctx.logStreams.get(streamId)
  if (!owned) return
  if (owned.closed) {
    cleanupLogOwnership(ctx, owned)
    return
  }
  owned.closed = true
  if (owned.batchTimer) {
    clearTimeout(owned.batchTimer)
    owned.batchTimer = null
  }
  try {
    owned.handle?.destroy(reason, code)
  } catch {}
  owned.handle = null
  if (notify && !owned.finalStateSent) {
    // destroy() may already emit state; if handle was null, emit once
    emitLogState(ctx, owned, 'disconnected', code)
  }
  cleanupLogOwnership(ctx, owned)
}

export function cleanupLogOwnership(ctx: DockerServiceContext, owned: OwnedLogStream): void {
  owned.closed = true
  if (owned.batchTimer) {
    clearTimeout(owned.batchTimer)
    owned.batchTimer = null
  }
  try {
    owned.handle?.destroy('stopped')
  } catch {}
  owned.handle = null
  detachDestroyedListener(owned)
  ctx.logStreams.delete(owned.streamId)
  const key = logOwnerKey(owned.owner, owned.sessionId, owned.containerId)
  if (ctx.logOwnerIndex.get(key) === owned.streamId) {
    ctx.logOwnerIndex.delete(key)
  }
}

export function detachDestroyedListener(owned: OwnedLogStream): void {
  if (!owned.destroyedListener) return
  try {
    owned.owner.removeListener('destroyed', owned.destroyedListener)
  } catch {}
  owned.destroyedListener = null
}

export function stopLogStreamsForSession(
  ctx: DockerServiceContext,
  sessionId: string,
  reason: 'stopped' | 'disconnected',
  code?: DockerTransportErrorCode,
): void {
  for (const [id, owned] of [...ctx.logStreams.entries()]) {
    if (owned.sessionId === sessionId) {
      stopContainerLogsInternal(ctx, id, reason, code, true)
    }
  }
}
