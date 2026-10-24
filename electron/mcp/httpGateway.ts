import { MCP_HTTP_DEFAULT_PORT, sanitizeMcpHttpPort } from '../../shared/mcp/limits'
import { buildMcpClientSnippets, mcpHttpUrl } from './clientConfig'
import { createMcpHttpServer, type McpHttpHandle } from './httpServer'
import type { McpAuditHook, McpServerInfo } from './httpProtocol'
import type { SshMcpRuntime } from './runtime'
import type { ApprovalMode, McpHttpStatus } from '../../shared/mcp/types'
import { sanitizeMcpApprovalMode } from '../../shared/mcp/policy'

export type { McpHttpStatus }

export type McpHttpSettingsPort = {
  getMcpHttpEnabled(): boolean
  getMcpHttpPort(): number
  getMcpHttpToken(): string
  getMcpApprovalMode(): ApprovalMode
  ensureMcpHttpToken(): Promise<string>
  setMcpHttpEnabled(enabled: boolean): Promise<void>
  setMcpHttpPort(port: number): Promise<void>
  setMcpApprovalMode(mode: unknown): Promise<ApprovalMode>
  rotateMcpHttpToken(): Promise<string>
}

export class McpHttpGateway {
  private handle: McpHttpHandle | null = null
  private lastError: string | null = null
  private listeningPort: number | null = null
  private disposed = false
  private generation = 0
  private operations: Promise<unknown> = Promise.resolve()
  private closing: Promise<void> = Promise.resolve()
  private readonly handles = new Set<McpHttpHandle>()

  constructor(
    private readonly runtime: SshMcpRuntime,
    private readonly settings: McpHttpSettingsPort,
    private readonly serverInfo: McpServerInfo,
    private readonly audit?: McpAuditHook,
  ) {}

  applyFromSettings(): Promise<void> {
    const generation = this.generation
    return this.enqueue(() => this.settings.getMcpHttpEnabled() ? this.startListening(generation) : this.closeListener())
  }

  getStatus(): McpHttpStatus {
    const port = this.listeningPort ?? this.settings.getMcpHttpPort()
    const token = this.settings.getMcpHttpToken()
    const url = mcpHttpUrl(port)
    return {
      enabled: this.settings.getMcpHttpEnabled(),
      listening: !!this.handle && this.listeningPort != null,
      host: '127.0.0.1',
      port,
      url,
      token,
      lastError: this.lastError,
      snippets: buildMcpClientSnippets(url, token),
      approvalMode: this.settings.getMcpApprovalMode(),
    }
  }

  async setApprovalMode(mode: unknown): Promise<McpHttpStatus> {
    return this.enqueue(async () => {
      await this.settings.setMcpApprovalMode(sanitizeMcpApprovalMode(mode))
      return this.getStatus()
    })
  }

  async setEnabled(enabled: boolean): Promise<McpHttpStatus> {
    const generation = this.generation
    return this.enqueue(async () => {
      if (enabled) {
        await this.settings.setMcpHttpEnabled(true)
        try {
          await this.startListening(generation)
        } catch (err) {
          if (!this.disposed) await this.settings.setMcpHttpEnabled(false)
          throw err
        }
      } else {
        await this.settings.setMcpHttpEnabled(false)
        await this.closeListener()
        this.lastError = null
      }
      return this.getStatus()
    })
  }

  async setPort(port: number): Promise<McpHttpStatus> {
    const generation = this.generation
    return this.enqueue(async () => {
      await this.settings.setMcpHttpPort(sanitizeMcpHttpPort(port))
      if (this.settings.getMcpHttpEnabled()) await this.startListening(generation)
      return this.getStatus()
    })
  }

  async rotateToken(): Promise<McpHttpStatus> {
    return this.enqueue(async () => {
      await this.settings.rotateMcpHttpToken()
      return this.getStatus()
    })
  }

  start(): Promise<void> {
    const generation = this.generation
    return this.enqueue(() => this.startListening(generation))
  }

  private async startListening(generation: number): Promise<void> {
    await this.closeListener()
    if (this.disposed || generation !== this.generation) return
    await this.settings.ensureMcpHttpToken()
    if (this.disposed || generation !== this.generation) return
    const port = this.settings.getMcpHttpPort()
    const handle = createMcpHttpServer({
      runtime: this.runtime,
      getToken: () => this.settings.getMcpHttpToken(),
      serverInfo: this.serverInfo,
      audit: this.audit,
    })
    this.handles.add(handle)
    this.handle = handle
    try {
      const listeningPort = await handle.listen(port, '127.0.0.1')
      if (this.disposed || generation !== this.generation) {
        await handle.close()
        this.handles.delete(handle)
        return
      }
      this.listeningPort = listeningPort
      this.lastError = null
    } catch (err) {
      await handle.close().catch(() => {})
      this.handles.delete(handle)
      this.handle = null
      this.listeningPort = null
      this.lastError = err instanceof Error ? err.message : String(err)
      throw err
    }
  }

  async stop(): Promise<void> {
    this.generation++
    await this.closeListener()
  }

  private async closeListener(): Promise<void> {
    const handle = this.handle
    this.handle = null
    this.listeningPort = null
    if (handle) {
      const previous = this.closing
      const closed = handle.close().finally(() => this.handles.delete(handle))
      this.closing = Promise.allSettled([previous, closed]).then(() => undefined)
    }
    await this.closing
  }

  /** Irreversible: reject new settings/start operations and invalidate delayed starts. */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.stop()
    await this.operations
    await this.closeListener()
  }

  /** Release stalled sockets when the application's drain budget expires. */
  forceClose(): void {
    for (const handle of this.handles) handle.forceClose()
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('MCP HTTP gateway is disposed'))
    const next = this.operations.then(() => {
      if (this.disposed) throw new Error('MCP HTTP gateway is disposed')
      return operation()
    })
    this.operations = next.catch(() => {})
    return next
  }
}

export { MCP_HTTP_DEFAULT_PORT }
