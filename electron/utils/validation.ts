import type { BrowserWindow, WebContents } from 'electron'
import { isAbsolute, normalize } from 'path'
import {
  CLIPBOARD_MAX_CHARS,
  LOCAL_PATH_MAX_CHARS,
  SSH_EXEC_DEFAULT_TIMEOUT_MS,
  SSH_EXEC_MAX_COMMAND_CHARS,
  SSH_EXEC_MAX_TIMEOUT_MS,
  SSH_EXEC_MIN_TIMEOUT_MS,
  SSH_WRITE_MAX_CHARS,
} from './constants'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function safeSend(win: BrowserWindow | null, channel: string, ...args: any[]): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(channel, ...args)
}

export function safeWebContentsSend(wc: WebContents, channel: string, ...args: any[]): void {
  if (wc.isDestroyed()) return
  wc.send(channel, ...args)
}

export function isValidUUID(id: string): boolean {
  return typeof id === 'string' && UUID_RE.test(id)
}

/** Transfer ids are client-generated (`dl-…` / `ul-…`), not UUIDs. */
export function isValidTransferId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && !id.includes('\0')
}

export function isValidPort(port: number): boolean {
  return typeof port === 'number' && port > 0 && port <= 65535 && Number.isInteger(port)
}

export function isValidHost(host: string): boolean {
  if (typeof host !== 'string' || host.length === 0 || host.length > 255) return false
  return /^[a-zA-Z0-9.\-:]+$/.test(host)
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1'
}

export function isValidX11Display(display: number): boolean {
  return typeof display === 'number' && Number.isInteger(display) && display >= 0 && display <= 99 && isValidPort(6000 + display)
}

export function isValidUsername(username: string): boolean {
  return typeof username === 'string' && username.length > 0 && username.length <= 64
}

export function isValidPath(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0) return false
  if (p.includes('\0')) return false
  return true
}

export function isStrictPath(p: string): boolean {
  if (!isValidPath(p)) return false
  if (/\.\.[\\/]/.test(p) || /[\\/]\.\./.test(p)) return false
  return true
}

/** Absolute local filesystem path for shell open / reveal (no traversal / null bytes). */
export function isSafeLocalPath(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0 || p.length > LOCAL_PATH_MAX_CHARS) return false
  if (p.includes('\0')) return false
  if (!isAbsolute(p)) return false
  // Reject parent-segment before and after normalize (Windows normalize may collapse `..`).
  if (/(^|[\\/])\.\.([\\/]|$)/.test(p)) return false
  const normalized = normalize(p)
  if (!isAbsolute(normalized)) return false
  if (/(^|[\\/])\.\.([\\/]|$)/.test(normalized)) return false
  return true
}

export function isValidClipboardText(text: unknown): text is string {
  return typeof text === 'string' && text.length <= CLIPBOARD_MAX_CHARS
}

export function isValidSshWriteData(data: unknown): data is string {
  return typeof data === 'string' && data.length > 0 && data.length <= SSH_WRITE_MAX_CHARS
}

export function isValidExecCommand(command: unknown): command is string {
  return (
    typeof command === 'string' &&
    command.length > 0 &&
    command.length <= SSH_EXEC_MAX_COMMAND_CHARS &&
    !command.includes('\0')
  )
}

export function clampExecTimeoutMs(timeoutMs?: number): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
    return SSH_EXEC_DEFAULT_TIMEOUT_MS
  }
  const n = Math.floor(timeoutMs)
  if (n < SSH_EXEC_MIN_TIMEOUT_MS) return SSH_EXEC_MIN_TIMEOUT_MS
  if (n > SSH_EXEC_MAX_TIMEOUT_MS) return SSH_EXEC_MAX_TIMEOUT_MS
  return n
}

export function validateConnectionParams(params: any): { valid: boolean; error?: string } {
  if (!params || typeof params !== 'object') return { valid: false, error: 'Invalid params object' }
  if (!isValidHost(params.host)) return { valid: false, error: 'Invalid host' }
  if (!isValidPort(params.port)) return { valid: false, error: 'Invalid port' }
  if (!isValidUsername(params.username)) return { valid: false, error: 'Invalid username' }
  if (params.password !== undefined && typeof params.password !== 'string') {
    return { valid: false, error: 'Invalid password' }
  }
  if (params.privateKey !== undefined && typeof params.privateKey !== 'string') {
    return { valid: false, error: 'Invalid private key' }
  }
  if (params.useAgent !== undefined && typeof params.useAgent !== 'boolean') {
    return { valid: false, error: 'Invalid SSH agent option' }
  }
  if (params.connectionId !== undefined && !isValidUUID(params.connectionId)) {
    return { valid: false, error: 'Invalid connection id' }
  }
  if (params.savedCredentialId !== undefined && !isValidUUID(params.savedCredentialId)) {
    return { valid: false, error: 'Invalid credential id' }
  }
  return { valid: true }
}

export type AuthConnectionParams = {
  host: string
  port: number
  username: string
  password: string
  privateKey?: string
  useAgent?: boolean
  /** Fill missing secrets from a stored connection (never returns secrets to renderer). */
  connectionId?: string
  /** Fill password from a saved credential when password field is empty. */
  savedCredentialId?: string
}

export function buildSshConnectConfig(params: AuthConnectionParams, readyTimeout: number): import('ssh2').ConnectConfig {
  return {
    host: params.host,
    port: params.port,
    username: params.username,
    ...(params.privateKey
      ? {
          privateKey: Buffer.from(params.privateKey),
          ...(params.password ? { passphrase: params.password } : {}),
        }
      : { password: params.password }),
    readyTimeout,
  }
}

const DECRYPTION_ERROR_CODE = 'DECRYPTION_FAILED'

export class DecryptionError extends Error {
  readonly code = DECRYPTION_ERROR_CODE
  readonly field?: 'password' | 'privateKey' | 'apiKey'

  constructor(message: string, field?: 'password' | 'privateKey' | 'apiKey') {
    super(message)
    this.name = 'DecryptionError'
    this.field = field
  }

  static is(err: unknown): err is DecryptionError {
    return err instanceof DecryptionError || (err instanceof Error && (err as any).code === DECRYPTION_ERROR_CODE)
  }
}
