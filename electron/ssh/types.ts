import type { Client, ClientChannel, SFTPWrapper } from 'ssh2'
import type * as net from 'net'

export interface Connection {
  id: string
  host: string
  port: number
  username: string
  password: string
  name: string
  keepaliveInterval?: number
  x11Forwarding?: boolean
  x11Host?: string
  x11Display?: number
  privateKey?: string
  /** Bastion / jump host (ProxyJump-style) */
  jumpHost?: string
  jumpPort?: number
  jumpUsername?: string
  jumpPassword?: string
  jumpPrivateKey?: string
  /** Use OS SSH agent (Pageant on Windows, SSH_AUTH_SOCK elsewhere) */
  useAgent?: boolean
  /** Local port forwards: listen locally and tunnel to remoteHost:remotePort via SSH */
  localForwards?: Array<{ localPort: number; remoteHost: string; remotePort: number }>
  /** Remote forwards: remote listens and tunnels back to a local host:port */
  remoteForwards?: Array<{ remoteHost?: string; remotePort: number; localHost: string; localPort: number }>
  /** SOCKS5 dynamic forward on a local port */
  dynamicForwards?: Array<{ localPort: number }>
}

export interface Session {
  id: string
  client: Client
  stream: ClientChannel
  connectionId: string
  connectionName: string
  sftp?: SFTPWrapper
  x11Sockets?: Set<net.Socket>
  /** Bastion client when using jump host */
  jumpClient?: Client
  localForwardServers?: net.Server[]
  remoteForwardHandles?: Array<{ close: () => void }>
}

export type KeyboardInteractiveRequest = {
  requestId: string
  sessionId: string
  name: string
  instructions: string
  prompts: Array<{ prompt: string; echo: boolean }>
  role: 'target' | 'jump'
}

export interface SSHCallbacks {
  onData: (sessionId: string, data: string) => void
  /** Connection-status notices that must survive initial terminal mount timing. */
  onNotice?: (sessionId: string, message: string) => void
  onClose: (sessionId: string) => void
  onError: (sessionId: string, error: string) => void
  onKeyboardInteractive?: (req: KeyboardInteractiveRequest) => Promise<string[] | null>
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
  modifyTime: number
  permissions: string
}

/** Public snapshot for main-process integrations (MCP / monitor). No secrets. */
export type SessionSnapshot = {
  sessionId: string
  connectionId: string
  connectionName: string
  generation: number
  hasSftp: boolean
}

export interface ActiveTransfer {
  sessionId: string
  /** Single-file stream; absent for directory parent jobs */
  readStream?: import('stream').Readable
  writeStream?: import('stream').Writable
  cancelled: boolean
  /** When true, partial local/remote files are kept for resume */
  keepPartial?: boolean
  /** Directory job: child transfer ids to cancel together */
  childIds?: Set<string>
}

export type TransferConflictStrategy = 'overwrite' | 'skip' | 'rename'

/** On single-file failure during directory transfer */
export type DirFailPolicy = 'continue' | 'stop'

export interface SftpTransferOptions {
  /** Resume from existing partial file when sizes allow */
  resume?: boolean
  /** On cancel / error keep partial for later resume (default true when resume enabled) */
  keepPartial?: boolean
  /**
   * Cooperative cancel for directory child transfers.
   * Checked before creating streams (after async stat) so late callbacks cannot escape parent cancel.
   */
  isCancelled?: () => boolean
}

export interface DirTransferOptions {
  conflict?: TransferConflictStrategy
  /** Concurrent file transfers (default 3, clamp 1–8) */
  concurrency?: number
  /** continue = record failure and proceed; stop = abort remaining (default) */
  failPolicy?: DirFailPolicy
}

export interface DirTransferProgressStats {
  completedFiles: number
  failedFiles: number
  totalFiles: number
}

/** Outcome of a directory upload/download (not cancelled / not hard-fail). */
export interface DirTransferResult {
  status: 'completed' | 'partial'
  stats: DirTransferProgressStats
}

export interface HostKeyVerifyResult {
  accepted: boolean
  fingerprint: string
  error?: string
}

export type HostKeyVerifier = (key: Buffer, fingerprint: string) => boolean | Promise<boolean>

/** Which SSH endpoint failed host-key verification */
export type HostKeyRole = 'target' | 'jump'

export interface PendingHostKey {
  connectionId: string
  connection: Connection
  keyBuffer: Buffer
  fingerprint: string
  existingFingerprint: string
  callbacks: SSHCallbacks
  role: HostKeyRole
  /** Host/port of the endpoint that failed (jump or target) */
  host: string
  port: number
  /**
   * Session id used by the failed connect/reconnect attempt.
   * Confirm retries under this id so reconnect keeps the tab's sessionId
   * and initial connect can still adopt a single known id.
   */
  resumeSessionId: string
}
