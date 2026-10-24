import type { AiHistoryRecord, AiConversationContextFile, AiContextCheckpoint, AiContextPressure, AiImageAttachment, AiThreadSummary } from '@shared/types/ai'
import type { AiChatActivity } from '@/utils/ai/chatActivity'

/** Display state extends the canonical history contract with renderer-only activity. */
export interface ChatItem extends AiHistoryRecord {
  streaming?: boolean
  activity?: AiChatActivity
}

/** In-memory answer only; never part of model input or persisted history. */
export interface AiQuestionDraft {
  threadId: string
  requestId: string | null
  args: string
  selected: Record<string, string[]>
  text: Record<string, string>
  custom: Record<string, boolean>
  currentIndex: number
}

export type AiSessionState = {
  questionDrafts?: Map<string, AiQuestionDraft>
  toolGroups?: import('@shared/aiToolCatalog').AiToolGroup[]
  compactionCount: number
  draftImages: AiImageAttachment[]
  messages: ChatItem[]
  input: string
  loading: boolean
  persisting: boolean
  activeThreadId: string
  threads: AiThreadSummary[]
  activeRequestId: string | null
  loaded: boolean
  disposeAfterReply: boolean
  contextCheckpoint?: AiContextCheckpoint
  contextPressure?: AiContextPressure
  contextFiles: AiConversationContextFile[]
  defaultContextFiles: AiConversationContextFile[]
}
