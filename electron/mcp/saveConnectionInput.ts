import { isValidHost, isValidPort, isValidUsername } from '../utils/validation'
import type { SshMcpToolErrorCode } from '../../shared/mcp/types'

export const MCP_CONNECTION_NAME_MAX = 80
export const MCP_CONNECTION_NOTE_MAX = 500
export const MCP_CONNECTION_PASSWORD_MAX = 16 * 1024
export const MCP_CONNECTION_PRIVATE_KEY_MAX = 64 * 1024

export type McpSaveConnectionDraft = {
  name: string
  host: string
  port: number
  username: string
  password: string
  privateKey?: string
  useAgent: boolean
  group?: string
  note?: string
}

export type ParsedSaveConnection = McpSaveConnectionDraft & {
  connect: boolean
}

export type ParseSaveConnectionResult =
  | { ok: true; value: ParsedSaveConnection }
  | { ok: false; code: SshMcpToolErrorCode; message: string }

function fail(code: SshMcpToolErrorCode, message: string): ParseSaveConnectionResult {
  return { ok: false, code, message }
}

function asTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function defaultConnectionName(username: string, host: string, port: number): string {
  const where = port && port !== 22 ? `${host}:${port}` : host
  return `${username}@${where}`
}

export type ExistingPublicConnection = {
  id: string
  name: string
  host: string
  port: number
  username: string
}

export function matchExistingSavedConnection(
  existing: ExistingPublicConnection[],
  draft: Pick<McpSaveConnectionDraft, 'name' | 'host' | 'port' | 'username'>,
): { kind: 'create' } | { kind: 'reuse'; id: string } | { kind: 'name-taken' } {
  const hit = existing.find((c) => c.name === draft.name)
  if (!hit) return { kind: 'create' }
  if (hit.host === draft.host && hit.port === draft.port && hit.username === draft.username) {
    return { kind: 'reuse', id: hit.id }
  }
  return { kind: 'name-taken' }
}

export function parseSaveConnectionInput(input: Record<string, unknown>): ParseSaveConnectionResult {
  const host = asTrimmed(input.host)
  if (!isValidHost(host)) {
    return fail('INVALID_ARGUMENTS', 'host is required (hostname or IP, no spaces)')
  }

  const username = asTrimmed(input.username)
  if (!isValidUsername(username)) {
    return fail('INVALID_ARGUMENTS', 'username is required (1–64 characters)')
  }

  let port = 22
  if (input.port !== undefined && input.port !== null && input.port !== '') {
    const n = typeof input.port === 'number' ? input.port : Number(input.port)
    if (!isValidPort(n)) return fail('INVALID_ARGUMENTS', 'port must be an integer 1–65535')
    port = n
  }

  const nameRaw = asTrimmed(input.name)
  const name = nameRaw || defaultConnectionName(username, host, port)
  if (!name || name.length > MCP_CONNECTION_NAME_MAX || name.includes('\0')) {
    return fail('INVALID_ARGUMENTS', `name must be 1–${MCP_CONNECTION_NAME_MAX} characters`)
  }

  const password = typeof input.password === 'string' ? input.password : ''
  if (password.length > MCP_CONNECTION_PASSWORD_MAX) {
    return fail('INVALID_ARGUMENTS', `password is too long (max ${MCP_CONNECTION_PASSWORD_MAX} characters)`)
  }

  const privateKey = typeof input.privateKey === 'string' ? input.privateKey : ''
  if (privateKey.length > MCP_CONNECTION_PRIVATE_KEY_MAX) {
    return fail('INVALID_ARGUMENTS', `privateKey is too long (max ${MCP_CONNECTION_PRIVATE_KEY_MAX} characters)`)
  }

  const useAgent = input.useAgent === true
  if (!password && !privateKey && !useAgent) {
    return fail(
      'INVALID_ARGUMENTS',
      'Pass password, privateKey (PEM), or useAgent=true (system SSH agent)',
    )
  }

  const noteRaw = asTrimmed(input.note)
  if (noteRaw.length > MCP_CONNECTION_NOTE_MAX) {
    return fail('INVALID_ARGUMENTS', `note must be at most ${MCP_CONNECTION_NOTE_MAX} characters`)
  }

  const group = asTrimmed(input.group) || undefined
  const connect = input.connect === true

  return {
    ok: true,
    value: {
      name,
      host,
      port,
      username,
      password,
      privateKey: privateKey || undefined,
      useAgent,
      group,
      note: noteRaw || undefined,
      connect,
    },
  }
}
