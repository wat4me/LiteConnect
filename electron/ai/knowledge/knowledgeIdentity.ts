import { createHash } from 'node:crypto'
import type { KnowledgeTarget } from '../../../shared/aiKnowledge'

export const knowledgeStorageKey = (server: KnowledgeTarget) => server.groupId
  ? `ai-knowledge-group-documents:${server.groupId}`
  : `ai-knowledge:${server.connectionId}:${createHash('sha256').update(JSON.stringify([server.host.toLowerCase(), server.port, server.username])).digest('hex')}`
export const knowledgeBinding = (server: KnowledgeTarget) => `${knowledgeStorageKey(server)}${server.groupId ? `:${server.groupRevision}` : ''}`
