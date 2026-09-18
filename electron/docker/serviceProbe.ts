import {
  mapTransportErrorToAvailability,
  resolveSocketNotFound,
} from './availability'
import type { DockerServiceContext } from './serviceContext'
import { probeKey } from './serviceContext'
import { dockerHttpRequest } from './transport'
import {
  DockerTransportError,
  type DockerAvailability,
  type DockerProxyEndpoint,
  type DockerVersionInfo,
} from './types'

/**
 * Docker API 1.23 is the oldest API supporting the list response fields
 * (State, Mounts, ImageID) plus inspect/action/log/exec endpoints used by
 * MVP-001…007. MVP does not use 1.25-only fields such as Exec Env.
 * Keep this main-process-only: the renderer consumes the probe result.
 */
export const DOCKER_MVP_MIN_API_VERSION = '1.23' as const

type ParsedDockerApiVersion = readonly [number, number]

/** Strictly parse Docker's major.minor API version; reject malformed values. */
export function parseDockerApiVersion(value: unknown): ParsedDockerApiVersion | null {
  if (typeof value !== 'string') return null
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value)
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  return Number.isSafeInteger(major) && Number.isSafeInteger(minor) ? [major, minor] : null
}

/** Numeric comparison prevents lexical mistakes such as 1.9 > 1.10. */
export function compareDockerApiVersions(left: string, right: string): number | null {
  const a = parseDockerApiVersion(left)
  const b = parseDockerApiVersion(right)
  if (!a || !b) return null
  return a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]
}

export async function probe(
  ctx: DockerServiceContext,
  sessionId: string,
): Promise<DockerAvailability> {
  if (!ctx.opener.hasSession(sessionId)) {
    return { status: 'ssh-disconnected' }
  }

  const generation = ctx.opener.getSessionGeneration(sessionId)
  const key = probeKey(sessionId, generation)
  const existing = ctx.probeInflight.get(key)
  if (existing) return existing

  const promise = runProbe(ctx, sessionId, generation).finally(() => {
    if (ctx.probeInflight.get(key) === promise) {
      ctx.probeInflight.delete(key)
    }
  })
  ctx.probeInflight.set(key, promise)
  return promise
}

export async function runProbe(
  ctx: DockerServiceContext,
  sessionId: string,
  generation: number,
): Promise<DockerAvailability> {
  if (!ctx.isGenerationLive(sessionId, generation)) {
    return { status: 'ssh-disconnected' }
  }

  try {
    const endpoint = await ctx.ensureTransport(sessionId)
    if (endpoint.generation !== generation || !ctx.isGenerationLive(sessionId, generation)) {
      return { status: 'ssh-disconnected' }
    }

    const pingOk = await pingWithGeneration(ctx, sessionId, endpoint)
    if (!ctx.isGenerationLive(sessionId, generation)) {
      return { status: 'ssh-disconnected' }
    }
    if (!pingOk) {
      return {
        status: 'daemon-unavailable',
        message:
          '已建立 SSH Docker 通道，但 /_ping 未返回 OK。请确认远端 Docker 守护进程正在运行，且 Socket 为 /var/run/docker.sock。',
      }
    }

    const version = await versionWithGeneration(ctx, sessionId, endpoint)
    if (!ctx.isGenerationLive(sessionId, generation)) {
      return { status: 'ssh-disconnected' }
    }

    const engineVersion = typeof version.Version === 'string' ? version.Version : ''
    const apiVersion = typeof version.ApiVersion === 'string' ? version.ApiVersion : ''
    const apiComparison = compareDockerApiVersions(apiVersion, DOCKER_MVP_MIN_API_VERSION)
    // A missing/malformed response is a probe failure, not compatibility evidence.
    // MinAPIVersion is validated when supplied but does not replace ApiVersion:
    // the latter is the daemon's maximum supported API used for this threshold.
    const minApiVersion = version.MinAPIVersion
    const minApiComparison =
      minApiVersion === undefined ? 0 : compareDockerApiVersions(String(minApiVersion), apiVersion)
    if (!engineVersion || apiComparison === null || minApiComparison === null || minApiComparison > 0) {
      return {
        status: 'daemon-unavailable',
        message:
          'Docker /version 响应缺少 Version/ApiVersion 字段，无法确认 Engine 状态。请在服务器上检查 Docker 版本与 API。',
      }
    }

    if (apiComparison < 0) {
      return {
        status: 'api-version-incompatible',
        engineVersion,
        apiVersion,
        requiredApiVersion: DOCKER_MVP_MIN_API_VERSION,
      }
    }

    return {
      status: 'available',
      engineVersion: engineVersion || 'unknown',
      apiVersion: apiVersion || 'unknown',
    }
  } catch (err) {
    if (!ctx.isGenerationLive(sessionId, generation)) {
      return { status: 'ssh-disconnected' }
    }
    const wrapped = ctx.wrap(err, sessionId)
    if (wrapped.code === 'socket-not-found') {
      return resolveMissingSocket(ctx, sessionId, generation)
    }
    return mapTransportErrorToAvailability(wrapped)
  }
}

/**
 * socket-not-found alone is ambiguous (not installed OR daemon stopped).
 * Confirm with generation-bound install check; never misreport not-installed
 * when evidence is missing or the check fails.
 */
export async function resolveMissingSocket(
  ctx: DockerServiceContext,
  sessionId: string,
  generation: number,
): Promise<DockerAvailability> {
  if (!ctx.isGenerationLive(sessionId, generation)) {
    return { status: 'ssh-disconnected' }
  }
  if (!ctx.installChecker) {
    return resolveSocketNotFound('unknown')
  }
  try {
    const presence = await ctx.installChecker.checkDockerInstallation(sessionId, generation)
    if (!ctx.isGenerationLive(sessionId, generation)) {
      return { status: 'ssh-disconnected' }
    }
    return resolveSocketNotFound(presence)
  } catch {
    if (!ctx.isGenerationLive(sessionId, generation)) {
      return { status: 'ssh-disconnected' }
    }
    return resolveSocketNotFound('unknown')
  }
}

export async function ping(ctx: DockerServiceContext, sessionId: string): Promise<boolean> {
  const endpoint = await ctx.ensureTransport(sessionId)
  return pingWithGeneration(ctx, sessionId, endpoint)
}

export async function pingWithGeneration(
  ctx: DockerServiceContext,
  sessionId: string,
  endpoint: DockerProxyEndpoint,
): Promise<boolean> {
  const gen = endpoint.generation
  try {
    const res = await dockerHttpRequest(endpoint, 'GET', '/_ping', {
      isLive: () => ctx.isEndpointLive(sessionId, gen),
    })
    if (!ctx.isEndpointLive(sessionId, gen)) {
      throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
    }
    const body = res.body.toString('utf8').trim()
    return res.statusCode === 200 && (body === 'OK' || body.length === 0 || body === 'ok')
  } catch (err) {
    throw ctx.wrap(err, sessionId)
  }
}

export async function version(
  ctx: DockerServiceContext,
  sessionId: string,
): Promise<DockerVersionInfo> {
  const endpoint = await ctx.ensureTransport(sessionId)
  return versionWithGeneration(ctx, sessionId, endpoint)
}

export async function versionWithGeneration(
  ctx: DockerServiceContext,
  sessionId: string,
  endpoint: DockerProxyEndpoint,
): Promise<DockerVersionInfo> {
  const gen = endpoint.generation
  try {
    const res = await dockerHttpRequest(endpoint, 'GET', '/version', {
      isLive: () => ctx.isEndpointLive(sessionId, gen),
    })
    if (!ctx.isEndpointLive(sessionId, gen)) {
      throw new DockerTransportError('generation-stale', 'SSH session generation changed', sessionId)
    }
    const text = res.body.toString('utf8')
    try {
      return JSON.parse(text) as DockerVersionInfo
    } catch {
      throw new DockerTransportError(
        'request-failed',
        'Invalid JSON from Docker /version',
        sessionId,
      )
    }
  } catch (err) {
    throw ctx.wrap(err, sessionId)
  }
}

export function clearProbeInflightForSession(
  ctx: DockerServiceContext,
  sessionId: string,
): void {
  const prefix = `${sessionId}:`
  for (const key of [...ctx.probeInflight.keys()]) {
    if (key.startsWith(prefix)) {
      ctx.probeInflight.delete(key)
    }
  }
}
