import { knowledgeAlwaysIncluded, knowledgeMode, type KnowledgeDocument, type KnowledgeMemoryEntry, type KnowledgeMode } from '../../../shared/aiKnowledge'

export type KnowledgeState = { enabled: boolean; mode?: KnowledgeMode; documents: KnowledgeDocument[] }
export const knowledgeInfo = ({ content: _content, history: _history, memoryEntries: _entries, system: _system, ...document }: KnowledgeDocument) => document
export const knowledgeVersion = ({ history: _history, ...document }: KnowledgeDocument) => document
export type KnowledgeIndex = { enabled: boolean; mode?: KnowledgeMode; documents: ReturnType<typeof knowledgeInfo>[]; summary: string; summaryLength: number; memoryEntries?: KnowledgeMemoryEntry[]; includedDocuments?: Array<{ id: string; title: string; content: string; totalChars: number }> }
export function knowledgeIndex(saved: KnowledgeState): KnowledgeIndex {
  const memory = saved.documents.find(item => item.id === 'memory')
  return { enabled: knowledgeMode(saved) !== 'off', mode: knowledgeMode(saved), documents: saved.documents.map(knowledgeInfo), summary: memory?.content.slice(0, 4000) || '', summaryLength: memory?.content.length || 0, memoryEntries: memory?.memoryEntries,
    includedDocuments: saved.documents.filter(doc => doc.id !== 'memory' && knowledgeAlwaysIncluded(doc)).map(doc => ({ id: doc.id, title: doc.title, content: doc.content.slice(0, 4000), totalChars: doc.content.length })) }
}
