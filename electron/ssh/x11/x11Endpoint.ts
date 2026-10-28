export type X11Endpoint = { host: string; port: number } | { path: string }

export function formatX11Endpoint(endpoint: X11Endpoint): string {
  return 'path' in endpoint
    ? endpoint.path.replace(/^\0/, '@')
    : `${endpoint.host}:${endpoint.port}`
}
