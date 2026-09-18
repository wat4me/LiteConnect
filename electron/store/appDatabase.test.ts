import { mkdir, mkdtemp, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'
import {
  aiSessionKey,
  AppDatabase,
  COLLECTIONS,
  migrateLegacyStorage,
  SINGLETONS,
} from './appDatabase'

describe('AppDatabase', () => {
  it('stores collections transactionally and preserves order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'liteconnect-db-'))
    const db = new AppDatabase(join(dir, 'app.sqlite'))
    db.replaceCollection('items', [{ id: 'b' }, { id: 'a' }], (item) => item.id)
    expect(db.getCollection('items')).toEqual([{ id: 'b' }, { id: 'a' }])
    db.close()
  })

  it('migrates legacy files once and archives the sources', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'liteconnect-migrate-'))
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ theme: 'light' }))
    await writeFile(join(dir, 'connections.json'), JSON.stringify([{ id: 'ssh-1', name: 'Server' }]))
    await writeFile(join(dir, 'groups.json'), JSON.stringify([{ id: 'group-1', name: 'Prod' }]))
    await writeFile(join(dir, 'saved-credentials.json'), JSON.stringify([{ id: 'cred-1', username: 'root' }]))
    await writeFile(join(dir, 'db-connections.json'), JSON.stringify([{ id: 'db-1', engine: 'postgres' }]))
    await writeFile(join(dir, 'db-query-history.json'), JSON.stringify({ items: [{ id: 'query-1', sql: 'select 1' }] }))
    await writeFile(join(dir, 'shell-command-history.json'), JSON.stringify({
      version: 1,
      byConnection: { 'ssh-1': [{ command: 'pwd', at: 1 }] },
    }))
    await writeFile(join(dir, 'known_hosts.json'), JSON.stringify({
      '[example.com]:22': { fingerprint: 'SHA256:test', firstSeen: 1 },
    }))
    await writeFile(join(dir, 'mcp-audit.jsonl'), `${JSON.stringify({ ts: 2, method: 'tools/list', ok: true })}\n`)

    const db = new AppDatabase(join(dir, 'app.sqlite'))
    await migrateLegacyStorage(dir, db)
    expect(db.getSingleton(SINGLETONS.settings)).toEqual({ theme: 'light' })
    expect(db.getCollection(COLLECTIONS.sshConnections)).toEqual([{ id: 'ssh-1', name: 'Server' }])
    expect(db.getCollection(COLLECTIONS.sshGroups)).toEqual([{ id: 'group-1', name: 'Prod' }])
    expect(db.getCollection(COLLECTIONS.savedCredentials)).toEqual([{ id: 'cred-1', username: 'root' }])
    expect(db.getCollection(COLLECTIONS.dbConnections)).toEqual([{ id: 'db-1', engine: 'postgres' }])
    expect(db.getCollection(COLLECTIONS.dbQueryHistory)).toEqual([{ id: 'query-1', sql: 'select 1' }])
    expect(db.getCollection(COLLECTIONS.shellCommandHistory)).toEqual([
      { connectionId: 'ssh-1', items: [{ command: 'pwd', at: 1 }] },
    ])
    expect(db.listMcpAudit()).toEqual([{ ts: 2, method: 'tools/list', ok: true }])
    expect(db.getCollection(COLLECTIONS.knownHosts)).toEqual([{
      key: '[example.com]:22',
      entry: { fingerprint: 'SHA256:test', firstSeen: 1 },
    }])
    expect(JSON.parse(await readFile(join(dir, 'settings.json.pre-sqlite-v1.bak'), 'utf8')))
      .toEqual({ theme: 'light' })

    // A stale source appearing after migration must never overwrite current SQLite data.
    db.setSingleton(SINGLETONS.settings, { theme: 'dark' })
    await writeFile(join(dir, 'settings.json'), '{ stale and invalid')
    await migrateLegacyStorage(dir, db)
    expect(db.getSingleton(SINGLETONS.settings)).toEqual({ theme: 'dark' })
    db.close()
  })

  it('stores AI legacy content without losing the original representation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'liteconnect-ai-migrate-'))
    const aiDir = join(dir, 'ai-history')
    await mkdir(aiDir)
    const raw = `${JSON.stringify({ id: 'm1', role: 'user', content: 'hello', createdAt: 1 })}\n`
    await writeFile(join(aiDir, 'session-1.jsonl'), raw)
    const db = new AppDatabase(join(dir, 'app.sqlite'))
    await migrateLegacyStorage(dir, db)
    expect(db.getSingleton(aiSessionKey('session-1'))).toBe(raw)
    db.close()
  })

  it('leaves invalid legacy data untouched and allows a clean retry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'liteconnect-invalid-migrate-'))
    const source = join(dir, 'connections.json')
    await writeFile(source, '{ invalid')
    const db = new AppDatabase(join(dir, 'app.sqlite'))
    await expect(migrateLegacyStorage(dir, db)).rejects.toThrow('connections.json')
    expect(await readFile(source, 'utf8')).toBe('{ invalid')
    expect(db.getCollection(COLLECTIONS.sshConnections)).toEqual([])

    await writeFile(source, JSON.stringify([{ id: 'fixed' }]))
    await migrateLegacyStorage(dir, db)
    expect(db.getCollection(COLLECTIONS.sshConnections)).toEqual([{ id: 'fixed' }])
    db.close()
  })
})
