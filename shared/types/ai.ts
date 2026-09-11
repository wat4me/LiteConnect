import type { AiToolPermissionMode, AiToolRisk, AiToolRunStatus } from '../aiToolPolicy'

export type { AiToolPermissionMode, AiToolRisk, AiToolRunStatus }

export interface AiModel {
  id: string
  displayName?: string
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
  /** Per user message, not individual tool count. */
  maxToolRounds?: number
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
  maxToolRounds?: number
  baseUrl: string
  model: string
  apiKey: string
  systemPrompt: string
  temperature: number
  contextWindowTokens?: number
  toolPermission?: AiToolPermissionMode
}

/** OpenAI Chat Completions function tool call. */
export interface AiFunctionToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/**
 * Chat Completions message as sent to the model.
 * Assistant turns with tools use `toolCalls`; results use `role: 'tool'`.
 */
export interface AiChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  /** Assistant CoT. Sent as `reasoning_content` when the request includes tools. */
  reasoningContent?: string
  toolCalls?: AiFunctionToolCall[]
  toolCallId?: string
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
  /** One-line `+N / -M` summary for the pending file rewrite, if any. */
  diffSummary?: string
  /** Unified diff shown on the approval card when the call rewrites a file. */
  diffPreview?: string
}

export interface AiChatResult {
  content: string
  error?: boolean
  segments?: AiChatSegment[]
  reasoningContent?: string
  usage?: AiUsage
  toolRuns?: AiToolRun[]
  aborted?: boolean
  /** This turn's Chat Completions messages (assistant / tool / final assistant). */
  apiMessages?: AiChatMessage[]
}

export interface AiChatStreamOptions {
  sessionId: string
  threadId: string
  assistantMessageId: string
  createdAt: number
  cwd?: string
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
  /** Wire transcript for this assistant turn; next request appends after it. */
  apiMessages?: AiChatMessage[]
}

export interface AiConversationThread {
  id: string
  /** First user message, verbatim. Always re-derived; never model-generated. */
  title: string
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
        phase: 'start' | 'ask' | 'running' | 'done' | 'denied' | 'blocked' | 'reclassify'
        id: string
        name: string
        args?: string
        content?: string
        isError?: boolean
        risk?: AiToolRisk
        reason?: string
        status?: AiToolRunStatus
        /** One-line `+N / -M` summary for the pending file rewrite. */
        diffSummary?: string
        /** Unified diff for file rewrites, so approval is not blind. */
        diffPreview?: string
      }
    }
  | { type: 'done' }
