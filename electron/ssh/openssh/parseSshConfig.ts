export type ParsedLocalForward = {
  localPort: number
  remoteHost: string
  remotePort: number
}

export type ParsedRemoteForward = {
  remoteHost: string
  remotePort: number
  localHost: string
  localPort: number
}

export type ParsedDynamicForward = {
  localPort: number
}

export type ParsedSshHost = {
  alias: string
  hostName?: string
  port?: number
  user?: string
  identityFiles: string[]
  proxyJump?: string
  localForwards: ParsedLocalForward[]
  remoteForwards: ParsedRemoteForward[]
  dynamicForwards: ParsedDynamicForward[]
  forwardX11?: boolean
}

const MULTI_KEYS = new Set([
  'identityfile',
  'localforward',
  'remoteforward',
  'dynamicforward',
])

function stripComment(line: string): string {
  let out = ''
  let quote = false
  for (const ch of line) {
    if (ch === '"') quote = !quote
    if (ch === '#' && !quote) break
    out += ch
  }
  return out.trim()
}

function tokenize(line: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let quote = false
  for (const ch of line) {
    if (ch === '"') {
      quote = !quote
      continue
    }
    if (!quote && /\s/.test(ch)) {
      if (cur) tokens.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur) tokens.push(cur)
  return tokens
}

function parsePort(raw: string): number | undefined {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return undefined
  return n
}

/** `3306 localhost:3306` or `localhost:3306 localhost:3306` */
function parseForwardPair(raw: string): { aHost: string; aPort: number; bHost: string; bPort: number } | null {
  const parts = raw.trim().split(/\s+/)
  if (parts.length === 1 && parts[0].includes('/')) {
    // 3306/localhost/3306
    const bits = parts[0].split('/')
    if (bits.length === 3) {
      const aPort = parsePort(bits[0])
      const bPort = parsePort(bits[2])
      if (aPort && bPort) return { aHost: '127.0.0.1', aPort, bHost: bits[1] || '127.0.0.1', bPort }
    }
  }
  if (parts.length < 2) return null
  const left = parts[0]
  const right = parts[1]
  const splitEp = (ep: string, defaultHost: string) => {
    const idx = ep.lastIndexOf(':')
    if (idx < 0) {
      const p = parsePort(ep)
      return p ? { host: defaultHost, port: p } : null
    }
    const host = ep.slice(0, idx) || defaultHost
    const p = parsePort(ep.slice(idx + 1))
    return p ? { host, port: p } : null
  }
  const a = splitEp(left, '127.0.0.1')
  const b = splitEp(right, '127.0.0.1')
  if (!a || !b) return null
  return { aHost: a.host, aPort: a.port, bHost: b.host, bPort: b.port }
}

function parseProxyJump(raw: string): { host: string; port?: number; user?: string } | null {
  const first = raw.split(',')[0]?.trim()
  if (!first) return null
  // user@host:port | host:port | user@host | host
  let user: string | undefined
  let rest = first
  const at = first.lastIndexOf('@')
  if (at > 0) {
    user = first.slice(0, at)
    rest = first.slice(at + 1)
  }
  if (rest.startsWith('[') && rest.includes(']')) {
    const end = rest.indexOf(']')
    const host = rest.slice(1, end)
    const portPart = rest.slice(end + 1)
    const port = portPart.startsWith(':') ? parsePort(portPart.slice(1)) : undefined
    return { host, port, user }
  }
  const colon = rest.lastIndexOf(':')
  if (colon > 0 && /^\d+$/.test(rest.slice(colon + 1))) {
    return { host: rest.slice(0, colon), port: parsePort(rest.slice(colon + 1)), user }
  }
  return { host: rest, user }
}

export function parseSshConfig(text: string): ParsedSshHost[] {
  const blocks: Array<{ patterns: string[]; kv: Map<string, string[]>; order: string[] }> = []
  let current: { patterns: string[]; kv: Map<string, string[]>; order: string[] } | null = null

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = stripComment(rawLine)
    if (!line) continue
    const tokens = tokenize(line)
    if (tokens.length < 2) continue
    const key = tokens[0].toLowerCase()
    const value = tokens.slice(1).join(' ')
    if (key === 'host' || key === 'match') {
      if (key === 'match') {
        current = null
        continue
      }
      const patterns = tokens.slice(1).filter((p) => p && p !== '*')
      current = { patterns: tokens.slice(1), kv: new Map(), order: [] }
      blocks.push(current)
      void patterns
      continue
    }
    if (!current) continue
    const list = current.kv.get(key) || []
    if (MULTI_KEYS.has(key) || list.length === 0) {
      list.push(value)
      current.kv.set(key, list)
      if (!current.order.includes(key)) current.order.push(key)
    }
  }

  const globals = new Map<string, string[]>()
  for (const block of blocks) {
    if (block.patterns.length === 1 && block.patterns[0] === '*') {
      for (const [k, vals] of block.kv) {
        if (!globals.has(k)) globals.set(k, [...vals])
      }
    }
  }

  const hosts: ParsedSshHost[] = []
  for (const block of blocks) {
    const aliases = block.patterns.filter((p) => p !== '*' && !p.startsWith('!') && !p.includes('*') && !p.includes('?'))
    for (const alias of aliases) {
      const get = (k: string): string[] => block.kv.get(k) || globals.get(k) || []
      const first = (k: string) => get(k)[0]
      const hostName = first('hostname') || alias
      const port = first('port') ? parsePort(first('port')) : undefined
      const user = first('user')
      const identityFiles = get('identityfile')
      const jumpRaw = first('proxyjump')
      const jump = jumpRaw ? parseProxyJump(jumpRaw) : null
      const localForwards: ParsedLocalForward[] = []
      for (const raw of get('localforward')) {
        const pair = parseForwardPair(raw)
        if (pair) localForwards.push({ localPort: pair.aPort, remoteHost: pair.bHost, remotePort: pair.bPort })
      }
      const remoteForwards: ParsedRemoteForward[] = []
      for (const raw of get('remoteforward')) {
        const pair = parseForwardPair(raw)
        if (pair) {
          remoteForwards.push({
            remoteHost: pair.aHost === String(pair.aPort) ? '0.0.0.0' : pair.aHost,
            remotePort: pair.aPort,
            localHost: pair.bHost,
            localPort: pair.bPort,
          })
        }
      }
      const dynamicForwards: ParsedDynamicForward[] = []
      for (const raw of get('dynamicforward')) {
        const ep = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw
        const p = parsePort(ep.trim())
        if (p) dynamicForwards.push({ localPort: p })
      }
      const x11 = first('forwardx11')
      hosts.push({
        alias,
        hostName,
        port,
        user,
        identityFiles,
        proxyJump: jump?.host,
        localForwards,
        remoteForwards,
        dynamicForwards,
        forwardX11: x11 ? /^(yes|true|1)$/i.test(x11) : undefined,
      })
      if (jump?.user || jump?.port) {
        const last = hosts[hosts.length - 1]
        if (jump.user) last.proxyJump = jump.user + '@' + jump.host + (jump.port ? `:${jump.port}` : '')
        else if (jump.port) last.proxyJump = `${jump.host}:${jump.port}`
      }
    }
  }
  return hosts
}

export function parseProxyJumpSpec(raw: string): { host: string; port: number; user?: string } | null {
  const parsed = parseProxyJump(raw)
  if (!parsed?.host) return null
  return { host: parsed.host, port: parsed.port || 22, user: parsed.user }
}

export type ParsedKnownHost = {
  host: string
  port: number
  keyType: string
  keyBase64: string
  hashed: boolean
}

export function parseKnownHosts(text: string): { entries: ParsedKnownHost[]; hashedSkipped: number } {
  const entries: ParsedKnownHost[] = []
  let hashedSkipped = 0
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('@')) continue
    if (line.startsWith('|1|')) {
      hashedSkipped++
      continue
    }
    const parts = line.split(/\s+/)
    if (parts.length < 3) continue
    const markers = parts[0]
    const keyType = parts[1]
    const keyBase64 = parts[2]
    if (!keyType.startsWith('ssh-') && !keyType.startsWith('ecdsa-') && keyType !== 'rsa-sha2-256' && keyType !== 'rsa-sha2-512') {
      continue
    }
    for (const marker of markers.split(',')) {
      let host = marker.trim()
      let port = 22
      if (!host || host.startsWith('|')) {
        if (host.startsWith('|')) hashedSkipped++
        continue
      }
      const m = /^\[(.+)]:(.+)$/.exec(host)
      if (m) {
        host = m[1]
        port = parsePort(m[2]) || 22
      }
      entries.push({ host, port, keyType, keyBase64, hashed: false })
    }
  }
  return { entries, hashedSkipped }
}
