import type { SshMcpToolErrorCode } from '../../shared/mcp/types'

export class ToolError extends Error {
  code: SshMcpToolErrorCode
  constructor(code: SshMcpToolErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export function toolError(code: SshMcpToolErrorCode, message: string): ToolError {
  return new ToolError(code, message)
}

export function mapThrown(err: unknown): { code: SshMcpToolErrorCode; message: string } | null {
  if (err instanceof ToolError) return { code: err.code, message: err.message }
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: string }).code
    if (
      code === 'PTY_NOT_FOUND' ||
      code === 'PTY_CLOSED' ||
      code === 'PTY_LIMIT' ||
      code === 'INVALID_ARGUMENTS'
    ) {
      return { code, message: err instanceof Error ? err.message : String(err) }
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (/generation changed/i.test(message)) return { code: 'SESSION_STALE', message }
  if (/timeout after/i.test(message)) return { code: 'EXEC_TIMEOUT', message }
  if (/cancelled/i.test(message)) return { code: 'EXEC_CANCELLED', message }
  if (/session not found/i.test(message)) return { code: 'SESSION_NOT_FOUND', message }
  if (/too large/i.test(message)) return { code: 'FILE_TOO_LARGE', message }
  return null
}
