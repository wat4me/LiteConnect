export type SshTestFailureStage =
  | 'tcp'
  | 'ssh_handshake'
  | 'host_key'
  | 'auth'
  | 'jump'
  | 'shell'
  | string
  | undefined

/** Convert ssh2/Node transport details into stable, user-facing i18n messages. */
export function sshTestErrorKey(
  message?: string | null,
  stage?: SshTestFailureStage,
): string | null {
  const normalized = (message || '').toLowerCase()

  if (stage === 'auth') return 'connections.testErrorAuth'
  if (normalized.includes('enotfound') || normalized.includes('getaddrinfo')) {
    return 'connections.testErrorDns'
  }
  if (normalized.includes('econnrefused') || normalized.includes('connection refused')) {
    return 'connections.testErrorRefused'
  }
  if (
    normalized.includes('ehostunreach') ||
    normalized.includes('enetunreach') ||
    normalized.includes('no route to host')
  ) {
    return 'connections.testErrorUnreachable'
  }
  if (
    normalized.includes('timed out') ||
    normalized.includes('timeout') ||
    normalized.includes('etimedout')
  ) {
    return stage === 'tcp'
      ? 'connections.testErrorTcpTimeout'
      : 'connections.testErrorHandshakeTimeout'
  }
  if (stage === 'jump') return 'connections.testErrorJump'
  if (stage === 'shell') return 'connections.testErrorShell'
  return null
}
