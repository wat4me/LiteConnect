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
})
