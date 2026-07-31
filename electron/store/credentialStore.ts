import { app, safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { DecryptionError } from '../utils/validation'
import { t } from '../i18n'

export interface Connection {
  id: string
  name: string
  host: string
  port: number
  username: string
  password: string
  encrypted?: boolean
  privateKey?: string
  privateKeyEncrypted?: boolean
  group?: string
  /** Sort order within the connections list (lower first) */
  order?: number
  /** Optional free-text note for operators */
  note?: string
  /** Optional color tag: gray | blue | green | yellow | orange | red | purple */
  colorTag?: string
  keepaliveInterval?: number
  x11Forwarding?: boolean
  x11Host?: string
  x11Display?: number
  jumpHost?: string
  jumpPort?: number
  jumpUsername?: string
  jumpPassword?: string
  jumpPasswordEncrypted?: boolean
  jumpPrivateKey?: string
  jumpPrivateKeyEncrypted?: boolean
  useAgent?: boolean
  localForwards?: Array<{ localPort: number; remoteHost: string; remotePort: number }>
  /** Pin to top of connection list */
  pinned?: boolean
  /** Successful connect count (UI stats) */
  useCount?: number
  /** Last successful connect timestamp */
  lastConnectedAt?: number
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Built-in default group name (user may rename later). */
const DEFAULT_GROUP_NAME = '默认分组'

export class CredentialStore {
  private connectionsPath: string
  private groupsPath: string
  private savedCredentialsPath: string
  private connections: Connection[] = []
  private groups: Group[] = []
  private savedCredentials: SavedCredential[] = []
  private initialized = false
  private initPromise: Promise<void> | null = null
  private decryptedCache: Map<string, { value: string; ts: number }> = new Map()
  private readonly CACHE_TTL_MS = 5 * 60 * 1000

  constructor() {
    const userData = app.getPath('userData')
    this.connectionsPath = join(userData, 'connections.json')
    this.groupsPath = join(userData, 'groups.json')
    this.savedCredentialsPath = join(userData, 'saved-credentials.json')
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
      const encrypted = safeStorage.encryptString(value)
      return encrypted.toString('base64')
    }
    return value
  }

  private decrypt(value: string, encrypted?: boolean): string {
    if (!value) return value
    if (encrypted && safeStorage.isEncryptionAvailable()) {
      try {
        const buffer = Buffer.from(value, 'base64')
        return safeStorage.decryptString(buffer)
      } catch {
        throw new DecryptionError(t('crypto.passwordDecryptFailed'), 'password')
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

  private decryptPrivateKeyOrEmpty(value: string, encrypted?: boolean): string {
    if (!value) return value
    if (encrypted && safeStorage.isEncryptionAvailable()) {
      try {
        const buffer = Buffer.from(value, 'base64')
        return safeStorage.decryptString(buffer)
      } catch {
        throw new DecryptionError(t('crypto.privateKeyDecryptFailed'), 'privateKey')
      }
    }
    return value
  }

  private decryptPrivateKeyOrUndefined(value: string, encrypted?: boolean): string | undefined {
    if (!value) return undefined
    try {
      return this.decryptPrivateKeyOrEmpty(value, encrypted)
    } catch {
      return undefined
    }
  }

  private async load(): Promise<void> {
    try {
      const data = await readFile(this.connectionsPath, 'utf-8')
      this.connections = JSON.parse(data)
    } catch {
      this.connections = []
    }

    try {
      const data = await readFile(this.groupsPath, 'utf-8')
      this.groups = JSON.parse(data)
    } catch {
      this.groups = []
    }

    try {
      const data = await readFile(this.savedCredentialsPath, 'utf-8')
      this.savedCredentials = JSON.parse(data)
    } catch {
      this.savedCredentials = []
    }

    await this.migrateGroupField()
    // Always keep a real default group; migrate legacy "ungrouped" connections into it.
    await this.ensureDefaultGroupAndReassign()
    if (this.needsPasswordMigration()) {
      await this.migratePasswords()
    }
    if (this.needsPrivateKeyMigration()) {
      await this.migratePrivateKeys()
    }
    if (this.needsSavedCredentialMigration()) {
      await this.migrateSavedCredentials()
    }
  }

  /** Return the default group id (creates one if needed). */
  getDefaultGroupId(): string {
    const def = this.groups.find((g) => g.isDefault)
    if (def) return def.id
    const sorted = [...this.groups].sort((a, b) => a.order - b.order)
    if (sorted[0]) return sorted[0].id
    // Synchronous fallback should not happen after ensureDefaultGroupAndReassign
    return ''
  }

  /**
   * Ensure there is exactly one isDefault group named for new installs,
   * and every connection belongs to an existing group (no virtual "ungrouped").
   */
  private async ensureDefaultGroupAndReassign(): Promise<void> {
    let dirtyGroups = false
    let dirtyConns = false

    if (this.groups.length === 0) {
      this.groups.push({
        id: uuidv4(),
        name: DEFAULT_GROUP_NAME,
        order: 0,
        isDefault: true,
      })
      dirtyGroups = true
    } else {
      const defaults = this.groups.filter((g) => g.isDefault)
      if (defaults.length === 0) {
        // Prefer a group already named 默认分组, else first by order
        const named = this.groups.find((g) => g.name === DEFAULT_GROUP_NAME)
        const target =
          named || [...this.groups].sort((a, b) => a.order - b.order)[0]
        for (const g of this.groups) g.isDefault = g.id === target.id
        dirtyGroups = true
      } else if (defaults.length > 1) {
        // Keep the first as sole default
        let kept = false
        for (const g of this.groups) {
          if (g.isDefault) {
            if (!kept) kept = true
            else {
              g.isDefault = false
              dirtyGroups = true
            }
          }
        }
      }
    }

    const groupIds = new Set(this.groups.map((g) => g.id))
    const fallback = this.groups.find((g) => g.isDefault)?.id || this.groups[0].id
    for (const conn of this.connections) {
      if (!conn.group || !groupIds.has(conn.group)) {
        conn.group = fallback
        dirtyConns = true
      }
    }

    if (dirtyGroups) await this.saveGroups()
    if (dirtyConns) await this.saveConnections()
  }

  private needsSavedCredentialMigration(): boolean {
    return this.savedCredentials.some(c => c.password && !c.encrypted)
  }

  private async migrateSavedCredentials(): Promise<void> {
    let migrated = false
    for (const credential of this.savedCredentials) {
      if (!credential.encrypted && credential.password) {
        credential.password = this.encrypt(credential.password)
        credential.encrypted = true
        migrated = true
      }
    }
    if (migrated) {
      await this.saveSavedCredentials()
    }
  }

  private needsPasswordMigration(): boolean {
    return this.connections.some(c => c.password && !c.encrypted)
  }

  private async migratePasswords(): Promise<void> {
    let migrated = false
    for (const conn of this.connections) {
      if (!conn.encrypted && conn.password) {
        conn.password = this.encrypt(conn.password)
        conn.encrypted = true
        migrated = true
      }
    }
    if (migrated) {
      await this.saveConnections()
    }
  }

  private needsPrivateKeyMigration(): boolean {
    return this.connections.some(c => c.privateKey && !c.privateKeyEncrypted)
  }

  private async migratePrivateKeys(): Promise<void> {
    let migrated = false
    for (const conn of this.connections) {
      if (!conn.privateKeyEncrypted && conn.privateKey) {
        conn.privateKey = this.encrypt(conn.privateKey)
        conn.privateKeyEncrypted = true
        migrated = true
      }
    }
    if (migrated) {
      await this.saveConnections()
    }
  }

  private async migrateGroupField() {
    let migrated = false
    const nameToId: Record<string, string> = {}

    for (const g of this.groups) {
      nameToId[g.name] = g.id
    }

    for (const conn of this.connections) {
      if (conn.group && !UUID_RE.test(conn.group)) {
        let groupId = nameToId[conn.group]
        if (!groupId) {
          const newGroup: Group = {
            id: uuidv4(),
            name: conn.group,
            order: this.groups.length,
            isDefault: false,
          }
          this.groups.push(newGroup)
          nameToId[conn.group] = newGroup.id
          groupId = newGroup.id
        }
        conn.group = groupId
        migrated = true
      }
    }

    if (migrated) {
      await Promise.all([this.saveConnections(), this.saveGroups()])
    }
  }

  private async saveConnections(): Promise<void> {
    try {
      await mkdir(dirname(this.connectionsPath), { recursive: true })
      await writeFile(this.connectionsPath, JSON.stringify(this.connections, null, 2), 'utf-8')
    } catch (err) {
      console.error('Failed to save connections:', err)
    }
  }

  private async saveGroups(): Promise<void> {
    try {
      await mkdir(dirname(this.groupsPath), { recursive: true })
      await writeFile(this.groupsPath, JSON.stringify(this.groups, null, 2), 'utf-8')
    } catch (err) {
      console.error('Failed to save groups:', err)
    }
  }

  private async saveSavedCredentials(): Promise<void> {
    try {
      await mkdir(dirname(this.savedCredentialsPath), { recursive: true })
      await writeFile(this.savedCredentialsPath, JSON.stringify(this.savedCredentials, null, 2), 'utf-8')
    } catch (err) {
      console.error('Failed to save saved credentials:', err)
    }
  }

  private stripPassword(conn: Connection): Connection {
    return { ...conn, password: '' }
  }

  private stripSavedCredentialPassword(credential: SavedCredential): SavedCredential {
    return { ...credential, password: '' }
  }

  getConnections(): Connection[] {
    return this.connections
      .map(conn => this.stripPassword(conn))
      .sort((a, b) => {
        const ap = a.pinned === true ? 1 : 0
        const bp = b.pinned === true ? 1 : 0
        if (ap !== bp) return bp - ap
        const ao = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER
        const bo = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER
        if (ao !== bo) return ao - bo
        return (a.createdAt || 0) - (b.createdAt || 0)
      })
  }

  /** Toggle pin; returns updated connection (password stripped). */
  async setConnectionPinned(id: string, pinned: boolean): Promise<Connection> {
    const idx = this.connections.findIndex((c) => c.id === id)
    if (idx === -1) throw new Error('Connection not found')
    this.connections[idx] = {
      ...this.connections[idx],
      pinned: pinned ? true : undefined,
      updatedAt: Date.now(),
    }
    await this.saveConnections()
    return this.stripPassword(this.connections[idx])
  }

  /** Bump useCount + lastConnectedAt after a successful connect. */
  async recordConnectionUsage(id: string): Promise<Connection | null> {
    const idx = this.connections.findIndex((c) => c.id === id)
    if (idx === -1) return null
    const prev = this.connections[idx]
    const useCount = (typeof prev.useCount === 'number' && prev.useCount > 0 ? prev.useCount : 0) + 1
    this.connections[idx] = {
      ...prev,
      useCount,
      lastConnectedAt: Date.now(),
      updatedAt: Date.now(),
    }
    await this.saveConnections()
    return this.stripPassword(this.connections[idx])
  }

  getConnectionsForExport(): Connection[] {
    return this.connections.map(conn => {
      let password = ''
      let privateKey: string | undefined
      try {
        password = this.decryptCachedOrEmpty(conn.id)
      } catch {}
      if (conn.privateKey) {
        privateKey = this.decryptPrivateKeyOrUndefined(conn.privateKey, conn.privateKeyEncrypted)
      }
      return {
        ...conn,
        password,
        privateKey,
        encrypted: false,
        privateKeyEncrypted: false
      }
    })
  }

  getConnection(id: string): Connection | undefined {
    const conn = this.connections.find((c) => c.id === id)
    if (!conn) return undefined
    return this.stripPassword(conn)
  }

  getConnectionForAuth(id: string): Connection | undefined {
    const conn = this.connections.find((c) => c.id === id)
    if (!conn) return undefined
    const password = this.decryptCached(conn.id)
    const privateKey = conn.privateKey
      ? this.decryptPrivateKeyOrEmpty(conn.privateKey, conn.privateKeyEncrypted)
      : undefined
    const jumpPassword = conn.jumpPassword
      ? this.decryptOrEmpty(conn.jumpPassword, conn.jumpPasswordEncrypted)
      : undefined
    const jumpPrivateKey = conn.jumpPrivateKey
      ? this.decryptPrivateKeyOrEmpty(conn.jumpPrivateKey, conn.jumpPrivateKeyEncrypted)
      : undefined
    return {
      ...conn,
      password,
      privateKey,
      jumpPassword,
      jumpPrivateKey,
    }
  }

  getConnectionPassword(id: string): string | undefined {
    const conn = this.connections.find((c) => c.id === id)
    if (!conn) return undefined
    return this.decryptCachedOrEmpty(id)
  }

  clearDecryptedCache(): void {
    this.decryptedCache.clear()
  }

  private decryptCached(connectionId: string): string {
    const conn = this.connections.find((c) => c.id === connectionId)
    if (!conn) return ''
    const entry = this.decryptedCache.get(connectionId)
    if (entry && Date.now() - entry.ts < this.CACHE_TTL_MS) {
      return entry.value
    }
    if (entry) {
      this.decryptedCache.delete(connectionId)
    }
    const decrypted = this.decrypt(conn.password, conn.encrypted)
    this.decryptedCache.set(connectionId, { value: decrypted, ts: Date.now() })
    return decrypted
  }

  private decryptCachedOrEmpty(connectionId: string): string {
    try {
      return this.decryptCached(connectionId)
    } catch {
      return ''
    }
  }

  async saveConnection(conn: Partial<Connection> & { name: string; host: string; username: string; password: string }): Promise<Connection> {
    const now = Date.now()
    let saved: Connection

    const encryptedConn = {
      ...conn,
      password: this.encrypt(conn.password),
      encrypted: true,
      ...(conn.privateKey !== undefined
        ? { privateKey: this.encrypt(conn.privateKey), privateKeyEncrypted: true }
        : {}),
      useAgent: !!conn.useAgent,
      localForwards: Array.isArray(conn.localForwards)
        ? conn.localForwards
            .filter((f: any) => f && f.localPort > 0 && f.remoteHost && f.remotePort > 0)
            .map((f: any) => ({
              localPort: Number(f.localPort),
              remoteHost: String(f.remoteHost),
              remotePort: Number(f.remotePort),
            }))
        : undefined,
    }

    // Jump secrets: only overwrite when a new value is provided; clear when jumpHost removed
    const applyJumpSecrets = (base: Connection): Connection => {
      let next = { ...base }
      if (!conn.jumpHost) {
        next.jumpPassword = undefined
        next.jumpPasswordEncrypted = false
        next.jumpPrivateKey = undefined
        next.jumpPrivateKeyEncrypted = false
        next.jumpHost = undefined
        next.jumpPort = undefined
        next.jumpUsername = undefined
      } else {
        if (conn.jumpPassword) {
          next.jumpPassword = this.encrypt(conn.jumpPassword)
          next.jumpPasswordEncrypted = true
        }
        if (conn.jumpPrivateKey) {
          next.jumpPrivateKey = this.encrypt(conn.jumpPrivateKey)
          next.jumpPrivateKeyEncrypted = true
        }
      }
      return next
    }

    const groupIds = new Set(this.groups.map((g) => g.id))
    const resolvedGroup =
      encryptedConn.group && groupIds.has(encryptedConn.group as string)
        ? (encryptedConn.group as string)
        : this.getDefaultGroupId()

    if (conn.id) {
      const idx = this.connections.findIndex((c) => c.id === conn.id)
      if (idx === -1) {
        throw new Error('Connection not found')
      }
      this.connections[idx] = applyJumpSecrets({
        ...this.connections[idx],
        ...encryptedConn,
        group: resolvedGroup,
        updatedAt: now,
      } as Connection)
      saved = this.connections[idx]
    } else {
      const maxOrder = this.connections.reduce(
        (max, c) => Math.max(max, typeof c.order === 'number' ? c.order : -1),
        -1,
      )
      saved = applyJumpSecrets({
        ...encryptedConn,
        id: uuidv4(),
        port: conn.port || 22,
        order: maxOrder + 1,
        group: resolvedGroup,
        createdAt: now,
        updatedAt: now,
      } as Connection)
      this.connections.push(saved)
    }

    await this.saveConnections()
    this.decryptedCache.set(saved.id, { value: conn.password, ts: Date.now() })
    return {
      ...saved,
      password: conn.password,
    }
  }

  async updateConnectionGroup(id: string, groupId: string | undefined): Promise<Connection> {
    const idx = this.connections.findIndex((c) => c.id === id)
    if (idx === -1) throw new Error('Connection not found')
    const groupIds = new Set(this.groups.map((g) => g.id))
    // null/empty/orphan → default group (no virtual ungrouped bucket)
    const resolved =
      groupId && groupIds.has(groupId) ? groupId : this.getDefaultGroupId()
    this.connections[idx] = { ...this.connections[idx], group: resolved, updatedAt: Date.now() }
    await this.saveConnections()
    return this.stripPassword(this.connections[idx])
  }

  /**
   * Reorder connections. `orderedIds` may be a partial list (e.g. only the current group);
   * those ids keep their relative slots in the master array but appear in the new order.
   */
  async reorderConnections(orderedIds: string[]): Promise<void> {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) return
    const idSet = new Set(orderedIds)
    const subset = orderedIds
      .map((id) => this.connections.find((c) => c.id === id))
      .filter((c): c is Connection => !!c)
    if (subset.length === 0) return

    let subsetIdx = 0
    const result: Connection[] = []
    for (const conn of this.connections) {
      if (idSet.has(conn.id)) {
        const next = subset[subsetIdx++]
        if (next) result.push(next)
      } else {
        result.push(conn)
      }
    }
    // Safety: append any leftover from subset (should not happen)
    while (subsetIdx < subset.length) {
      result.push(subset[subsetIdx++])
    }

    this.connections = result.map((conn, index) => ({
      ...conn,
      order: index,
    }))
    await this.saveConnections()
  }

  getSavedCredentials(): SavedCredential[] {
    return this.savedCredentials
      .map(credential => this.stripSavedCredentialPassword(credential))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getSavedCredentialPassword(id: string): string | undefined {
    const credential = this.savedCredentials.find((c) => c.id === id)
    if (!credential) return undefined
    return this.decryptOrEmpty(credential.password, credential.encrypted)
  }

  async saveSavedCredential(credential: Partial<SavedCredential> & { name: string; username: string; password: string }): Promise<SavedCredential> {
    const now = Date.now()
    const encryptedCredential = {
      ...credential,
      password: this.encrypt(credential.password),
      encrypted: true,
    }
    let saved: SavedCredential

    if (credential.id) {
      const idx = this.savedCredentials.findIndex((c) => c.id === credential.id)
      if (idx === -1) {
        throw new Error('Saved credential not found')
      }
      this.savedCredentials[idx] = {
        ...this.savedCredentials[idx],
        ...encryptedCredential,
        updatedAt: now,
      } as SavedCredential
      saved = this.savedCredentials[idx]
    } else {
      saved = {
        ...encryptedCredential,
        id: uuidv4(),
        createdAt: now,
        updatedAt: now,
      } as SavedCredential
      this.savedCredentials.push(saved)
    }

    await this.saveSavedCredentials()
    return {
      ...saved,
      password: '',
    }
  }

  async deleteSavedCredential(id: string): Promise<boolean> {
    const idx = this.savedCredentials.findIndex((c) => c.id === id)
    if (idx === -1) return false
    this.savedCredentials.splice(idx, 1)
    await this.saveSavedCredentials()
    return true
  }

  async deleteConnection(id: string): Promise<boolean> {
    const idx = this.connections.findIndex((c) => c.id === id)
    if (idx === -1) return false
    this.connections.splice(idx, 1)
    this.decryptedCache.delete(id)
    await this.saveConnections()
    return true
  }

  getGroups(): Group[] {
    return [...this.groups].sort((a, b) => a.order - b.order)
  }

  async saveGroup(group: Partial<Group> & { name: string }): Promise<Group> {
    let saved: Group

    if (group.id) {
      const idx = this.groups.findIndex((g) => g.id === group.id)
      if (idx === -1) {
        throw new Error('Group not found')
      }
      this.groups[idx] = {
        ...this.groups[idx],
        ...group,
      } as Group
      saved = this.groups[idx]
    } else {
      const maxOrder = this.groups.reduce((max, g) => Math.max(max, g.order), -1)
      saved = {
        id: uuidv4(),
        name: group.name,
        order: group.order ?? maxOrder + 1,
        isDefault: group.isDefault ?? false,
      }
      this.groups.push(saved)
    }

    await this.saveGroups()
    return saved
  }

  async deleteGroup(id: string): Promise<boolean> {
    const idx = this.groups.findIndex((g) => g.id === id)
    if (idx === -1) return false
    const wasDefault = this.groups[idx].isDefault
    this.groups.splice(idx, 1)

    // Always keep at least one real group
    if (this.groups.length === 0) {
      this.groups.push({
        id: uuidv4(),
        name: DEFAULT_GROUP_NAME,
        order: 0,
        isDefault: true,
      })
    } else if (wasDefault || !this.groups.some((g) => g.isDefault)) {
      const next = [...this.groups].sort((a, b) => a.order - b.order)[0]
      for (const g of this.groups) g.isDefault = g.id === next.id
    }

    const fallback = this.groups.find((g) => g.isDefault)?.id || this.groups[0].id
    for (const conn of this.connections) {
      if (conn.group === id || !conn.group) {
        conn.group = fallback
      }
    }

    await this.saveGroups()
    await this.saveConnections()
    return true
  }

  async reorderGroups(orderedIds: string[]): Promise<void> {
    const idSet = new Set(this.groups.map((g) => g.id))
    let order = 0
    for (const id of orderedIds) {
      if (idSet.has(id)) {
        const g = this.groups.find((g) => g.id === id)
        if (g) g.order = order++
      }
    }
    for (const g of this.groups) {
      if (!orderedIds.includes(g.id)) {
        g.order = order++
      }
    }
    await this.saveGroups()
  }

  async setDefaultGroup(id: string | null): Promise<void> {
    // Always keep exactly one default group (cannot clear all).
    if (!id || !this.groups.some((g) => g.id === id)) {
      await this.ensureDefaultGroupAndReassign()
      return
    }
    for (const g of this.groups) {
      g.isDefault = g.id === id
    }
    await this.saveGroups()
  }
}
