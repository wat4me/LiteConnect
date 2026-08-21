import { MCP_HTTP_DEFAULT_PORT, sanitizeMcpHttpPort } from '../../shared/mcp/limits'
import { buildMcpClientSnippets, mcpHttpUrl } from './clientConfig'
import { createMcpHttpServer, type McpHttpHandle } from './httpServer'
import type { McpAuditHook, McpServerInfo } from './httpProtocol'
import type { SshMcpRuntime } from './runtime'

export type McpHttpSettingsPort = {
  getMcpHttpEnabled(): boolean
  getMcpHttpPort(): number
  getMcpHttpToken(): string
  ensureMcpHttpToken(): Promise<string>
  setMcpHttpEnabled(enabled: boolean): Promise<void>
  setMcpHttpPort(port: number): Promise<void>
  rotateMcpHttpToken(): Promise<string>
}

export type McpHttpStatus = {
  enabled: boolean
  listening: boolean
  host: '127.0.0.1'
  port: number
  url: string
  token: string
  lastError: string | null
  snippets: { generic: string }
}

export class McpHttpGateway {
  private handle: McpHttpHandle | null = null
  private lastError: string | null = null
  private listeningPort: number | null = null

  constructor(
    private readonly runtime: SshMcpRuntime,
    private readonly settings: McpHttpSettingsPort,
    private readonly serverInfo: McpServerInfo,
    private readonly audit?: McpAuditHook,
  ) {}

  async applyFromSettings(): Promise<void> {
    if (this.settings.getMcpHttpEnabled()) {
      await this.start()
      return
    }
    await this.stop()
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
    }
  }

  async setEnabled(enabled: boolean): Promise<McpHttpStatus> {
    if (enabled) {
      await this.settings.setMcpHttpEnabled(true)
      try {
        await this.start()
      } catch (err) {
        await this.settings.setMcpHttpEnabled(false)
        throw err
      }
    } else {
      await this.settings.setMcpHttpEnabled(false)
      await this.stop()
      this.lastError = null
    }
    return this.getStatus()
  }

  async setPort(port: number): Promise<McpHttpStatus> {
    await this.settings.setMcpHttpPort(sanitizeMcpHttpPort(port))
    if (this.settings.getMcpHttpEnabled()) await this.start()
    return this.getStatus()
  }

  async rotateToken(): Promise<McpHttpStatus> {
    await this.settings.rotateMcpHttpToken()
    return this.getStatus()
  }

  async start(): Promise<void> {
    await this.stop()
    await this.settings.ensureMcpHttpToken()
    const port = this.settings.getMcpHttpPort()
    this.handle = createMcpHttpServer({
      runtime: this.runtime,
      getToken: () => this.settings.getMcpHttpToken(),
      serverInfo: this.serverInfo,
      audit: this.audit,
    })
    try {
      this.listeningPort = await this.handle.listen(port, '127.0.0.1')
      this.lastError = null
    } catch (err) {
      this.handle = null
      this.listeningPort = null
      this.lastError = err instanceof Error ? err.message : String(err)
      throw err
    }
  }

  async stop(): Promise<void> {
    if (this.handle) {
      try {
        await this.handle.close()
      } catch {}
      this.handle = null
    }
    this.listeningPort = null
  }
}

export { MCP_HTTP_DEFAULT_PORT }
