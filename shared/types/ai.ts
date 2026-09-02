import type { AiToolPermissionMode, AiToolRisk, AiToolRunStatus } from '../aiToolPolicy'

export type { AiToolPermissionMode, AiToolRisk, AiToolRunStatus }

export interface AiModel {
  id: string
  /** Full context window in tokens. Unset / 0 = models.dev default, else 300000. */
  contextWindowTokens?: number
}

export interface AiProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  models: AiModel[]
}

export interface AiSettings {
  providers: AiProvider[]
  activeProviderId: string | null
  activeModel: string
  systemPrompt: string
  /** 0–2, default 0.7 */
  temperature?: number
  /** @deprecated Prefer per-model contextWindowTokens. Kept as fallback when a model has none. */
  contextWindowTokens?: number
  /** Default ask: confirm remote/write tools before they run. */
  toolPermission?: AiToolPermissionMode
}

export interface AiResolvedConfig {
  baseUrl: string
  model: string
  apiKey: string
  systemPrompt: string
  temperature: number
  contextWindowTokens?: number
  toolPermission?: AiToolPermissionMode
}

export interface AiChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AiUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  reasoningTokens?: number
}

export interface AiToolRun {
  id: string
  name: string
  args: string
  content: string
  isError: boolean
  status?: AiToolRunStatus
  risk?: AiToolRisk
  reason?: string
}

export interface AiChatResult {
  content: string
  reasoningContent?: string
  usage?: AiUsage
  toolRuns?: AiToolRun[]
  aborted?: boolean
}

/**
 * Display timeline of one assistant reply, in true streaming order.
 * reasoning/content texts accumulate per contiguous block; tool entries
 * reference AiToolRun by id.
 */
export type AiChatSegment =
  | { kind: 'reasoning'; text: string }
  | { kind: 'content'; text: string }
  | { kind: 'tool'; runId: string }

export interface AiHistoryRecord {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoningContent?: string
  usage?: AiUsage
  error?: boolean
  createdAt: number
  toolRuns?: AiToolRun[]
  segments?: AiChatSegment[]
}

export interface AiConversationThread {
  id: string
  title: string
  /** True after model-generated title; provisional first-user-message titles stay false. */
  titleGenerated?: boolean
  createdAt: number
  updatedAt: number
  messages: AiHistoryRecord[]
}

export interface AiSessionStore {
  version: 1
  activeThreadId: string
  threads: AiConversationThread[]
}

export interface AiThreadSummary {
  id: string
  title: string
  titleGenerated?: boolean
  createdAt: number
  updatedAt: number
  messageCount: number
  active: boolean
}

export type AiChatStreamPayload =
  | { type: 'content'; value: string }
  | { type: 'reasoning'; value: string }
  | { type: 'usage'; value: AiUsage }
  | {
      type: 'tool'
      value: {
        phase: 'start' | 'ask' | 'running' | 'done' | 'denied' | 'blocked'
        id: string
        name: string
        args?: string
        content?: string
        isError?: boolean
        risk?: AiToolRisk
        reason?: string
        status?: AiToolRunStatus
      }
    }
  | { type: 'done' }
