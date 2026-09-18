export interface LocalForward {
  localPort: number
  remoteHost: string
  remotePort: number
}

export interface RemoteForward {
  remoteHost?: string
  remotePort: number
  localHost: string
  localPort: number
}

export interface DynamicForward {
  localPort: number
}

/** Auth + tunnel fields needed to open an SSH session (no list-metadata). */
export interface SshConnectProfile {
  id: string
  name: string
  host: string
  port: number
  username: string
  password: string
  keepaliveInterval?: number
  x11Forwarding?: boolean
  x11Host?: string
  x11Display?: number
  privateKey?: string
  jumpHost?: string
  jumpPort?: number
  jumpUsername?: string
  jumpPassword?: string
  jumpPrivateKey?: string
  useAgent?: boolean
  localForwards?: LocalForward[]
  remoteForwards?: RemoteForward[]
  dynamicForwards?: DynamicForward[]
}

/** Persisted / list payload. Secrets may be stripped in renderer list responses. */
export interface Connection extends SshConnectProfile {
  encrypted?: boolean
  privateKeyEncrypted?: boolean
  jumpPasswordEncrypted?: boolean
  jumpPrivateKeyEncrypted?: boolean
  group?: string
  order?: number
  note?: string
  colorTag?: string
  pinned?: boolean
  useCount?: number
  lastConnectedAt?: number
  hasPrivateKey?: boolean
  hasJumpPassword?: boolean
  hasJumpPrivateKey?: boolean
  createdAt: number
  updatedAt: number
}

export interface Group {
  id: string
  name: string
  order: number
  isDefault: boolean
}

export interface SavedCredential {
  id: string
  name: string
  username: string
  password: string
  encrypted?: boolean
  createdAt: number
  updatedAt: number
}

export type KnownHostEntry = {
  host: string
  port: number
  fingerprint: string
  firstSeen: number
}

export interface KeyboardInteractivePrompt {
  requestId: string
  sessionId: string
  name: string
  instructions: string
  prompts: Array<{ prompt: string; echo: boolean }>
  role: 'target' | 'jump'
}
