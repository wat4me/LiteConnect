import { describe, expect, it } from 'vitest'
import { buildMcpClientSnippets, mcpHttpUrl } from './clientConfig'

describe('MCP client snippets', () => {
  it('builds a generic HTTP MCP config with the bearer token', () => {
    const url = mcpHttpUrl(17420)
    expect(url).toBe('http://127.0.0.1:17420/mcp')
    const snippets = buildMcpClientSnippets(url, 'secret-token')
    expect(JSON.parse(snippets.generic)).toMatchObject({
      name: 'liteconnect-ssh',
      transport: 'http',
      url,
      headers: { Authorization: 'Bearer secret-token' },
    })
  })

  it('uses client-specific transports and references the token without copying its value', () => {
    const url = mcpHttpUrl(18766)
    const token = 'secret-token'
    const { claudeCode, codex, cursor, geminiCli, copilot, openCode } = buildMcpClientSnippets(url, token)
    const name = 'liteconnect-ssh'
    const headers = { Authorization: 'Bearer ${LITECONNECT_MCP_TOKEN}' }
    const http = { type: 'http', url, headers }

    expect(JSON.parse(claudeCode)).toEqual({ mcpServers: { [name]: http } })
    expect(codex.split('\n')).toEqual([
      '[mcp_servers.liteconnect-ssh]',
      `url = "${url}"`,
      'bearer_token_env_var = "LITECONNECT_MCP_TOKEN"',
    ])
    expect(JSON.parse(cursor)).toEqual({
      mcpServers: { [name]: { url, headers: { Authorization: 'Bearer ${env:LITECONNECT_MCP_TOKEN}' } } },
    })
    expect(JSON.parse(geminiCli)).toEqual({ mcpServers: { [name]: { httpUrl: url, headers } } })
    expect(JSON.parse(copilot)).toEqual({ mcpServers: { [name]: { ...http, tools: ['*'] } } })
    expect(JSON.parse(openCode)).toEqual({
      mcp: {
        servers: {
          [name]: { type: 'remote', url, oauth: false, headers: { Authorization: 'Bearer {env:LITECONNECT_MCP_TOKEN}' } },
        },
      },
    })
    expect([claudeCode, codex, cursor, geminiCli, copilot, openCode].join('\n')).not.toContain(token)
  })
})
