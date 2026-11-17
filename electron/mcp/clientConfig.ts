import { MCP_TOKEN_ENV_VAR, type McpHttpStatus } from '../../shared/mcp/types'

const SERVER_NAME = 'liteconnect-ssh'

export function mcpHttpUrl(port: number, host = '127.0.0.1'): string {
  return `http://${host}:${port}/mcp`
}

export function mcpHealthUrl(port: number, host = '127.0.0.1'): string {
  return `http://${host}:${port}/health`
}

export function mcpAuthorizationHeader(token: string): string {
  return `Bearer ${token}`
}

export function buildMcpClientSnippets(url: string, token: string): McpHttpStatus['snippets'] {
  const tokenReference = '${' + MCP_TOKEN_ENV_VAR + '}'
  const headers = { Authorization: mcpAuthorizationHeader(tokenReference) }
  const http = { type: 'http', url, headers }

  return {
    claudeCode: json({ mcpServers: { [SERVER_NAME]: http } }),
    codex: [
      `[mcp_servers.${SERVER_NAME}]`,
      `url = ${JSON.stringify(url)}`,
      `bearer_token_env_var = "${MCP_TOKEN_ENV_VAR}"`,
    ].join('\n'),
    cursor: json({
      mcpServers: { [SERVER_NAME]: { url, headers: { Authorization: `Bearer \${env:${MCP_TOKEN_ENV_VAR}}` } } },
    }),
    geminiCli: json({ mcpServers: { [SERVER_NAME]: { httpUrl: url, headers } } }),
    copilot: json({ mcpServers: { [SERVER_NAME]: { ...http, tools: ['*'] } } }),
    openCode: json({
      mcp: {
        servers: {
          [SERVER_NAME]: { type: 'remote', url, oauth: false, headers: { Authorization: `Bearer {env:${MCP_TOKEN_ENV_VAR}}` } },
        },
      },
    }),
    generic: json({
      name: SERVER_NAME,
      transport: 'http',
      url,
      headers: { Authorization: mcpAuthorizationHeader(token) },
    }),
  }
}

function json(config: object): string {
  return JSON.stringify(config, null, 2)
}
