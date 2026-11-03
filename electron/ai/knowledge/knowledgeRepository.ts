import type { AppDatabase } from '../../store/appDatabase'
import { knowledgeAlwaysIncluded, knowledgeMode, type KnowledgeDocument, type KnowledgeMode, type KnowledgeVersion } from '../../../shared/aiKnowledge'
import { knowledgeIndex, knowledgeInfo, knowledgeVersion, type KnowledgeIndex, type KnowledgeState } from './knowledgeIndex'

export type KnowledgeDatabase = Pick<AppDatabase, 'getSingleton' | 'setSingleton' | 'transaction'> & Partial<Pick<AppDatabase, 'getDocument' | 'setDocument' | 'deleteDocument' | 'deleteSingleton' | 'getSingletonRevision'>>
type Metadata = KnowledgeIndex & { storageVersion: 2 }
type Marker = { storageVersion: 2; enabled: boolean; mode?: KnowledgeMode; documentIds: string[] }
type Current = Omit<KnowledgeDocument, 'history'> & { historyRevisions: number[] }
const CURRENT = 'ai-knowledge-documents-v2', HISTORY = 'ai-knowledge-history-v2'
const empty = (): Metadata => ({ ...knowledgeIndex({ enabled: false, documents: [] }), storageVersion: 2 })
const recordId = (scope: string, id: string, revision?: number) => JSON.stringify(revision === undefined ? [scope, id] : [scope, id, revision])
const fail = (): never => { throw new Error('KNOWLEDGE_UNAVAILABLE') }

/** SQLite indexes locate individual records; no document read parses another document's history. */
export class KnowledgeRepository {
  constructor(private readonly database: () => KnowledgeDatabase) {}
  private get<T>(collection: string, id: string): T | undefined {
    const db = this.database()
    return db.getDocument ? db.getDocument<T>(collection, id) : db.getSingleton<T>(`${collection}:${id}`)
  }
  private set(collection: string, id: string, value: unknown, order = 0) {
    const db = this.database()
    if (db.setDocument) db.setDocument(collection, id, value, order)
    else db.setSingleton(`${collection}:${id}`, value)
  }
  private remove(collection: string, id: string) {
    const db = this.database()
    if (db.deleteDocument) db.deleteDocument(collection, id)
    else if (db.deleteSingleton) db.deleteSingleton(`${collection}:${id}`)
    else db.setSingleton(`${collection}:${id}`, null)
  }
  index(scope: string): KnowledgeIndex {
    const db = this.database(), cached = db.getSingleton<Metadata>(`index:${scope}`)
    if (cached) return cached
    const saved = db.getSingleton<KnowledgeState | Marker>(scope)
    if (saved && 'storageVersion' in saved) return this.ensure(scope)
    return saved ? knowledgeIndex(saved as KnowledgeState) : empty()
  }
  private persistIndex(scope: string, index: Metadata) {
    const db = this.database()
    db.setSingleton(scope, { storageVersion: 2, enabled: index.enabled, mode: index.mode, documentIds: index.documents.map(doc => doc.id) } satisfies Marker)
    db.setSingleton(`index:${scope}`, index)
  }
  private ensure(scope: string): Metadata {
    const db = this.database(), cached = db.getSingleton<Metadata>(`index:${scope}`)
    if (cached?.storageVersion === 2) return cached
    return db.transaction(() => {
      const current = db.getSingleton<Metadata>(`index:${scope}`)
      if (current?.storageVersion === 2) return current
      const saved = db.getSingleton<KnowledgeState | Marker>(scope)
      if (!saved) return empty()
      if ('storageVersion' in saved) {
        const documents = saved.documentIds.map(id => {
          const record = this.get<Current>(CURRENT, recordId(scope, id)) || fail()
          const { historyRevisions: _revisions, ...document } = record
          return { ...document, history: [] }
        })
        const index: Metadata = { ...knowledgeIndex({ enabled: saved.enabled, mode: saved.mode, documents }), storageVersion: 2 }
        this.persistIndex(scope, index)
        return index
      }
      for (const document of saved.documents) {
        for (const version of document.history) this.set(HISTORY, recordId(scope, document.id, version.revision), version, version.revision)
        this.set(CURRENT, recordId(scope, document.id), { ...knowledgeVersion(document), historyRevisions: document.history.map(version => version.revision) })
      }
      const index: Metadata = { ...knowledgeIndex(saved), storageVersion: 2 }
      this.persistIndex(scope, index)
      return index
    })
  }
  read(scope: string, id: string, history = false): KnowledgeDocument | undefined {
    const index = this.ensure(scope)
    if (!index.documents.some(document => document.id === id)) return undefined
    return this.readStored(scope, id, history)
  }
  private readStored(scope: string, id: string, history = false): KnowledgeDocument {
    const stored = this.get<Current>(CURRENT, recordId(scope, id)) || fail()
    const { historyRevisions, ...document } = stored
    return { ...document, history: history ? historyRevisions.map(revision => this.get<KnowledgeVersion>(HISTORY, recordId(scope, id, revision)) || fail()) : [] }
  }
  version(scope: string, id: string, revision: number): KnowledgeVersion | undefined {
    this.ensure(scope)
    const current = this.get<Current>(CURRENT, recordId(scope, id))
    return current?.historyRevisions.includes(revision) ? this.get<KnowledgeVersion>(HISTORY, recordId(scope, id, revision)) : undefined
  }
  list(scope: string) { return this.index(scope).documents }
  current(scope: string): KnowledgeDocument[] { return this.ensure(scope).documents.map(document => this.readStored(scope, document.id)) }
  snapshot(scope: string): KnowledgeState | undefined {
    if (!this.database().getSingleton(scope)) return undefined
    const index = this.ensure(scope)
    return { enabled: index.enabled, mode: index.mode, documents: index.documents.map(document => this.readStored(scope, document.id, true)) }
  }
  setMode(scope: string, mode: KnowledgeMode) {
    this.database().transaction(() => this.persistIndex(scope, { ...this.ensure(scope), enabled: mode !== 'off', mode }))
  }
  save(scope: string, document: KnowledgeDocument) {
    this.database().transaction(() => {
      const index = this.ensure(scope), previous = this.get<Current>(CURRENT, recordId(scope, document.id))
      let revisions = previous?.historyRevisions || []
      if (previous) {
        const { historyRevisions: _revisions, ...version } = previous
        this.set(HISTORY, recordId(scope, document.id, version.revision), version, version.revision)
        revisions = [...revisions, version.revision]
      }
      for (const revision of revisions.slice(0, Math.max(0, revisions.length - 5))) this.remove(HISTORY, recordId(scope, document.id, revision))
      this.set(CURRENT, recordId(scope, document.id), { ...knowledgeVersion(document), historyRevisions: revisions.slice(-5) })
      const infos = index.documents.some(info => info.id === document.id) ? index.documents.map(info => info.id === document.id ? knowledgeInfo(document) : info) : [...index.documents, knowledgeInfo(document)]
      const pinned = (index.includedDocuments || []).filter(info => info.id !== document.id)
      if (document.id !== 'memory' && knowledgeAlwaysIncluded(document)) pinned.push({ id: document.id, title: document.title, content: document.content.slice(0, 4000), totalChars: document.content.length })
      const order = new Map(infos.map((info, i) => [info.id, i]))
      pinned.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
      this.persistIndex(scope, { ...index, documents: infos, includedDocuments: pinned,
        ...(document.id === 'memory' ? { summary: document.content.slice(0, 4000), summaryLength: document.content.length, memoryEntries: document.memoryEntries } : {}) })
    })
  }
  delete(scope: string, id: string) {
    this.database().transaction(() => {
      const index = this.ensure(scope), document = this.get<Current>(CURRENT, recordId(scope, id))
      for (const revision of document?.historyRevisions || []) this.remove(HISTORY, recordId(scope, id, revision))
      this.remove(CURRENT, recordId(scope, id))
      this.persistIndex(scope, { ...index, documents: index.documents.filter(document => document.id !== id), includedDocuments: index.includedDocuments?.filter(document => document.id !== id), ...(id === 'memory' ? { summary: '', summaryLength: 0, memoryEntries: undefined } : {}) })
    })
  }
  initialize(scope: string, state: KnowledgeState) {
    this.database().transaction(() => {
      for (const document of this.list(scope)) this.delete(scope, document.id)
      this.persistIndex(scope, { ...empty(), enabled: knowledgeMode(state) !== 'off', mode: knowledgeMode(state) })
      for (const document of state.documents) {
        for (const version of document.history) this.set(HISTORY, recordId(scope, document.id, version.revision), version, version.revision)
        this.set(CURRENT, recordId(scope, document.id), { ...knowledgeVersion(document), historyRevisions: document.history.map(version => version.revision) })
      }
      this.persistIndex(scope, { ...knowledgeIndex(state), storageVersion: 2 })
    })
  }
}
