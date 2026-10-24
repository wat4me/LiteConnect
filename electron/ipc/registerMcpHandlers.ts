import { BrowserWindow } from 'electron'
import { ServiceIpcScope } from './serviceScope'
import { sanitizeMcpHttpPort } from '../../shared/mcp/limits'
import { sanitizeMcpApprovalMode } from '../../shared/mcp/policy'
import { completeRendererConnect } from '../mcp/connectBridge'
import type { McpHttpGateway } from '../mcp/httpGateway'
import type { SshMcpRuntime } from '../mcp/runtime'
import { isValidUUID } from '../utils/validation'

export function registerMcpHandlers(runtime: SshMcpRuntime, httpGateway?: McpHttpGateway, scope = new ServiceIpcScope()): void {
  scope.handle('mcp:listTools', async () => runtime.listTools())
  scope.handle('mcp:listJobs', () => runtime.listJobs())
  runtime.onJobsChanged(() => {
    const jobs = runtime.listJobs()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('mcp:jobsChanged', jobs)
    }
  })
  scope.handle('mcp:callTool', async (_event, name: unknown, args: unknown) => runtime.call(name, args, { signal: scope.signal }))

  scope.handle('mcp:getHttpStatus', async () => {
    if (!httpGateway) throw new Error('MCP HTTP gateway is not configured')
    const status = httpGateway.getStatus()
    if (!status.token) {
      await httpGateway.rotateToken()
      return httpGateway.getStatus()
    }
    return status
  })

  scope.handle('mcp:setHttpEnabled', async (_event, enabled: unknown) => {
    if (!httpGateway) throw new Error('MCP HTTP gateway is not configured')
    if (typeof enabled !== 'boolean') throw new Error('Invalid value')
    return await httpGateway.setEnabled(enabled)
  })

  scope.handle('mcp:setHttpPort', async (_event, port: unknown) => {
    if (!httpGateway) throw new Error('MCP HTTP gateway is not configured')
    return await httpGateway.setPort(sanitizeMcpHttpPort(port))
  })

  scope.handle('mcp:rotateHttpToken', async () => {
    if (!httpGateway) throw new Error('MCP HTTP gateway is not configured')
    return await httpGateway.rotateToken()
  })

  scope.handle('mcp:setApprovalMode', async (_event, mode: unknown) => {
    if (!httpGateway) throw new Error('MCP HTTP gateway is not configured')
    return await httpGateway.setApprovalMode(sanitizeMcpApprovalMode(mode))
  })

  scope.handle(
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
