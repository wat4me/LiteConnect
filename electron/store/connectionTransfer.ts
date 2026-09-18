/** Pure import/export mapping for SSH connections (no Electron). */

export type TransferLocalForward = {
  localPort: number
  remoteHost: string
  remotePort: number
}

export type TransferRemoteForward = {
  remoteHost?: string
  remotePort: number
  localHost: string
  localPort: number
}

export type TransferDynamicForward = {
  localPort: number
}

export type SshImportInput = {
  name: string
  host: string
  port: number
  username: string
  password: string
  privateKey?: string
  group?: string
  note?: string
  colorTag?: string
  keepaliveInterval?: number
  x11Forwarding?: boolean
  x11Host?: string
  x11Display?: number
  jumpHost?: string
  jumpPort?: number
  jumpUsername?: string
  jumpPassword?: string
  jumpPrivateKey?: string
  useAgent?: boolean
  localForwards?: TransferLocalForward[]
  remoteForwards?: TransferRemoteForward[]
  dynamicForwards?: TransferDynamicForward[]
}

export type SshExportConnection = SshImportInput & {
  id?: string
  pinned?: boolean
  useCount?: number
  lastConnectedAt?: number
  createdAt?: number
  updatedAt?: number
}

function asNonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

function asPort(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 65535) return v
  return fallback
}

export function sanitizeLocalForwards(raw: unknown): TransferLocalForward[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const list = raw
    .filter((f) => f && typeof f === 'object')
    .map((f: any) => ({
      localPort: Number(f.localPort),
      remoteHost: String(f.remoteHost || '').trim(),
      remotePort: Number(f.remotePort),
    }))
    .filter(
      (f) =>
        Number.isInteger(f.localPort)
        && f.localPort > 0
        && f.localPort <= 65535
        && f.remoteHost
        && Number.isInteger(f.remotePort)
        && f.remotePort > 0
        && f.remotePort <= 65535,
    )
  return list.length > 0 ? list : undefined
}

export function sanitizeRemoteForwards(raw: unknown): TransferRemoteForward[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const list = raw
    .filter((f) => f && typeof f === 'object')
    .map((f: any) => ({
      remoteHost: String(f.remoteHost || '127.0.0.1').trim() || '127.0.0.1',
      remotePort: Number(f.remotePort),
      localHost: String(f.localHost || '127.0.0.1').trim() || '127.0.0.1',
      localPort: Number(f.localPort),
    }))
    .filter(
      (f) =>
        Number.isInteger(f.remotePort)
        && f.remotePort > 0
        && f.remotePort <= 65535
        && Number.isInteger(f.localPort)
        && f.localPort > 0
        && f.localPort <= 65535
        && f.localHost,
    )
  return list.length > 0 ? list : undefined
}

export function sanitizeDynamicForwards(raw: unknown): TransferDynamicForward[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const list = raw
    .filter((f) => f && typeof f === 'object')
    .map((f: any) => ({ localPort: Number(f.localPort) }))
    .filter((f) => Number.isInteger(f.localPort) && f.localPort > 0 && f.localPort <= 65535)
  return list.length > 0 ? list : undefined
}

export function mapImportedSshConnection(raw: unknown): SshImportInput | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  const name = asNonEmptyString(c.name)
  const host = asNonEmptyString(c.host)
  const username = asNonEmptyString(c.username)
  if (!name || !host || !username) return null

  const jumpHost = asNonEmptyString(c.jumpHost)
  return {
    name,
    host,
    port: asPort(c.port, 22),
    username,
    password: typeof c.password === 'string' ? c.password : '',
    privateKey: typeof c.privateKey === 'string' && c.privateKey ? c.privateKey : undefined,
    group: typeof c.group === 'string' ? c.group : undefined,
    note: typeof c.note === 'string' ? c.note : undefined,
    colorTag: typeof c.colorTag === 'string' ? c.colorTag : undefined,
    keepaliveInterval:
      typeof c.keepaliveInterval === 'number' && Number.isFinite(c.keepaliveInterval)
        ? c.keepaliveInterval
        : undefined,
    x11Forwarding: c.x11Forwarding === true,
    x11Host: typeof c.x11Host === 'string' ? c.x11Host : undefined,
    x11Display: typeof c.x11Display === 'number' ? c.x11Display : undefined,
    jumpHost,
    jumpPort: jumpHost ? asPort(c.jumpPort, 22) : undefined,
    jumpUsername: jumpHost ? asNonEmptyString(c.jumpUsername) : undefined,
    jumpPassword: jumpHost && typeof c.jumpPassword === 'string' ? c.jumpPassword : undefined,
    jumpPrivateKey: jumpHost && typeof c.jumpPrivateKey === 'string' && c.jumpPrivateKey
      ? c.jumpPrivateKey
      : undefined,
    useAgent: c.useAgent === true,
    localForwards: sanitizeLocalForwards(c.localForwards),
    remoteForwards: sanitizeRemoteForwards(c.remoteForwards),
    dynamicForwards: sanitizeDynamicForwards(c.dynamicForwards),
  }
}

export function stripSecretsFromExport(conn: SshExportConnection): SshExportConnection {
  return {
    ...conn,
    password: '',
    privateKey: undefined,
    jumpPassword: undefined,
    jumpPrivateKey: undefined,
  }
}
