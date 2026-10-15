export {
  sanitizeTrackedCwd,
  sshToolSystemAddendum,
  sshToolsForChat,
} from '../../../shared/aiSidebarPrompt'


/** Sidebar chat: always pin tools to the bound SSH session. MCP HTTP still requires the caller to pass sessionId. */
export function bindSessionArgs(args: unknown, sessionId: string): Record<string, unknown> {
  const next =
    args && typeof args === 'object' && !Array.isArray(args) ? { ...(args as Record<string, unknown>) } : {}
  if (sessionId) {
    next.sessionId = sessionId
    delete next.sessionIds
    delete next.group
    delete next.connectMissing
  }
  return next
}

export function parseToolCallArguments(raw: string): unknown {
  const text = raw.trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { command: text }
  }
}

export function looksLikeToolsUnsupported(message: string): boolean {
  const m = message.toLowerCase()
  return (
    /\btools?\b/.test(m) &&
    /not support|unsupported|unknown field|invalid|does not exist|not allowed|unrecognized/.test(m)
  )
}
