import { appendFile } from 'fs/promises'

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

export function createMcpAuditLog(filePath: string): (event: McpAuditEvent) => void {
  return (event) => {
    const line = `${JSON.stringify({ ...event, ts: event.ts || Date.now() })}\n`
    void appendFile(filePath, line, 'utf8').catch(() => {})
  }
}
