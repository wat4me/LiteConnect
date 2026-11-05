import type { KnowledgeTarget } from './aiKnowledge'

export type KnowledgeGroup = { id: string; name: string; members: KnowledgeTarget[]; revision: number }
export type KnowledgeGroupRequest = {
  action: 'overview' | 'create' | 'update' | 'delete'
  groupId?: string
  expectedRevision?: number
  name?: string
  connectionIds?: string[]
  memberTargets?: KnowledgeTarget[]
  initialContent?: string
  businessSystem?: boolean
}
export type KnowledgeGroupResponse = { groups: KnowledgeGroup[]; group?: KnowledgeGroup; targets?: KnowledgeTarget[] }
export const knowledgeGroupConnectionId = (id: string) => `knowledge-group:${id}`

/** Shared knowledge groups stay stored, but their screens stay closed until the product split from per-server knowledge is settled. */
export const KNOWLEDGE_GROUPS_ENABLED = false
