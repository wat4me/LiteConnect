import { app, safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { DbConnection, DbEngine, DbSslOptions } from '../db/types'
import { DEFAULT_DB_PORT, normalizeDbEngine } from '../db/types'
import { DecryptionError, isValidHost, isValidPort, isValidUsername } from '../utils/validation'
import { t } from '../i18n'

export type SaveDbConnectionInput = {
  id?: string
  name: string
  engine?: DbEngine
  host: string
  port?: number
  username: string
  password: string
  database?: string
  ssl?: boolean
  sslOptions?: DbSslOptions
  group?: string
  sshConnectionId?: string
  order?: number
}

export type DbConnectionExportPayload = {
  version: 1
  exportedAt: string
  connections: Array<Omit<DbConnection, 'password' | 'encrypted'> & { password?: string }>
}

export class DbConnectionStore {
  private filePath: string
  private connections: DbConnection[] = []
  private initialized = false
  private initPromise: Promise<void> | null = null

  constructor() {
    this.filePath = join(app.getPath('userData'), 'db-connections.json')
  }

  async init(): Promise<void> {
    if (this.initialized) return
    if (!this.initPromise) {
      this.initPromise = this.load().then(() => {
        this.initialized = true
      })
    }
    await this.initPromise
  }

  private encrypt(value: string): string {
    if (!value) return value
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(value).toString('base64')
    }
    return value
  }

  private decrypt(value: string, encrypted?: boolean): string {
    if (!value) return value
    if (encrypted && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(value, 'base64'))
      } catch {
        throw new DecryptionError(t('crypto.dbPasswordDecryptFailed'), 'password')
      }
    }
    return value
  }

  private decryptOrEmpty(value: string, encrypted?: boolean): string {
    try {
      return this.decrypt(value, encrypted)
    } catch {
      return ''
    }
  }

  private normalizeLoaded(c: any): DbConnection {
    const engine = normalizeDbEngine(c?.engine)
    const sslOptions = normalizeSslOptions(c?.sslOptions, c?.ssl)
    return {
      ...c,
      engine,
      ssl: !!(sslOptions?.enabled ?? c?.ssl),
      sslOptions,
      group: typeof c?.group === 'string' && c.group.trim() ? c.group.trim() : undefined,
      sshConnectionId:
        typeof c?.sshConnectionId === 'string' && c.sshConnectionId.trim()
          ? c.sshConnectionId.trim()
          : undefined,
    }
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      this.connections = Array.isArray(parsed)
        ? parsed.map((c: DbConnection) => this.normalizeLoaded(c))
        : []
    } catch {
      this.connections = []
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(this.connections, null, 2), 'utf-8')
  }

  private toPublic(conn: DbConnection): DbConnection {
    return { ...conn, password: '' }
  }

  getConnections(): DbConnection[] {
    return this.connections
      .map((c) => this.toPublic(c))
      .sort((a, b) => {
        const ag = (a.group || '').localeCompare(b.group || '', 'zh-CN')
        if (ag !== 0) return ag
        const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER
        const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER
        if (ao !== bo) return ao - bo
        return (a.createdAt || 0) - (b.createdAt || 0)
      })
  }

  getConnection(id: string): DbConnection | undefined {
    const conn = this.connections.find((c) => c.id === id)
    return conn ? this.toPublic(conn) : undefined
  }

  getConnectionPassword(id: string): string {
    const conn = this.connections.find((c) => c.id === id)
    if (!conn) return ''
    return this.decryptOrEmpty(conn.password, conn.encrypted)
  }

  /** Full credentials for main-process connect only */
  getConnectionForAuth(id: string): DbConnection | undefined {
    const conn = this.connections.find((c) => c.id === id)
    if (!conn) return undefined
    return {
      ...conn,
      password: this.decrypt(conn.password, conn.encrypted),
    }
  }

  getGroups(): string[] {
    const set = new Set<string>()
    for (const c of this.connections) {
      if (c.group) set.add(c.group)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }

  async reorderConnections(orderedIds: string[]): Promise<DbConnection[]> {
    if (!Array.isArray(orderedIds)) throw new Error('Invalid order')
    const map = new Map(this.connections.map((c) => [c.id, c]))
    const now = Date.now()
    orderedIds.forEach((id, index) => {
      const c = map.get(id)
      if (c) {
        c.order = index
        c.updatedAt = now
      }
    })
    await this.persist()
    return this.getConnections()
  }

  async saveConnection(input: SaveDbConnectionInput): Promise<DbConnection> {
    if (!input.name?.trim()) throw new Error('Invalid name')
    if (!isValidHost(input.host)) throw new Error('Invalid host')
    if (!isValidUsername(input.username)) throw new Error('Invalid username')
    if (typeof input.password !== 'string') throw new Error('Invalid password')
    const engine: DbEngine = normalizeDbEngine(input.engine)
    const port = input.port ?? DEFAULT_DB_PORT[engine]
    if (!isValidPort(port)) throw new Error('Invalid port')

    const sslOptions = normalizeSslOptions(input.sslOptions, input.ssl)
    const group =
      typeof input.group === 'string' && input.group.trim() ? input.group.trim() : undefined
    const sshConnectionId =
      typeof input.sshConnectionId === 'string' && input.sshConnectionId.trim()
        ? input.sshConnectionId.trim()
        : undefined

    const now = Date.now()

    if (input.id) {
      const idx = this.connections.findIndex((c) => c.id === input.id)
      if (idx === -1) throw new Error('Connection not found')
      const existing = this.connections[idx]
      this.connections[idx] = {
        ...existing,
        name: input.name.trim(),
        engine,
        host: input.host.trim(),
        port,
        username: input.username.trim(),
        password: this.encrypt(input.password),
        encrypted: true,
        database: input.database?.trim() || undefined,
        ssl: !!(sslOptions?.enabled),
        sslOptions,
        group,
        sshConnectionId,
        updatedAt: now,
      }
      await this.persist()
      return this.toPublic(this.connections[idx])
    }

    const maxOrder = this.connections.reduce(
      (max, c) => Math.max(max, typeof c.order === 'number' ? c.order : -1),
      -1,
    )
    const created: DbConnection = {
      id: uuidv4(),
      name: input.name.trim(),
      engine,
      host: input.host.trim(),
      port,
      username: input.username.trim(),
      password: this.encrypt(input.password),
      encrypted: true,
      database: input.database?.trim() || undefined,
      ssl: !!(sslOptions?.enabled),
      sslOptions,
      group,
      sshConnectionId,
      order: typeof input.order === 'number' ? input.order : maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    }
    this.connections.push(created)
    await this.persist()
    return this.toPublic(created)
  }

  async deleteConnection(id: string): Promise<boolean> {
    const idx = this.connections.findIndex((c) => c.id === id)
    if (idx === -1) return false
    this.connections.splice(idx, 1)
    await this.persist()
    return true
  }

  /** Export without encrypted password by default; includePassword only for local backup UX */
  getConnectionsForExport(includePassword = false): DbConnectionExportPayload {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      connections: this.connections.map((c) => {
        const base = {
          id: c.id,
          name: c.name,
          engine: c.engine,
          host: c.host,
          port: c.port,
          username: c.username,
          database: c.database,
          ssl: c.ssl,
          sslOptions: c.sslOptions
            ? {
                enabled: c.sslOptions.enabled,
                rejectUnauthorized: c.sslOptions.rejectUnauthorized,
                // Do not export cert private key material by default
                ca: c.sslOptions.ca,
                cert: c.sslOptions.cert,
              }
            : undefined,
          group: c.group,
          sshConnectionId: c.sshConnectionId,
          order: c.order,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }
        if (includePassword) {
          return {
            ...base,
            password: this.decryptOrEmpty(c.password, c.encrypted),
          }
        }
        return base
      }),
    }
  }

  async importConnections(
    items: any[],
    opts?: { skipExisting?: boolean },
  ): Promise<{ imported: number; skipped: number; total: number }> {
    if (!Array.isArray(items)) throw new Error('Invalid import format')
    let imported = 0
    let skipped = 0
    const skipExisting = opts?.skipExisting !== false

    for (const raw of items) {
      if (!raw || typeof raw !== 'object') {
        skipped++
        continue
      }
      if (!raw.name || !raw.host || !raw.username) {
        skipped++
        continue
      }
      const engine = normalizeDbEngine(raw.engine)
      const port = raw.port || DEFAULT_DB_PORT[engine]
      if (skipExisting) {
        const existing = this.connections.find(
          (c) =>
            c.host === raw.host &&
            c.username === raw.username &&
            c.port === port &&
            c.engine === engine,
        )
        if (existing) {
          skipped++
          continue
        }
      }
      try {
        await this.saveConnection({
          name: String(raw.name),
          engine,
          host: String(raw.host),
          port,
          username: String(raw.username),
          password: typeof raw.password === 'string' ? raw.password : '',
          database: typeof raw.database === 'string' ? raw.database : undefined,
          ssl: !!raw.ssl,
          sslOptions: normalizeSslOptions(raw.sslOptions, raw.ssl),
          group: typeof raw.group === 'string' ? raw.group : undefined,
          sshConnectionId:
            typeof raw.sshConnectionId === 'string' ? raw.sshConnectionId : undefined,
        })
        imported++
      } catch {
        skipped++
      }
    }
    return { imported, skipped, total: items.length }
  }
}

function normalizeSslOptions(
  sslOptions: unknown,
  sslFlag?: boolean,
): DbSslOptions | undefined {
  if (sslOptions && typeof sslOptions === 'object') {
    const o = sslOptions as Record<string, unknown>
    const enabled = typeof o.enabled === 'boolean' ? o.enabled : !!sslFlag
    if (!enabled && !o.ca && !o.cert && !o.key) {
      return { enabled: false }
    }
    return {
      enabled,
      rejectUnauthorized:
        typeof o.rejectUnauthorized === 'boolean' ? o.rejectUnauthorized : undefined,
      ca: typeof o.ca === 'string' ? o.ca : undefined,
      cert: typeof o.cert === 'string' ? o.cert : undefined,
      key: typeof o.key === 'string' ? o.key : undefined,
    }
  }
  if (sslFlag) return { enabled: true, rejectUnauthorized: false }
  return undefined
}
