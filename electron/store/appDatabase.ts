import { app } from 'electron'
import { existsSync } from 'fs'
import { readFile, readdir, rename } from 'fs/promises'
import { basename, join } from 'path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'

export const DB_FILE_NAME = 'liteconnect.sqlite'

export const COLLECTIONS = {
  sshConnections: 'ssh-connections',
  sshGroups: 'ssh-groups',
  savedCredentials: 'saved-credentials',
  dbConnections: 'db-connections',
  dbQueryHistory: 'db-query-history',
  shellCommandHistory: 'shell-command-history',
  knownHosts: 'known-hosts',
} as const

export const SINGLETONS = {
  settings: 'settings',
} as const

const AI_SESSION_PREFIX = 'ai-session:'
const RENDERER_STATE_PREFIX = 'renderer-state:'
const LEGACY_MIGRATION_ID = 'legacy-json-v1'
const CURRENT_SCHEMA_VERSION = 2
/** MCP audit rows beyond this count are dropped oldest-first on every append. */
export const MCP_AUDIT_MAX_ROWS = 5000

type JsonObject = Record<string, unknown>

type LegacyPayload = {
  settings?: unknown
  collections: Map<string, Array<{ id: string; value: unknown }>>
  aiSessions: Array<{ sessionId: string; raw: string }>
  auditEvents: unknown[]
  pathsToArchive: string[]
}

export class AppDatabase {
  private readonly db: DatabaseSync
  private closed = false
  get isOpen(): boolean { return !this.closed }
  private transactionDepth = 0
  private readonly singletonVersions = new Map<string, number>()
  private rollbackVersion = 0
  private readonly statements = new Map<string, StatementSync>()

  constructor(filePath: string) {
    this.db = new DatabaseSync(filePath)
    this.db.exec('PRAGMA journal_mode = WAL')
    // WAL with NORMAL survives application crashes without an fsync per commit;
    // only an OS crash or power loss can lose the most recent commits.
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.createSchema()
  }

  /** One parse per SQL text; node:sqlite resets a statement after each get/all/run. */
  private statement(sql: string): StatementSync {
    let prepared = this.statements.get(sql)
    if (!prepared) {
      prepared = this.db.prepare(sql)
      this.statements.set(sql, prepared)
    }
    return prepared
  }

  private createSchema(): void {
    const row = this.statement('PRAGMA user_version').get() as { user_version: number }
    const version = Number(row.user_version)
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new Error(`Database schema ${version} is newer than this app supports`)
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        data_json TEXT NOT NULL CHECK (json_valid(data_json)),
        PRIMARY KEY (collection, id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_documents_collection_order
        ON documents(collection, sort_order, id);

      CREATE TABLE IF NOT EXISTS singletons (
        key TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL,
        data_json TEXT NOT NULL CHECK (json_valid(data_json))
      ) STRICT;

      CREATE TABLE IF NOT EXISTS mcp_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        data_json TEXT NOT NULL CHECK (json_valid(data_json))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_mcp_audit_ts ON mcp_audit(ts);

      CREATE TABLE IF NOT EXISTS data_migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      ) STRICT;
    `)
    if (version < CURRENT_SCHEMA_VERSION) {
      this.db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`)
    }
  }

  transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) return work()
    this.db.exec('BEGIN IMMEDIATE')
    this.transactionDepth++
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      this.rollbackVersion++
      throw error
    } finally {
      this.transactionDepth--
    }
  }

  getCollection<T>(collection: string): T[] {
    const rows = this.statement('SELECT data_json FROM documents WHERE collection = ? ORDER BY sort_order, id')
      .all(collection) as Array<{ data_json: string }>
    return rows.map((row) => JSON.parse(row.data_json) as T)
  }

  countCollection(collection: string): number {
    const row = this.statement('SELECT COUNT(*) AS count FROM documents WHERE collection = ?')
      .get(collection) as { count: number }
    return Number(row.count)
  }

  getDocument<T>(collection: string, id: string): T | undefined {
    const row = this.statement('SELECT data_json FROM documents WHERE collection = ? AND id = ?').get(collection, id) as { data_json: string } | undefined
    return row ? JSON.parse(row.data_json) as T : undefined
  }

  setDocument(collection: string, id: string, value: unknown, sortOrder = 0): void {
    this.statement(`INSERT INTO documents(collection, id, sort_order, updated_at, data_json) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(collection, id) DO UPDATE SET sort_order=excluded.sort_order, updated_at=excluded.updated_at, data_json=excluded.data_json`)
      .run(collection, id, sortOrder, Date.now(), JSON.stringify(value))
  }

  deleteDocument(collection: string, id: string): void {
    this.statement('DELETE FROM documents WHERE collection = ? AND id = ?').run(collection, id)
  }

  listCollections(prefix: string): string[] {
    const rows = this.statement("SELECT DISTINCT collection FROM documents WHERE collection LIKE ? ESCAPE '\\' ORDER BY collection")
      .all(`${escapeLike(prefix)}%`) as Array<{ collection: string }>
    return rows.map((row) => row.collection)
  }

  deleteCollection(collection: string): void {
    this.statement('DELETE FROM documents WHERE collection = ?').run(collection)
  }

  /** Local writes, external SQLite commits and rollbacks all invalidate metadata caches. */
  getSingletonRevision(key: string): string {
    const row = this.statement('PRAGMA data_version').get() as { data_version: number }
    return `${this.rollbackVersion}:${row.data_version}:${this.singletonVersions.get(key) || 0}`
  }

  replaceCollection<T>(
    collection: string,
    values: T[],
    getId: (value: T, index: number) => string,
  ): void {
    this.transaction(() => {
      const existingRows = this.statement('SELECT id FROM documents WHERE collection = ?')
        .all(collection) as Array<{ id: string }>
      const retainedIds = new Set<string>()
      const upsert = this.statement(`
        INSERT INTO documents(collection, id, sort_order, updated_at, data_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(collection, id) DO UPDATE SET
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at,
          data_json = excluded.data_json
        WHERE documents.sort_order <> excluded.sort_order
           OR documents.data_json <> excluded.data_json
      `)
      const now = Date.now()
      values.forEach((value, index) => {
        const id = getId(value, index)
        if (!id) throw new Error(`Missing id for ${collection} record ${index}`)
        if (retainedIds.has(id)) throw new Error(`Duplicate id ${id} in ${collection}`)
        retainedIds.add(id)
        upsert.run(collection, id, index, now, JSON.stringify(value))
      })
      const remove = this.statement('DELETE FROM documents WHERE collection = ? AND id = ?')
      for (const row of existingRows) {
        if (!retainedIds.has(row.id)) remove.run(collection, row.id)
      }
    })
  }

  getSingleton<T>(key: string): T | undefined {
    const row = this.statement('SELECT data_json FROM singletons WHERE key = ?')
      .get(key) as { data_json: string } | undefined
    return row ? (JSON.parse(row.data_json) as T) : undefined
  }

  hasSingleton(key: string): boolean {
    return Boolean(this.statement('SELECT 1 AS ok FROM singletons WHERE key = ?').get(key))
  }

  setSingleton(key: string, value: unknown): void {
    this.statement(`
      INSERT INTO singletons(key, updated_at, data_json)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        updated_at = excluded.updated_at,
        data_json = excluded.data_json
    `).run(key, Date.now(), JSON.stringify(value))
    this.singletonVersions.set(key, (this.singletonVersions.get(key) || 0) + 1)
  }

  listSingletonKeys(prefix: string): string[] {
    const rows = this.statement("SELECT key FROM singletons WHERE key LIKE ? ESCAPE '\\' ORDER BY key")
      .all(`${escapeLike(prefix)}%`) as Array<{ key: string }>
    return rows.map((row) => row.key)
  }

  deleteSingleton(key: string): void {
    this.statement('DELETE FROM singletons WHERE key = ?').run(key)
    this.singletonVersions.set(key, (this.singletonVersions.get(key) || 0) + 1)
  }

  appendMcpAudit(event: unknown, timestamp = Date.now()): void {
    this.statement('INSERT INTO mcp_audit(ts, data_json) VALUES (?, ?)')
      .run(timestamp, JSON.stringify(event))
    this.statement('DELETE FROM mcp_audit WHERE id <= (SELECT id FROM mcp_audit ORDER BY id DESC LIMIT 1 OFFSET ?)')
      .run(MCP_AUDIT_MAX_ROWS)
  }

  listMcpAudit(): unknown[] {
    const rows = this.statement('SELECT data_json FROM mcp_audit ORDER BY id')
      .all() as Array<{ data_json: string }>
    return rows.map((row) => JSON.parse(row.data_json))
  }

  countMcpAudit(): number {
    const row = this.statement('SELECT COUNT(*) AS count FROM mcp_audit').get() as { count: number }
    return Number(row.count)
  }

  hasMigration(id: string): boolean {
    return Boolean(this.statement('SELECT 1 AS ok FROM data_migrations WHERE id = ?').get(id))
  }

  markMigration(id: string): void {
    this.statement('INSERT OR IGNORE INTO data_migrations(id, applied_at) VALUES (?, ?)')
      .run(id, Date.now())
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.statements.clear()
    this.db.close()
  }
}

let sharedDatabase: AppDatabase | null = null
let initializationPromise: Promise<AppDatabase> | null = null
let databaseGeneration = 0

export function aiSessionKey(sessionId: string): string {
  if (!sessionId || typeof sessionId !== 'string') throw new Error('Invalid AI session id')
  return `${AI_SESSION_PREFIX}${sessionId}`
}

export function sessionIdFromAiKey(key: string): string {
  return key.slice(AI_SESSION_PREFIX.length)
}

export function rendererStateKey(key: string): string {
  return `${RENDERER_STATE_PREFIX}${key}`
}

export async function initializeAppDatabase(userData = app.getPath('userData')): Promise<AppDatabase> {
  if (sharedDatabase) return sharedDatabase
  if (!initializationPromise) {
    const generation = databaseGeneration
    initializationPromise = (async () => {
      const database = new AppDatabase(join(userData, DB_FILE_NAME))
      try {
        await migrateLegacyStorage(userData, database)
        if (generation !== databaseGeneration) throw new Error('App database closed during initialization')
        sharedDatabase = database
        return database
      } catch (error) {
        database.close()
        initializationPromise = null
        throw error
      }
    })()
  }
  return initializationPromise
}

export function getAppDatabase(): AppDatabase {
  if (!sharedDatabase) {
    throw new Error('App database has not been initialized')
  }
  return sharedDatabase
}

export function closeAppDatabase(): void {
  databaseGeneration++
  sharedDatabase?.close()
  sharedDatabase = null
  initializationPromise = null
}

export async function migrateLegacyStorage(userData: string, database: AppDatabase): Promise<void> {
  if (database.hasMigration(LEGACY_MIGRATION_ID)) {
    await archiveLegacyPaths(legacyStoragePaths(userData).filter((path) => existsSync(path)))
    return
  }
  const payload = await readLegacyPayload(userData)
  database.transaction(() => {
    if (payload.settings !== undefined && !database.hasSingleton(SINGLETONS.settings)) {
      database.setSingleton(SINGLETONS.settings, payload.settings)
    }
    for (const [collection, records] of payload.collections) {
      if (database.countCollection(collection) === 0 && records.length > 0) {
        database.replaceCollection(collection, records.map((record) => record.value), (_value, index) => records[index].id)
      }
    }
    for (const session of payload.aiSessions) {
      const key = aiSessionKey(session.sessionId)
      if (!database.hasSingleton(key)) database.setSingleton(key, session.raw)
    }
    if (database.countMcpAudit() === 0) {
      for (const event of payload.auditEvents) {
        const ts = isObject(event) && typeof event.ts === 'number' ? event.ts : Date.now()
        database.appendMcpAudit(event, ts)
      }
    }
    database.markMigration(LEGACY_MIGRATION_ID)
  })
  await archiveLegacyPaths(payload.pathsToArchive)
}

function legacyStoragePaths(userData: string): string[] {
  return [
    'settings.json',
    'connections.json',
    'groups.json',
    'saved-credentials.json',
    'db-connections.json',
    'db-query-history.json',
    'shell-command-history.json',
    'known_hosts.json',
    'mcp-audit.jsonl',
    'ai-history',
  ].map((name) => join(userData, name))
}

async function readLegacyPayload(userData: string): Promise<LegacyPayload> {
  const collections = new Map<string, Array<{ id: string; value: unknown }>>()
  const pathsToArchive: string[] = []

  const settings = await readJsonIfPresent(join(userData, 'settings.json'), {}, pathsToArchive)
  addArrayCollection(collections, COLLECTIONS.sshConnections,
    await readJsonIfPresent(join(userData, 'connections.json'), [], pathsToArchive))
  addArrayCollection(collections, COLLECTIONS.sshGroups,
    await readJsonIfPresent(join(userData, 'groups.json'), [], pathsToArchive))
  addArrayCollection(collections, COLLECTIONS.savedCredentials,
    await readJsonIfPresent(join(userData, 'saved-credentials.json'), [], pathsToArchive))
  addArrayCollection(collections, COLLECTIONS.dbConnections,
    await readJsonIfPresent(join(userData, 'db-connections.json'), [], pathsToArchive))

  const queryHistory = await readJsonIfPresent(
    join(userData, 'db-query-history.json'),
    { items: [] },
    pathsToArchive,
  )
  const queryItems = Array.isArray(queryHistory)
    ? queryHistory
    : isObject(queryHistory) && Array.isArray(queryHistory.items)
      ? queryHistory.items
      : []
  addArrayCollection(collections, COLLECTIONS.dbQueryHistory, queryItems)

  const shellHistory = await readJsonIfPresent(
    join(userData, 'shell-command-history.json'),
    { byConnection: {} },
    pathsToArchive,
  )
  const shellRecords: Array<{ id: string; value: unknown }> = []
  if (isObject(shellHistory) && isObject(shellHistory.byConnection)) {
    for (const [connectionId, items] of Object.entries(shellHistory.byConnection)) {
      if (Array.isArray(items)) shellRecords.push({ id: connectionId, value: { connectionId, items } })
    }
  }
  collections.set(COLLECTIONS.shellCommandHistory, shellRecords)

  const knownHosts = await readJsonIfPresent(join(userData, 'known_hosts.json'), {}, pathsToArchive)
  const hostRecords: Array<{ id: string; value: unknown }> = []
  if (isObject(knownHosts)) {
    for (const [key, entry] of Object.entries(knownHosts)) {
      hostRecords.push({ id: key, value: { key, entry } })
    }
  }
  collections.set(COLLECTIONS.knownHosts, hostRecords)

  const aiSessions: Array<{ sessionId: string; raw: string }> = []
  const aiDirectory = join(userData, 'ai-history')
  if (existsSync(aiDirectory)) {
    const entries = await readdir(aiDirectory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const raw = await readFile(join(aiDirectory, entry.name), 'utf8')
      const encodedId = entry.name.slice(0, -'.jsonl'.length)
      let sessionId: string
      try {
        sessionId = decodeURIComponent(encodedId)
      } catch {
        sessionId = encodedId
      }
      aiSessions.push({ sessionId, raw })
    }
    pathsToArchive.push(aiDirectory)
  }

  const auditEvents: unknown[] = []
  const auditPath = join(userData, 'mcp-audit.jsonl')
  if (existsSync(auditPath)) {
    const raw = await readFile(auditPath, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        auditEvents.push(JSON.parse(line))
      } catch {
        // Keep the complete source file as a backup, but do not import malformed lines.
      }
    }
    pathsToArchive.push(auditPath)
  }

  return { settings, collections, aiSessions, auditEvents, pathsToArchive }
}

async function readJsonIfPresent(
  path: string,
  emptyValue: unknown,
  pathsToArchive: string[],
): Promise<unknown | undefined> {
  if (!existsSync(path)) return undefined
  pathsToArchive.push(path)
  const raw = await readFile(path, 'utf8')
  if (!raw.trim()) return emptyValue
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`Cannot migrate invalid JSON file ${basename(path)}`, { cause: error })
  }
}

function addArrayCollection(
  target: Map<string, Array<{ id: string; value: unknown }>>,
  collection: string,
  value: unknown,
): void {
  const records: Array<{ id: string; value: unknown }> = []
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (!isObject(item)) return
      const id = typeof item.id === 'string' && item.id ? item.id : `legacy-${index}`
      records.push({ id, value: item })
    })
  }
  target.set(collection, records)
}

async function archiveLegacyPaths(paths: string[]): Promise<void> {
  for (const source of paths) {
    if (!existsSync(source)) continue
    const backup = `${source}.pre-sqlite-v1.bak`
    if (existsSync(backup)) continue
    try {
      await rename(source, backup)
    } catch (error) {
      console.warn(`[Storage Migration] Could not archive ${source}:`, error)
    }
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}
