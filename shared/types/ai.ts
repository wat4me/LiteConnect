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
  /** Notify through the OS when an approval waits in a background window. */
  approvalNotifications?: boolean
  /** Maximum retained conversations for each SSH host's local AI history. */
  historyMaxThreads?: number
  /** Maximum retained messages in each SSH host conversation. */
  historyMaxMessages?: number
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
  /** Wall-clock time when this assistant turn finished. */
  completedAt?: number
  error?: boolean
  segments?: AiChatSegment[]
  reasoningContent?: string
  usage?: AiUsage
  toolRuns?: AiToolRun[]
  aborted?: boolean
  /** This turn's Chat Completions messages (assistant / tool / final assistant). */
  apiMessages?: AiChatMessage[]
  /** Active hidden projection after this request, when one exists. */
  contextCheckpoint?: AiContextCheckpoint
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
  /** Lifecycle state. Interrupted/running assistant turns are never replayed to the model. */
  status?: 'running' | 'completed' | 'aborted' | 'error'
  createdAt: number
  /** Assistant completion time. Absent on legacy history records. */
  completedAt?: number
  toolRuns?: AiToolRun[]
  segments?: AiChatSegment[]
  /** Wire transcript for this assistant turn; next request appends after it. */
  apiMessages?: AiChatMessage[]
}

/** Model-facing replacement for an older, still-retained span of one thread. */
export interface AiContextCheckpoint {
  version: 1
  /** Structured rolling summary. It is never rendered as a chat message. */
  summary: string
  /** Last history record covered by `summary` (inclusive). */
  throughMessageId: string
  createdAt: number
  /** Diagnostic estimates used for convergence checks and user feedback. */
  sourceTokens: number
  summaryTokens: number
  model?: string
}

/** A user-selected Markdown file captured as text for AI conversations. */
export interface AiConversationContextFile {
  source: 'local' | 'ssh'
  path: string
  content: string
}

export interface AiConversationThread {
  id: string
  /** First user message, verbatim. Always re-derived; never model-generated. */
  title: string
  createdAt: number
  updatedAt: number
  messages: AiHistoryRecord[]
  /** Derived model context. Full display history remains in `messages`. */
  contextCheckpoint?: AiContextCheckpoint
  contextFiles: AiConversationContextFile[]
}

export interface AiSessionStore {
  version: 1
  activeThreadId: string
  threads: AiConversationThread[]
  /** Host-scoped default copied into each new conversation; null disables inheritance. */
  defaultContextFiles: AiConversationContextFile[]
}

export interface AiThreadSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  contextFilePath?: string
  active: boolean
}

export type AiChatStreamPayload =
  | { type: 'content'; value: string }
  | { type: 'reasoning'; value: string }
  | { type: 'usage'; value: AiUsage }
  | {
      type: 'compaction'
      value: {
        phase: 'start' | 'done' | 'failed'
        beforeTokens: number
        afterTokens?: number
        budgetTokens: number
        compactedMessages?: number
      }
    }
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
