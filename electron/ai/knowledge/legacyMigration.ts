import { createHash } from 'node:crypto'
import { KNOWLEDGE_MAX_BYTES, type KnowledgeTarget } from '../../../shared/aiKnowledge'
import { knowledgeStorageKey } from './knowledgeIdentity'
import { KnowledgeRepository, type KnowledgeDatabase } from './knowledgeRepository'

type Database = KnowledgeDatabase
const digest = (text: string) => createHash('sha256').update(text).digest('hex')

/** One-time local import. Legacy snapshots remain as recovery data, never model context. */
export function migrateLegacyKnowledge(database: Database, server: KnowledgeTarget, sources: Array<{ id: string; raw?: unknown; read?: () => unknown }>) {
  const key = knowledgeStorageKey(server)
  const repository = new KnowledgeRepository(() => database)
  for (const source of sources) {
    const marker = `ai-knowledge-import-v1:${digest(`${key}:${source.id}`)}`
    if (database.getSingleton(marker)) continue
    let raw = source.read ? source.read() : source.raw
    if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { continue } }
    if (!raw || typeof raw !== 'object') continue
    const store = raw as { defaultContextFiles?: unknown; threads?: Array<{ contextFiles?: unknown }> }
    const candidates = [store.defaultContextFiles, ...(Array.isArray(store.threads) ? store.threads.map(thread => thread?.contextFiles) : [])]
      .flatMap(files => Array.isArray(files) ? files : [])
      .filter((file): file is { source: 'local' | 'ssh'; path: string; content: string } => !!file && (file.source === 'local' || file.source === 'ssh') && typeof file.path === 'string' && typeof file.content === 'string' && !!file.content.trim() && !file.content.includes('\0') && Buffer.byteLength(file.content) <= KNOWLEDGE_MAX_BYTES)
    if (!candidates.length) { database.setSingleton(marker, { completedAt: Date.now() }); continue }
    database.transaction(() => {
      if (database.getSingleton(marker)) return
      const documents = repository.current(key)
      const contentHashes = new Set(documents.map(doc => digest(doc.content)))
      for (const file of candidates) {
        const hash = digest(file.content)
        if (contentHashes.has(hash)) continue
        const base = (file.path.split(/[\\/]/).pop() || 'Imported.md').replace(/[\0\r\n]/g, ' ').trim().slice(0, 110) || 'Imported.md'
        let title = base, number = 2
        while (documents.some(doc => doc.title === title)) title = `${base} (${number++})`
        // Migration may exceed the normal creation cap: never discard existing user content.
        const document = { id: `legacy-${digest(`${source.id}:${file.path}:${hash}`).slice(0, 32)}`, title,
          content: file.content, revision: 1, author: 'user' as const, updatedAt: Date.now(), history: [], alwaysInclude: false }
        repository.save(key, document)
        documents.push(document)
        contentHashes.add(hash)
      }
      database.setSingleton(marker, { completedAt: Date.now() })
    })
  }
}
