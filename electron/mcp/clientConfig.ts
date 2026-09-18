export function mcpHttpUrl(port: number, host = '127.0.0.1'): string {
  return `http://${host}:${port}/mcp`
}

export function mcpHealthUrl(port: number, host = '127.0.0.1'): string {
  return `http://${host}:${port}/health`
}

export function mcpAuthorizationHeader(token: string): string {
  return `Bearer ${token}`
}

export function buildMcpClientSnippets(url: string, token: string): { generic: string } {
  return {
    generic: JSON.stringify(
      {
        name: 'liteconnect-ssh',
        transport: 'http',
        url,
        headers: { Authorization: mcpAuthorizationHeader(token) },
      },
      null,
      2,
    ),
  }
}
