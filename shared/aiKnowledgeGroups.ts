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
