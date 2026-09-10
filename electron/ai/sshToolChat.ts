export {
  sanitizeTrackedCwd,
  sshToolSystemAddendum,
  sshToolsForChat,
} from '../../shared/aiSidebarPrompt'

export const MAX_SSH_TOOL_ROUNDS = 8

export type AccumulatedToolCall = {
  id: string
  name: string
  arguments: string
}

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

export function accumulateToolCallDeltas(acc: Map<number, AccumulatedToolCall>, deltas: unknown): void {
  if (!Array.isArray(deltas)) return
  for (const raw of deltas) {
    if (!raw || typeof raw !== 'object') continue
    const d = raw as {
      index?: number
      id?: string
      function?: { name?: string; arguments?: string }
    }
    const idx = typeof d.index === 'number' ? d.index : acc.size
    const cur = acc.get(idx) || { id: '', name: '', arguments: '' }
    if (typeof d.id === 'string' && d.id) cur.id = d.id
    if (typeof d.function?.name === 'string') cur.name += d.function.name
    if (typeof d.function?.arguments === 'string') cur.arguments += d.function.arguments
    acc.set(idx, cur)
  }
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
