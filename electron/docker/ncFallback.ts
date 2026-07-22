import { DockerTransportError, DOCKER_SOCKET_PATH } from './types'

/** Fixed absolute nc client command — never accepts renderer/session input. */
export const DOCKER_NC_EXEC_COMMAND = `exec /usr/bin/nc -U ${DOCKER_SOCKET_PATH}` as const

/** Diagnostics only (main/tests). Not required for renderer. */
export type DockerSocketTransportMode = 'streamlocal' | 'exec-nc'

/** Max stderr bytes retained for internal classification only (never sent to renderer). */
export const DOCKER_NC_STDERR_CLASSIFY_MAX = 256 as const

/**
 * StreamLocal open hang timeout for Docker path only.
 * Some OpenSSH builds never complete channel open (no fail callback) when
 * direct-streamlocal is administratively blocked — without this, probe hits 15s request-timeout
 * and never reaches nc -U fallback.
 */
export const DOCKER_STREAMLOCAL_OPEN_TIMEOUT_MS = 2_500 as const

/** Grace after nc exec open before treating channel as ready (missing nc exits faster). */
export const DOCKER_NC_EXEC_SETTLE_MS = 25 as const

/**
 * Whether a StreamLocal open failure is eligible for fixed nc -U fallback.
 * Session liveness / generation must still be checked by the caller before exec.
 */
export function shouldFallbackToNcExec(err: unknown): boolean {
  if (err instanceof DockerTransportError) {
    return (
      err.code === 'transport-unsupported' ||
      err.code === 'socket-forward-failed'
    )
  }

  const message = err instanceof Error ? err.message : String(err ?? '')
  const lower = message.toLowerCase()
  const code = err && typeof err === 'object' && 'code' in err ? String((err as any).code) : ''

  // Never fallback on auth / session / permission / missing path
  if (
    code === 'EACCES' ||
    code === 'ENOENT' ||
    /permission denied|access denied|eacces|enoent|no such file|not connected|connection (closed|reset|lost)|ssh.*(closed|disconnected)|generation|host key|authentication/i.test(
      lower,
    )
  ) {
    return false
  }

  if (code === 'ENOTSUP') return true

  // API missing / channel type unsupported / admin policy / open hang timeout
  if (
    /not supported|unsupported|unknown channel type|administratively prohibited|openssh.*not available|no streamlocal|streamlocal.*not|forwardoutstreamlocal|streamlocal open timed out|timed out|timeout/i.test(
      message,
    )
  ) {
    return true
  }

  // Channel open failures that may be StreamLocal policy (not auth/session death)
  if (/channel open failure|channel open failed|streamlocal open failed|open failed/i.test(lower)) {
    return true
  }

  return false
}

/**
 * Map fixed nc exec failure (exit/stderr/open) to stable DockerTransportError codes.
 * stderrSnippet must already be truncated; never use raw stderr as UI message.
 */
export function classifyNcExecFailure(
  opts: {
    openError?: unknown
    exitCode?: number | null
    signal?: string | null
    stderrSnippet?: string
    earlyClose?: boolean
  },
  sessionId?: string,
): DockerTransportError {
  if (opts.openError) {
    const msg =
      opts.openError instanceof Error
        ? opts.openError.message
        : String(opts.openError ?? 'exec open failed')
    const lower = msg.toLowerCase()
    if (/not connected|no session|connection (closed|reset|lost)/i.test(lower)) {
      return new DockerTransportError(
        'ssh-disconnected',
        'SSH session not connected',
        sessionId,
      )
    }
    if (/generation/i.test(lower)) {
      return new DockerTransportError(
        'generation-stale',
        'SSH session generation changed',
        sessionId,
      )
    }
    return new DockerTransportError(
      'socket-forward-failed',
      'Docker socket exec channel failed to open',
      sessionId,
    )
  }

  const stderr = (opts.stderrSnippet || '').toLowerCase()
  const exit = opts.exitCode

  // nc missing / not executable / -U unsupported
  if (
    exit === 127 ||
    /command not found|no such file or directory.*nc|not found.*\/usr\/bin\/nc|cannot execute|invalid option|illegal option|unknown option|usage:\s*nc\b|ncat:.*invalid/i.test(
      stderr,
    ) ||
    (/no such file or directory/i.test(stderr) && /\/usr\/bin\/nc|\bnc\b/.test(stderr) && !/docker\.sock/.test(stderr))
  ) {
    return new DockerTransportError(
      'transport-unsupported',
      'Remote nc -U is not available for Docker socket transport',
      sessionId,
    )
  }

  // socket path missing
  if (
    /no such file or directory|enoent|does not exist|cannot open|failed to connect.*no such/i.test(stderr) &&
    (/docker\.sock|unix|socket/i.test(stderr) || exit === 1 || exit === 2)
  ) {
    return new DockerTransportError(
      'socket-not-found',
      'Docker socket not found',
      sessionId,
    )
  }

  if (/permission denied|access denied|eacces|operation not permitted/i.test(stderr)) {
    return new DockerTransportError(
      'permission-denied',
      'Permission denied for Docker socket',
      sessionId,
    )
  }

  if (opts.earlyClose && (exit === null || exit === undefined) && !stderr) {
    return new DockerTransportError(
      'proxy-closed',
      'Docker socket exec channel closed',
      sessionId,
    )
  }

  if (exit !== null && exit !== undefined && exit !== 0) {
    // Generic remote nc failure without leaking stderr
    if (/connection refused|connect failed|could not connect/i.test(stderr)) {
      return new DockerTransportError(
        'socket-forward-failed',
        'Docker socket exec connect failed',
        sessionId,
      )
    }
    return new DockerTransportError(
      'socket-forward-failed',
      'Docker socket exec failed',
      sessionId,
    )
  }

  if (opts.earlyClose) {
    return new DockerTransportError(
      'proxy-closed',
      'Docker socket exec channel closed',
      sessionId,
    )
  }

  return new DockerTransportError(
    'socket-forward-failed',
    'Docker socket exec failed',
    sessionId,
  )
}

/** Truncate stderr for internal classify only. */
export function truncateNcStderr(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  if (b.length <= DOCKER_NC_STDERR_CLASSIFY_MAX) return b.toString('utf8')
  return b.subarray(0, DOCKER_NC_STDERR_CLASSIFY_MAX).toString('utf8')
}
