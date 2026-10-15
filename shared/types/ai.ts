import type { AiToolPermissionMode, AiToolRisk, AiToolRunStatus } from '../aiToolPolicy'

export type { AiToolPermissionMode, AiToolRisk, AiToolRunStatus }

export interface AiModel {
  /** Requested output cap; also reserved when budgeting this model's context. */
  maxOutputTokens?: number
  /** Recent verbatim history budget. Unset uses a capacity-scaled default. */
  compactionRetainTokens?: number
  id: string
  /** Explicit capability override for custom models / compatible gateways. */
  supportsImages?: boolean
  displayName?: string
  /** Manual full context window override. Unset / 0 = automatic discovery. */
  contextWindowTokens?: number
  /** Cached provider metadata, kept separate from the user's override. */
  contextMetadata?: { modelId: string; tokens: number }
}

export interface AiDiscoveredModel {
  id: string
  contextWindowTokens?: number
}

export type AiProviderProtocol = 'openai' | 'anthropic'

/** Original Claude content blocks, including opaque thinking signatures. */
export type AiAnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

export interface AiProvider {
  /** Unset on older configurations means OpenAI compatible. */
  protocol?: AiProviderProtocol
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
  maxOutputTokens?: number
  compactionRetainTokens?: number
  protocol?: AiProviderProtocol
  supportsImages?: boolean
  maxToolRounds?: number
  baseUrl: string
  model: string
  apiKey: string
  systemPrompt: string
  temperature: number
  contextWindowTokens?: number
  toolPermission?: AiToolPermissionMode
}

/** Provider-neutral function call, using Chat Completions field names. */
export interface AiFunctionToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/**
 * Canonical model transcript, converted by the selected protocol adapter.
 * Claude's signed blocks accompany the assistant's display text and tool calls.
 */
export interface AiChatMessage {
  anthropicContent?: AiAnthropicContentBlock[]
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  images?: AiImageAttachment[]
  /** Assistant CoT. Sent as `reasoning_content` when the request includes tools. */
  reasoningContent?: string
  toolCalls?: AiFunctionToolCall[]
  toolCallId?: string
}

export interface AiUsage {
  promptTokens?: number
  /** Cache hits and misses are subsets of promptTokens, not extra tokens. */
  cachedPromptTokens?: number
  uncachedPromptTokens?: number
  /** Subset of uncachedPromptTokens written to Claude's prompt cache. */
  cacheCreationPromptTokens?: number
  completionTokens?: number
  totalTokens?: number
  /** Already included in completionTokens. */
  reasoningTokens?: number
  requestCount?: number
  usageIncomplete?: boolean
  cacheUsageIncomplete?: boolean
}

export interface AiToolRun {
  id: string
  name: string
  args: string
  content: string
  isError: boolean
  status?: AiToolRunStatus
  risk?: AiToolRisk
  jobIds?: string[]
  target?: string
  reason?: string
  /** One-line `+N / -M` summary for the pending file rewrite, if any. */
  diffSummary?: string
  /** Unified diff shown on the approval card when the call rewrites a file. */
  diffPreview?: string
}

export interface AiChatResult {
  contextCompacted?: boolean
  contextPressure?: AiContextPressure
  content: string
  backgroundNotice?: string
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
  /** Idle-session maintenance; creates no user or assistant history record. */
  compactOnly?: boolean
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
  /** Application-generated background results, separate from human input. */
  backgroundNotice?: string
  images?: AiImageAttachment[]
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

export interface AiBackgroundReplyEvent {
  sessionId: string
  threadId: string
  requestId: string
  record: AiHistoryRecord
}

/** Local content-addressed attachment; dataUrl exists only in memory / IPC. */
export interface AiImageAttachment {
  id: string
  name: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  dataUrl?: string
  missing?: boolean
}

/** Model-facing replacement for an older, still-retained span of one thread. */
export interface AiContextCheckpoint {
  compactionCount?: number
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
  /** Lifetime successful summary count, retained even if a checkpoint is invalidated. */
  compactionCount?: number
  id: string
  /** Display title, derived from the first user message unless customTitle is set. */
  title: string
  customTitle?: string
  pinned?: boolean
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
  customTitle?: string
  pinned?: boolean
  createdAt: number
  updatedAt: number
  messageCount: number
  contextFilePath?: string
  active: boolean
}

export interface AiContextPressure {
  usedTokens: number
  windowTokens: number
  outputReserveTokens: number
  inputBudgetTokens: number
  thresholdTokens: number
  retainTokens: number
}

export type AiChatStreamPayload =
  | { type: 'context-pressure'; value: AiContextPressure }
  | { type: 'model-status'; value: 'requesting' | 'waiting' | 'tool-input' | 'tool-prepare' }
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
        compactionCount?: number
      }
    }
  | {
      type: 'tool'
      value: {
        phase: 'start' | 'ask' | 'running' | 'done' | 'denied' | 'blocked' | 'reclassify' | 'aborted'
        id: string
        name: string
        args?: string
        content?: string
        isError?: boolean
        risk?: AiToolRisk
        jobIds?: string[]
        target?: string
        reason?: string
        status?: AiToolRunStatus
        /** One-line `+N / -M` summary for the pending file rewrite. */
        diffSummary?: string
        /** Unified diff for file rewrites, so approval is not blind. */
        diffPreview?: string
      }
    }
  | { type: 'done' }
