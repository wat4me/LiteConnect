/** Map ssh2 / Node socket messages to a short UI reason. Unknown → null (show raw). */
export function sshDisconnectDetailKey(message?: string | null): string | null {
  const m = (message || '').toLowerCase()
  if (!m.trim()) return null
  if (
    m.includes('keepalive') ||
    m.includes('no response from server') ||
    m.includes('server not responding')
  ) {
    return 'terminal.disconnectedDetailUnresponsive'
  }
  if (m.includes('timed out') || m.includes('timeout') || m.includes('etimedout')) {
    return 'terminal.disconnectedDetailTimeout'
  }
  if (
    m.includes('econnreset') ||
    m.includes('econnaborted') ||
    m.includes('enotconn') ||
    m.includes('ehostunreach') ||
    m.includes('enetunreach') ||
    m.includes('econnrefused') ||
    m.includes('enotfound') ||
    /\bnetwork\b/.test(m)
  ) {
    return 'terminal.disconnectedDetailReset'
  }
  if (
    m.includes('connection closed') ||
    m.includes('connection lost') ||
    m.includes('socket closed') ||
    m.includes('connection reset')
  ) {
    return 'terminal.disconnectedDetailClosed'
  }
  return null
}
