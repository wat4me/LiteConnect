import {
  buildContainerActionPath,
  buildInspectContainerPath,
  DOCKER_LIST_CONTAINERS_PATH,
  isValidDockerContainerAction,
  isValidDockerContainerId,
  normalizeContainerInspect,
  normalizeContainerList,
} from './containers'
import type { DockerServiceContext } from './serviceContext'
import { actionKey } from './serviceContext'
import { dockerHttpRequest } from './transport'
import {
  DOCKER_ACTION_HTTP_TIMEOUT_MS,
  DockerTransportError,
  type DockerContainerAction,
  type DockerContainerActionResult,
  type DockerContainerInspectResult,
  type DockerContainerSummary,
} from './types'

export async function listContainers(
  ctx: DockerServiceContext,
  sessionId: string,
): Promise<DockerContainerSummary[]> {
  if (!ctx.opener.hasSession(sessionId)) {
    throw new DockerTransportError('ssh-disconnected', 'SSH session not connected', sessionId)
  }
  const generation = ctx.opener.getSessionGeneration(sessionId)
  if (!ctx.isGenerationLive(sessionId, generation)) {
    throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
  }

  try {
    const endpoint = await ctx.ensureTransport(sessionId)
    if (endpoint.generation !== generation || !ctx.isGenerationLive(sessionId, generation)) {
      throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
    }

    const res = await dockerHttpRequest(endpoint, 'GET', DOCKER_LIST_CONTAINERS_PATH, {
      isLive: () => ctx.isEndpointLive(sessionId, generation),
      timeoutMs: 30_000,
    })

    if (!ctx.isGenerationLive(sessionId, generation) || !ctx.isEndpointLive(sessionId, generation)) {
      throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new DockerTransportError(
        'request-failed',
        `Docker list containers HTTP ${res.statusCode}`,
        sessionId,
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(res.body.toString('utf8'))
    } catch {
      // Do not log body (may contain labels/env-adjacent data).
      throw new DockerTransportError(
        'request-failed',
        'Invalid JSON from Docker containers list',
        sessionId,
      )
    }

    const list = normalizeContainerList(parsed)
    if (!ctx.isGenerationLive(sessionId, generation)) {
      throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
    }
    return list
  } catch (err) {
    if (!ctx.isGenerationLive(sessionId, generation)) {
      throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
    }
    throw ctx.wrap(err, sessionId)
  }
}

export async function inspectContainer(
  ctx: DockerServiceContext,
  sessionId: string,
  containerId: string,
): Promise<DockerContainerInspectResult> {
  if (!isValidDockerContainerId(containerId)) {
    throw new DockerTransportError('request-failed', 'Invalid container id', sessionId)
  }
  if (!ctx.opener.hasSession(sessionId)) {
    throw new DockerTransportError('ssh-disconnected', 'SSH session not connected', sessionId)
  }
  const generation = ctx.opener.getSessionGeneration(sessionId)
  if (!ctx.isGenerationLive(sessionId, generation)) {
    throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
  }

  const apiPath = buildInspectContainerPath(containerId)

  try {
    const endpoint = await ctx.ensureTransport(sessionId)
    if (endpoint.generation !== generation || !ctx.isGenerationLive(sessionId, generation)) {
      throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
    }

    const res = await dockerHttpRequest(endpoint, 'GET', apiPath, {
      isLive: () => ctx.isEndpointLive(sessionId, generation),
      timeoutMs: 30_000,
    })

    if (!ctx.isGenerationLive(sessionId, generation) || !ctx.isEndpointLive(sessionId, generation)) {
      throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new DockerTransportError(
        'request-failed',
        `Docker inspect HTTP ${res.statusCode}`,
        sessionId,
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(res.body.toString('utf8'))
    } catch {
      throw new DockerTransportError(
        'request-failed',
        'Invalid JSON from Docker inspect',
        sessionId,
      )
    }

    let result: DockerContainerInspectResult
    try {
      result = normalizeContainerInspect(parsed)
    } catch {
      throw new DockerTransportError(
        'request-failed',
        'Invalid Docker inspect payload',
        sessionId,
      )
    }

    if (!ctx.isGenerationLive(sessionId, generation)) {
      throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
    }
    return result
  } catch (err) {
    if (!ctx.isGenerationLive(sessionId, generation)) {
      throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
    }
    throw ctx.wrap(err, sessionId)
  }
}

/**
 * Whitelist container lifecycle action (start | stop | restart).
 * Paths/method/timeout constructed only in main; renderer passes action enum only.
 * In-flight keyed by session+generation+containerId:
 * - same action → share promise (one HTTP)
 * - different action → stable action-conflict (no second HTTP, never return first action result)
 */
export async function containerAction(
  ctx: DockerServiceContext,
  sessionId: string,
  containerId: string,
  action: DockerContainerAction,
): Promise<DockerContainerActionResult> {
  if (!isValidDockerContainerId(containerId)) {
    throw new DockerTransportError('request-failed', 'Invalid container id', sessionId)
  }
  if (!isValidDockerContainerAction(action)) {
    throw new DockerTransportError('request-failed', 'Invalid container action', sessionId)
  }
  if (!ctx.opener.hasSession(sessionId)) {
    throw new DockerTransportError('ssh-disconnected', 'SSH session not connected', sessionId)
  }
  const generation = ctx.opener.getSessionGeneration(sessionId)
  if (!ctx.isGenerationLive(sessionId, generation)) {
    throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
  }

  const key = actionKey(sessionId, generation, containerId)
  const existing = ctx.actionInflight.get(key)
  if (existing) {
    if (existing.action === action) return existing.promise
    throw new DockerTransportError(
      'action-conflict',
      'Container action already in progress',
      sessionId,
    )
  }

  const promise = runContainerAction(ctx, sessionId, generation, containerId, action).finally(
    () => {
      const cur = ctx.actionInflight.get(key)
      if (cur && cur.promise === promise) {
        ctx.actionInflight.delete(key)
      }
    },
  )
  ctx.actionInflight.set(key, { action, promise })
  return promise
}

export async function runContainerAction(
  ctx: DockerServiceContext,
  sessionId: string,
  generation: number,
  containerId: string,
  action: DockerContainerAction,
): Promise<DockerContainerActionResult> {
  if (!ctx.isGenerationLive(sessionId, generation)) {
    throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
  }

  const apiPath = buildContainerActionPath(action, containerId)

  try {
    const endpoint = await ctx.ensureTransport(sessionId)
    if (endpoint.generation !== generation || !ctx.isGenerationLive(sessionId, generation)) {
      throw new DockerTransportError(
        'generation-stale',
        'SSH session generation changed',
        sessionId,
      )
    }

    const res = await dockerHttpRequest(endpoint, 'POST', apiPath, {
      isLive: () => ctx.isEndpointLive(sessionId, generation),
      timeoutMs: DOCKER_ACTION_HTTP_TIMEOUT_MS,
    })

    // Never treat late HTTP success as UI success after disconnect/generation bump.
    if (!ctx.isGenerationLive(sessionId, generation) || !ctx.isEndpointLive(sessionId, generation)) {
      throw new DockerTransportError(
        'generation-stale',
        'SSH session generation changed',
        sessionId,
      )
    }

    if (res.statusCode === 204 || (res.statusCode >= 200 && res.statusCode < 300 && res.statusCode !== 304)) {
      return { action, containerId, outcome: 'completed' }
    }
    if (res.statusCode === 304) {
      return { action, containerId, outcome: 'already-in-state' }
    }
    // resolveHttpStatus should have thrown for 4xx; belt-and-suspenders without body logging.
    if (res.statusCode === 404) {
      throw new DockerTransportError('container-not-found', `Docker HTTP ${res.statusCode}`, sessionId)
    }
    if (res.statusCode === 409) {
      throw new DockerTransportError('action-conflict', `Docker HTTP ${res.statusCode}`, sessionId)
    }
    if (res.statusCode === 401 || res.statusCode === 403) {
      throw new DockerTransportError('permission-denied', `Docker HTTP ${res.statusCode}`, sessionId)
    }
    throw new DockerTransportError('request-failed', `Docker HTTP ${res.statusCode}`, sessionId)
  } catch (err) {
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

export function clearActionInflightForSession(
  ctx: DockerServiceContext,
  sessionId: string,
): void {
  const prefix = `${sessionId}:`
  for (const key of [...ctx.actionInflight.keys()]) {
    if (key.startsWith(prefix)) {
      ctx.actionInflight.delete(key)
    }
  }
}
