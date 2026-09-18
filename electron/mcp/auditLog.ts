import { getAppDatabase } from '../store/appDatabase'

export type McpAuditEvent = {
  ts: number
  method: string
  tool?: string
  sessionId?: string
  ok: boolean
  code?: string
  class?: string
  commandPreview?: string
}

export function createMcpAuditLog(): (event: McpAuditEvent) => void {
  return (event) => {
    const normalized = { ...event, ts: event.ts || Date.now() }
    try {
      getAppDatabase().appendMcpAudit(normalized, normalized.ts)
    } catch (error) {
      console.error('[MCP Audit] write failed:', error)
    }
  }
}
