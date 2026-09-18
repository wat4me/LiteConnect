import { timingSafeEqual } from 'crypto'
import { MCP_HTTP_RATE_LIMIT, MCP_HTTP_RATE_WINDOW_MS } from '../../shared/mcp/limits'

export function hostnameFromHostHeader(host: string): string | null {
  const s = host.trim().toLowerCase()
  if (!s) return null
  if (s.startsWith('[')) {
    const end = s.indexOf(']')
    if (end < 1) return null
    return s.slice(1, end)
  }
  const colon = s.lastIndexOf(':')
  if (colon > 0 && /^\d+$/.test(s.slice(colon + 1))) {
    return s.slice(0, colon)
  }
  return s
}

export function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

export function isAllowedHostHeader(host: string | undefined): boolean {
  if (!host || typeof host !== 'string') return false
  const hostname = hostnameFromHostHeader(host)
  return !!hostname && isLoopbackHostname(hostname)
}

/** Missing Origin is allowed (native MCP clients). Browser Origins must be loopback. */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const url = new URL(origin)
    return isLoopbackHostname(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

export function bearerMatches(authorization: string | undefined, token: string): boolean {
  if (!token || !authorization) return false
  const match = authorization.match(/^Bearer\s+(\S+)\s*$/i)
  if (!match) return false
  const got = Buffer.from(match[1], 'utf8')
  const expected = Buffer.from(token, 'utf8')
  if (got.length !== expected.length) return false
  return timingSafeEqual(got, expected)
}

export class SlidingWindowLimiter {
  private hits: number[] = []

  constructor(
    private readonly max = MCP_HTTP_RATE_LIMIT,
    private readonly windowMs = MCP_HTTP_RATE_WINDOW_MS,
  ) {}

  allow(now = Date.now()): boolean {
    this.hits = this.hits.filter((t) => now - t < this.windowMs)
    if (this.hits.length >= this.max) return false
    this.hits.push(now)
    return true
  }
}
