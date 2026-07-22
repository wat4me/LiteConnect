import { DockerTransportError, type DockerTransportErrorCode } from './types'

/**
 * Map ssh2 / OS errors from StreamLocal or Docker HTTP into structured codes.
 * Prefer stable codes over English text matching in UI (UI may still show message).
 */
export function classifyStreamLocalError(
  err: unknown,
  sessionId?: string,
): DockerTransportError {
  if (err instanceof DockerTransportError) return err

  const message = err instanceof Error ? err.message : String(err ?? 'unknown error')
  const lower = message.toLowerCase()
  const code = err && typeof err === 'object' && 'code' in err ? String((err as any).code) : ''

  if (
    /not supported|unsupported|unknown channel type|administratively prohibited|openssh.*not available|no streamlocal|streamlocal.*not/i.test(
      message,
    ) ||
    code === 'ENOTSUP'
  ) {
    return new DockerTransportError(
      'transport-unsupported',
      message || 'SSH StreamLocal forwarding is not supported',
      sessionId,
    )
  }

  if (
    code === 'ENOENT' ||
    /no such file|does not exist|enoent/i.test(lower)
  ) {
    return new DockerTransportError(
      'socket-not-found',
      message || 'Docker socket not found',
      sessionId,
    )
  }

  if (code === 'EACCES' || /permission denied|access denied|eacces/i.test(lower)) {
    return new DockerTransportError(
      'permission-denied',
      message || 'Permission denied for Docker socket',
      sessionId,
    )
  }

  // sshd accepted StreamLocal but failed to connect the remote Unix socket
  // (typical: SELinux, sshd policy, sock path). Distinct from "daemon not running".
  if (
    /connect failed:\s*open failed|open failed:\s*connect failed|direct-streamlocal|streamlocal.*open failed|channel open failed:\s*connect failed|connect_to.*docker\.sock.*failed/i.test(
      lower,
    ) ||
    (/channel open failure|channel open failed|open failed/i.test(lower) &&
      /connect failed|streamlocal|docker\.sock/i.test(lower))
  ) {
    return new DockerTransportError(
      'socket-forward-failed',
      message || 'SSH StreamLocal could not open Docker socket',
      sessionId,
    )
  }

  // Generic "channel open failure: open failed" from ssh2 StreamLocal (OpenSSH wording)
  if (
    /channel open failure|channel open failed|streamlocal open failed|forwardoutstreamlocal/i.test(
      lower,
    )
  ) {
    return new DockerTransportError(
      'socket-forward-failed',
      message || 'SSH StreamLocal could not open Docker socket',
      sessionId,
    )
  }

  if (
    /not connected|connection (closed|reset|lost)|ssh.*(closed|disconnected)|no session/i.test(
      lower,
    )
  ) {
    return new DockerTransportError(
      'ssh-disconnected',
      message || 'SSH session not connected',
      sessionId,
    )
  }

  return new DockerTransportError(
    'daemon-unavailable',
    message || 'Docker daemon unavailable via StreamLocal',
    sessionId,
  )
}

export function isDockerTransportErrorCode(code: string): code is DockerTransportErrorCode {
  return (
    code === 'ssh-disconnected' ||
    code === 'transport-unsupported' ||
    code === 'socket-forward-failed' ||
    code === 'socket-not-found' ||
    code === 'permission-denied' ||
    code === 'daemon-unavailable' ||
    code === 'proxy-closed' ||
    code === 'request-failed' ||
    code === 'request-timeout' ||
    code === 'generation-stale' ||
    code === 'container-not-found' ||
    code === 'action-conflict'
  )
}
