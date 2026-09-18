import {
  DOCKER_CONTAINER_ID_MAX_LEN,
  DOCKER_CONTAINER_ID_RE,
  DOCKER_DAEMON_EXEC_ID_MAX_LEN,
  DOCKER_DAEMON_EXEC_ID_RE,
  DOCKER_EXEC_RESIZE_MAX,
  DOCKER_EXEC_RESIZE_MIN,
  DOCKER_LOG_TAILS,
  DOCKER_STOP_TIMEOUT_SEC,
  type DockerContainerAction,
  type DockerContainerInspectResult,
  type DockerContainerMount,
  type DockerContainerOverview,
  type DockerContainerPort,
  type DockerContainerSummary,
  type DockerExecShell,
  type DockerLogTail,
} from './types'

/** Validate container id/name for fixed API path construction (renderer must not pass paths). */
export function isValidDockerContainerId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= DOCKER_CONTAINER_ID_MAX_LEN &&
    DOCKER_CONTAINER_ID_RE.test(id)
  )
}

/** Fixed list path — always all=true; filtering is renderer-side for MVP-004. */
export const DOCKER_LIST_CONTAINERS_PATH = '/containers/json?all=true' as const

/** Percent-encoded container id segment after validation. */
function encodeContainerIdSegment(containerId: string): string {
  if (!isValidDockerContainerId(containerId)) {
    throw new Error('Invalid container id')
  }
  return encodeURIComponent(containerId)
}

/** Build inspect path only after validation; encode for URL safety. */
export function buildInspectContainerPath(containerId: string): string {
  return `/containers/${encodeContainerIdSegment(containerId)}/json`
}

/** POST start — no query; path fixed in main process. */
export function buildStartContainerPath(containerId: string): string {
  return `/containers/${encodeContainerIdSegment(containerId)}/start`
}

/** POST stop with fixed main-process timeout seconds. */
export function buildStopContainerPath(containerId: string): string {
  return `/containers/${encodeContainerIdSegment(containerId)}/stop?t=${DOCKER_STOP_TIMEOUT_SEC}`
}

/** POST restart with fixed main-process timeout seconds. */
export function buildRestartContainerPath(containerId: string): string {
  return `/containers/${encodeContainerIdSegment(containerId)}/restart?t=${DOCKER_STOP_TIMEOUT_SEC}`
}

/** Build fixed action path (method is always POST for these). */
export function buildContainerActionPath(
  action: DockerContainerAction,
  containerId: string,
): string {
  if (action === 'start') return buildStartContainerPath(containerId)
  if (action === 'stop') return buildStopContainerPath(containerId)
  if (action === 'restart') return buildRestartContainerPath(containerId)
  throw new Error('Invalid container action')
}

export function isValidDockerContainerAction(action: unknown): action is DockerContainerAction {
  return action === 'start' || action === 'stop' || action === 'restart'
}

/** Tail must be one of the fixed enum values (not arbitrary numbers). */
export function isValidDockerLogTail(tail: unknown): tail is DockerLogTail {
  return (
    typeof tail === 'number' &&
    Number.isInteger(tail) &&
    (DOCKER_LOG_TAILS as readonly number[]).includes(tail)
  )
}

export function isValidDockerLogFollow(follow: unknown): follow is boolean {
  return typeof follow === 'boolean'
}

/**
 * Fixed logs path: query names/order/values constructed only in main.
 * GET /containers/{id}/logs?stdout=1&stderr=1&timestamps=0&tail={enum}&follow={0|1}
 * timestamps=0 matches default `docker logs` (no RFC3339Nano line prefixes).
 */
export function buildContainerLogsPath(
  containerId: string,
  tail: DockerLogTail,
  follow: boolean,
): string {
  if (!isValidDockerContainerId(containerId)) {
    throw new Error('Invalid container id')
  }
  if (!isValidDockerLogTail(tail)) {
    throw new Error('Invalid log tail')
  }
  if (!isValidDockerLogFollow(follow)) {
    throw new Error('Invalid log follow')
  }
  const id = encodeContainerIdSegment(containerId)
  const f = follow ? '1' : '0'
  return `/containers/${id}/logs?stdout=1&stderr=1&timestamps=0&tail=${tail}&follow=${f}`
}

const ENCODED_ID = '[A-Za-z0-9%_.~-]{1,200}'
/**
 * Container id segment as produced by the validator+builder for exec paths.
 * Strictly equivalent to DOCKER_CONTAINER_ID_RE: first char [a-zA-Z0-9],
 * followed by up to 127 of [a-zA-Z0-9_.-]. Rejects `%`, encoded slash,
 * leading `.`/`_`/`-`, `..`, `.name`, `-name`, `_name`, and >128 chars.
 */
const EXEC_CONTAINER_ID = '[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}'
/** Daemon exec id segment: 8..64 lowercase hex only (no `%`, no uppercase). */
const EXEC_ID = '[a-f0-9]{8,64}'
/** Integer 1..1000 (no leading zeros, no 0, no 1001+). */
const SIZE_DIM = '(?:[1-9][0-9]{0,2}|1000)'
const RE_INSPECT = new RegExp(`^/containers/${ENCODED_ID}/json$`)
const RE_START = new RegExp(`^/containers/${ENCODED_ID}/start$`)
const RE_STOP = new RegExp(`^/containers/${ENCODED_ID}/stop\\?t=${DOCKER_STOP_TIMEOUT_SEC}$`)
const RE_RESTART = new RegExp(`^/containers/${ENCODED_ID}/restart\\?t=${DOCKER_STOP_TIMEOUT_SEC}$`)
const RE_LOGS = new RegExp(
  `^/containers/${ENCODED_ID}/logs\\?stdout=1&stderr=1&timestamps=0&tail=(100|200|500|1000)&follow=[01]$`,
)
const RE_CREATE_EXEC = new RegExp(`^/containers/${EXEC_CONTAINER_ID}/exec$`)
const RE_EXEC_START = new RegExp(`^/exec/${EXEC_ID}/start$`)
const RE_EXEC_RESIZE = new RegExp(`^/exec/${EXEC_ID}/resize\\?h=${SIZE_DIM}&w=${SIZE_DIM}$`)
const RE_EXEC_INSPECT = new RegExp(`^/exec/${EXEC_ID}/json$`)

/**
 * Allow only main-process-constructed Docker Engine method+path pairs.
 * Renderer never supplies method, path, query, or timeout.
 */
export function isAllowedDockerApiRequest(method: string, apiPath: string): boolean {
  if (!apiPath.startsWith('/') || apiPath.includes('..') || apiPath.includes('\\') || apiPath.includes('\0')) {
    return false
  }
  const m = method.toUpperCase()
  if (m === 'GET') {
    if (apiPath === '/_ping' || apiPath === '/version') return true
    if (apiPath === DOCKER_LIST_CONTAINERS_PATH) return true
    if (RE_INSPECT.test(apiPath)) return true
    if (RE_LOGS.test(apiPath)) return true
    if (RE_EXEC_INSPECT.test(apiPath)) return true
    return false
  }
  if (m === 'POST') {
    if (RE_START.test(apiPath)) return true
    if (RE_STOP.test(apiPath)) return true
    if (RE_RESTART.test(apiPath)) return true
    if (RE_CREATE_EXEC.test(apiPath)) return true
    if (RE_EXEC_START.test(apiPath)) return true
    if (RE_EXEC_RESIZE.test(apiPath)) return true
    return false
  }
  return false
}

/** Validate daemon exec id (main-only; never trust renderer as auth token). */
export function isValidDockerDaemonExecId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= DOCKER_DAEMON_EXEC_ID_MAX_LEN &&
    DOCKER_DAEMON_EXEC_ID_RE.test(id)
  )
}

export function isValidDockerExecShell(shell: unknown): shell is DockerExecShell {
  return shell === 'bash' || shell === 'sh'
}

/** Map shell enum to fixed absolute path (never accept free-form strings). */
export function dockerExecShellCmd(shell: DockerExecShell): ['/bin/bash'] | ['/bin/sh'] {
  if (shell === 'sh') return ['/bin/sh']
  return ['/bin/bash']
}

function encodeDaemonExecIdSegment(execId: string): string {
  if (!isValidDockerDaemonExecId(execId)) {
    throw new Error('Invalid daemon exec id')
  }
  return encodeURIComponent(execId)
}

/** POST /containers/{id}/exec — body constructed separately. */
export function buildCreateContainerExecPath(containerId: string): string {
  return `/containers/${encodeContainerIdSegment(containerId)}/exec`
}

/**
 * Fixed create-exec JSON body. Only shell enum selects Cmd; Privileged always false.
 * Omits User/Env/WorkingDir/DetachKeys.
 */
export function buildCreateContainerExecBody(shell: DockerExecShell): string {
  if (!isValidDockerExecShell(shell)) {
    throw new Error('Invalid exec shell')
  }
  return JSON.stringify({
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Privileged: false,
    Cmd: dockerExecShellCmd(shell),
  })
}

/** POST /exec/{id}/start — body fixed. */
export function buildStartExecPath(daemonExecId: string): string {
  return `/exec/${encodeDaemonExecIdSegment(daemonExecId)}/start`
}

export function buildStartExecBody(): string {
  return JSON.stringify({ Detach: false, Tty: true })
}

/** Validate rows/cols for resize (integers in 1..1000). */
export function isValidDockerExecSize(n: unknown): n is number {
  return (
    typeof n === 'number' &&
    Number.isInteger(n) &&
    n >= DOCKER_EXEC_RESIZE_MIN &&
    n <= DOCKER_EXEC_RESIZE_MAX
  )
}

/**
 * POST /exec/{id}/resize?h={rows}&w={cols}
 * Query names/order fixed: h then w.
 */
export function buildResizeExecPath(
  daemonExecId: string,
  rows: number,
  cols: number,
): string {
  if (!isValidDockerDaemonExecId(daemonExecId)) {
    throw new Error('Invalid daemon exec id')
  }
  if (!isValidDockerExecSize(rows) || !isValidDockerExecSize(cols)) {
    throw new Error('Invalid exec size')
  }
  const id = encodeDaemonExecIdSegment(daemonExecId)
  return `/exec/${id}/resize?h=${rows}&w=${cols}`
}

/** GET /exec/{id}/json */
export function buildInspectExecPath(daemonExecId: string): string {
  return `/exec/${encodeDaemonExecIdSegment(daemonExecId)}/json`
}

/**
 * Normalize create-exec response: only the daemon Id string.
 * Never log or return full raw body to renderer.
 */
export function normalizeCreateExecResponse(raw: unknown): string {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid create exec response')
  }
  const id = (raw as Record<string, unknown>).Id
  if (!isValidDockerDaemonExecId(id)) {
    throw new Error('Invalid daemon exec id in response')
  }
  return id
}

/** Limited exec inspect fields for exit status (main only). */
export type DockerExecInspectSummary = {
  running: boolean
  exitCode: number | null
}

export function normalizeExecInspect(raw: unknown): DockerExecInspectSummary {
  if (!raw || typeof raw !== 'object') {
    return { running: false, exitCode: null }
  }
  const row = raw as Record<string, unknown>
  const running = row.Running === true
  const exitRaw = row.ExitCode
  const exitCode =
    typeof exitRaw === 'number' && Number.isFinite(exitRaw) ? Math.trunc(exitRaw) : null
  return { running, exitCode }
}

/** Read Config.Tty from inspect payload (trusted Docker JSON only). */
export function readContainerTtyFromInspect(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const row = raw as Record<string, unknown>
  const config =
    row.Config && typeof row.Config === 'object' ? (row.Config as Record<string, unknown>) : null
  if (!config) return false
  return config.Tty === true
}

/**
 * Path-only helper (legacy/tests): true if path is allowed for *some* method.
 * Prefer isAllowedDockerApiRequest for enforcement.
 */
export function isAllowedDockerApiPath(apiPath: string): boolean {
  return (
    isAllowedDockerApiRequest('GET', apiPath) || isAllowedDockerApiRequest('POST', apiPath)
  )
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function asBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** Strip Docker name prefix `/` and pick primary display name. */
export function normalizeContainerNames(rawNames: unknown): { names: string[]; displayName: string } {
  const names: string[] = []
  if (Array.isArray(rawNames)) {
    for (const n of rawNames) {
      if (typeof n !== 'string' || !n) continue
      const stripped = n.startsWith('/') ? n.slice(1) : n
      if (stripped) names.push(stripped)
    }
  }
  const displayName = names[0] || ''
  return { names, displayName }
}

export function normalizePorts(raw: unknown): DockerContainerPort[] {
  if (!Array.isArray(raw)) return []
  const out: DockerContainerPort[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const row = p as Record<string, unknown>
    const privatePort = asNumber(row.PrivatePort, 0)
    if (privatePort <= 0) continue
    const publicRaw = row.PublicPort
    const publicPort =
      typeof publicRaw === 'number' && Number.isFinite(publicRaw) && publicRaw > 0
        ? publicRaw
        : null
    out.push({
      ip: asString(row.IP),
      privatePort,
      publicPort,
      type: asString(row.Type, 'tcp') || 'tcp',
    })
  }
  return out
}

export function normalizeMounts(raw: unknown): DockerContainerMount[] {
  if (!Array.isArray(raw)) return []
  const out: DockerContainerMount[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const row = m as Record<string, unknown>
    out.push({
      type: asString(row.Type),
      name: asString(row.Name),
      source: asString(row.Source),
      destination: asString(row.Destination) || asString(row.Target),
      mode: asString(row.Mode),
      rw: asBool(row.RW, true),
    })
  }
  return out
}

/** Normalize one list item from GET /containers/json. */
export function normalizeContainerSummary(raw: unknown): DockerContainerSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = asString(row.Id)
  if (!id) return null
  const { names, displayName } = normalizeContainerNames(row.Names)
  return {
    id,
    names,
    displayName: displayName || id.slice(0, 12),
    image: asString(row.Image),
    imageId: asString(row.ImageID),
    command: asString(row.Command),
    created: asNumber(row.Created, 0),
    state: asString(row.State).toLowerCase() || 'unknown',
    status: asString(row.Status),
    ports: normalizePorts(row.Ports),
    mounts: normalizeMounts(row.Mounts),
  }
}

/** Normalize list body: empty array, single, many; ignore junk entries. */
export function normalizeContainerList(body: unknown): DockerContainerSummary[] {
  if (!Array.isArray(body)) return []
  const out: DockerContainerSummary[] = []
  for (const item of body) {
    const n = normalizeContainerSummary(item)
    if (n) out.push(n)
  }
  return out
}

function networkNamesFromNetworkSettings(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const ns = raw as Record<string, unknown>
  const networks = ns.Networks
  if (!networks || typeof networks !== 'object') return []
  return Object.keys(networks as Record<string, unknown>).filter(Boolean)
}

function portsFromNetworkSettings(raw: unknown): DockerContainerPort[] {
  if (!raw || typeof raw !== 'object') return []
  const ns = raw as Record<string, unknown>
  const ports = ns.Ports
  if (!ports || typeof ports !== 'object') return []
  const out: DockerContainerPort[] = []
  for (const [key, bindings] of Object.entries(ports as Record<string, unknown>)) {
    // key like "80/tcp"
    const m = /^(\d+)\/([a-zA-Z0-9]+)$/.exec(key)
    if (!m) continue
    const privatePort = Number(m[1])
    const type = m[2] || 'tcp'
    if (!Array.isArray(bindings) || bindings.length === 0) {
      out.push({ ip: '', privatePort, publicPort: null, type })
      continue
    }
    for (const b of bindings) {
      if (!b || typeof b !== 'object') {
        out.push({ ip: '', privatePort, publicPort: null, type })
        continue
      }
      const br = b as Record<string, unknown>
      const hp = asString(br.HostPort)
      const publicPort = hp && /^\d+$/.test(hp) ? Number(hp) : null
      out.push({
        ip: asString(br.HostIp),
        privatePort,
        publicPort,
        type,
      })
    }
  }
  return out
}

function mountsFromInspect(raw: unknown): DockerContainerMount[] {
  return normalizeMounts(raw)
}

/** Build structured inspect result; pretty JSON is for UI only (do not log). */
export function normalizeContainerInspect(raw: unknown): DockerContainerInspectResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid inspect payload')
  }
  const row = raw as Record<string, unknown>
  const id = asString(row.Id)
  if (!id) throw new Error('Invalid inspect payload: missing Id')

  const nameRaw = asString(row.Name)
  const displayName = nameRaw.startsWith('/') ? nameRaw.slice(1) : nameRaw
  const stateRaw = row.State && typeof row.State === 'object' ? (row.State as Record<string, unknown>) : {}
  const config = row.Config && typeof row.Config === 'object' ? (row.Config as Record<string, unknown>) : {}
  const hostConfig =
    row.HostConfig && typeof row.HostConfig === 'object' ? (row.HostConfig as Record<string, unknown>) : {}
  const restart =
    hostConfig.RestartPolicy && typeof hostConfig.RestartPolicy === 'object'
      ? (hostConfig.RestartPolicy as Record<string, unknown>)
      : {}

  const exitCodeRaw = stateRaw.ExitCode
  const exitCode =
    typeof exitCodeRaw === 'number' && Number.isFinite(exitCodeRaw) ? exitCodeRaw : null

  const overview: DockerContainerOverview = {
    id,
    name: nameRaw,
    displayName: displayName || id.slice(0, 12),
    image: asString(config.Image) || asString(row.Image),
    imageId: asString(row.Image),
    created: asString(row.Created),
    path: asString(row.Path),
    args: Array.isArray(row.Args)
      ? row.Args.filter((a): a is string => typeof a === 'string')
      : [],
    state: {
      status: asString(stateRaw.Status).toLowerCase() || 'unknown',
      running: asBool(stateRaw.Running),
      paused: asBool(stateRaw.Paused),
      restarting: asBool(stateRaw.Restarting),
      startedAt: asString(stateRaw.StartedAt),
      finishedAt: asString(stateRaw.FinishedAt),
      exitCode,
      error: asString(stateRaw.Error),
    },
    ports: portsFromNetworkSettings(row.NetworkSettings),
    mounts: mountsFromInspect(row.Mounts),
    networks: networkNamesFromNetworkSettings(row.NetworkSettings),
    restartPolicy: asString(restart.Name) || 'no',
  }

  // Pretty print without logging; UI uses this for search/copy only.
  let inspectJson: string
  try {
    inspectJson = JSON.stringify(raw, null, 2)
  } catch {
    inspectJson = '{}'
  }

  return { overview, inspectJson }
}

/** Compact port summary for list rows: "8080→80/tcp, 443/tcp". */
export function formatPortsSummary(ports: DockerContainerPort[]): string {
  if (!ports.length) return ''
  return ports
    .map((p) => {
      if (p.publicPort != null) {
        const host = p.ip && p.ip !== '0.0.0.0' && p.ip !== '::' ? `${p.ip}:` : ''
        return `${host}${p.publicPort}→${p.privatePort}/${p.type}`
      }
      return `${p.privatePort}/${p.type}`
    })
    .join(', ')
}
