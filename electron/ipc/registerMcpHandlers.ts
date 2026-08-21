import { ipcMain } from 'electron'
import { sanitizeMcpHttpPort } from '../../shared/mcp/limits'
import { completeRendererConnect } from '../mcp/connectBridge'
import type { McpHttpGateway } from '../mcp/httpGateway'
import type { SshMcpRuntime } from '../mcp/runtime'
import { isValidUUID } from '../utils/validation'

export function registerMcpHandlers(runtime: SshMcpRuntime, httpGateway?: McpHttpGateway): void {
  ipcMain.handle('mcp:listTools', async () => runtime.listTools())
  ipcMain.handle('mcp:callTool', async (_event, name: unknown, args: unknown) => runtime.call(name, args))

  ipcMain.handle('mcp:getHttpStatus', async () => {
    if (!httpGateway) throw new Error('MCP HTTP gateway is not configured')
    const status = httpGateway.getStatus()
    if (!status.token) {
      await httpGateway.rotateToken()
      return httpGateway.getStatus()
    }
    return status
  })

  ipcMain.handle('mcp:setHttpEnabled', async (_event, enabled: unknown) => {
    if (!httpGateway) throw new Error('MCP HTTP gateway is not configured')
    if (typeof enabled !== 'boolean') throw new Error('Invalid value')
    return await httpGateway.setEnabled(enabled)
  })

  ipcMain.handle('mcp:setHttpPort', async (_event, port: unknown) => {
    if (!httpGateway) throw new Error('MCP HTTP gateway is not configured')
    return await httpGateway.setPort(sanitizeMcpHttpPort(port))
  })

  ipcMain.handle('mcp:rotateHttpToken', async () => {
    if (!httpGateway) throw new Error('MCP HTTP gateway is not configured')
    return await httpGateway.rotateToken()
  })

  ipcMain.handle(
    'mcp:connectResult',
    async (_event, requestId: unknown, result: { sessionId?: string; error?: string }) => {
      if (typeof requestId !== 'string' || !requestId) return false
      const sessionId =
        typeof result?.sessionId === 'string' && isValidUUID(result.sessionId) ? result.sessionId : undefined
      const error = typeof result?.error === 'string' ? result.error : undefined
      return completeRendererConnect(requestId, { sessionId, error })
    },
  )
}
