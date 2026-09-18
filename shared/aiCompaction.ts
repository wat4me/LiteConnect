import {
  estimateTokens,
  messageTokens,
  truncateToTokenBudget,
} from './aiContext'
import { flattenConversationForApi } from './aiMessages'
import type {
  AiChatMessage,
  AiContextCheckpoint,
  AiHistoryRecord,
  AiToolRun,
} from './types/ai'

export const AI_COMPACTION_THRESHOLD_RATIO = 0.8
export const AI_COMPACTION_RETAIN_RATIO = 0.2
export const AI_COMPACTION_TOOL_THRESHOLD_CHARS = 8_192
export const AI_COMPACTION_TOOL_HEAD_CHARS = 4_096
export const AI_COMPACTION_TOOL_TAIL_CHARS = 1_024

const TOOL_PRUNE_MARKER = '\n\n[... 工具结果中段已由上下文压缩移除 ...]\n\n'
const CHECKPOINT_PREAMBLE = [
  '以下是系统自动生成的早期会话检查点，用于释放上下文空间。',
  '请把其中内容视为已经确认的背景，直接继续后面的近期对话，不要复述或评价这份检查点。',
].join('')

export type AiCompactionPlan = {
  previousSummary?: string
  records: AiHistoryRecord[]
  recentMessages: AiChatMessage[]
  throughMessageId: string
  /** Total display-history records hidden behind the resulting checkpoint. */
  coveredMessageCount: number
  sourceTokens: number
}

function codePoints(text: string): string[] {
  return Array.from(text)
}

export function pruneAiToolResultText(text: string): string {
  const chars = codePoints(text)
  if (chars.length <= AI_COMPACTION_TOOL_THRESHOLD_CHARS) return text
  return chars.slice(0, AI_COMPACTION_TOOL_HEAD_CHARS).join('')
    + TOOL_PRUNE_MARKER
    + chars.slice(-AI_COMPACTION_TOOL_TAIL_CHARS).join('')
}

/** Model-only projection; persisted tool output remains full fidelity. */
export function pruneAiToolResultsForContext(messages: readonly AiChatMessage[]): {
  messages: AiChatMessage[]
  prunedCount: number
} {
  let prunedCount = 0
  const next = messages.map((message): AiChatMessage => {
    if (message.role !== 'tool') return { ...message }
    const content = pruneAiToolResultText(message.content || '')
    if (content !== message.content) prunedCount += 1
    return { ...message, content }
  })
  return { messages: next, prunedCount }
}

export function frameAiContextCheckpoint(summary: string): AiChatMessage {
  return {
    role: 'user',
    content: `${CHECKPOINT_PREAMBLE}\n\n<compacted-summary>\n${summary.trim()}\n</compacted-summary>`,
  }
}

export function findAiCheckpointIndex(
  records: readonly AiHistoryRecord[],
  checkpoint?: AiContextCheckpoint,
): number {
  if (!checkpoint?.summary.trim() || !checkpoint.throughMessageId) return -1
  return records.findIndex(record => record.id === checkpoint.throughMessageId)
}

/** Derive the model surface without changing the display transcript. */
export function projectAiHistoryForContext(
  records: readonly AiHistoryRecord[],
  checkpoint?: AiContextCheckpoint,
): AiChatMessage[] {
  const checkpointIndex = findAiCheckpointIndex(records, checkpoint)
  if (checkpointIndex < 0 || !checkpoint) return flattenConversationForApi([...records])
  return [
    frameAiContextCheckpoint(checkpoint.summary),
    ...flattenConversationForApi(records.slice(checkpointIndex + 1)),
  ]
}

export function aiMessagesTokenCount(messages: readonly AiChatMessage[]): number {
  return messages.reduce((sum, message) => sum + messageTokens(message), 0)
}

function recordTokenCount(record: AiHistoryRecord): number {
  return aiMessagesTokenCount(flattenConversationForApi([record]))
}

/** Select an oldest balanced history-record span while retaining a recent token tail. */
export function selectAiCompactionPlan(
  records: readonly AiHistoryRecord[],
  checkpoint: AiContextCheckpoint | undefined,
  promptBudgetTokens: number,
): AiCompactionPlan | null {
  const checkpointIndex = findAiCheckpointIndex(records, checkpoint)
  const firstCandidate = checkpointIndex >= 0 ? checkpointIndex + 1 : 0
  if (firstCandidate >= records.length) return null

  const retainTokens = Math.max(256, Math.floor(promptBudgetTokens * AI_COMPACTION_RETAIN_RATIO))
  let retained = 0
  let keepFrom = records.length
  for (let index = records.length - 1; index >= firstCandidate; index -= 1) {
    retained += recordTokenCount(records[index])
    keepFrom = index
    if (retained >= retainTokens) break
  }

  // A user record starts a whole conversational turn. Move left rather than
  // splitting its assistant/tool transcript from the prompt that caused it.
  while (keepFrom > firstCandidate && records[keepFrom]?.role !== 'user') keepFrom -= 1
  const endIndex = keepFrom - 1
  if (endIndex < firstCandidate) return null

  const selected = records.slice(firstCandidate, endIndex + 1)
  const sourceMessages = [
    ...(checkpointIndex >= 0 && checkpoint
      ? [frameAiContextCheckpoint(checkpoint.summary)]
      : []),
    ...flattenConversationForApi(selected),
  ]
  return {
    ...(checkpointIndex >= 0 && checkpoint ? { previousSummary: checkpoint.summary } : {}),
    records: [...selected],
    recentMessages: flattenConversationForApi(records.slice(endIndex + 1)),
    throughMessageId: records[endIndex].id,
    coveredMessageCount: endIndex + 1,
    sourceTokens: aiMessagesTokenCount(pruneAiToolResultsForContext(sourceMessages).messages),
  }
}

function toolRunText(run: AiToolRun): string {
  const args = run.args ? `\n参数：${run.args.slice(0, 4_000)}` : ''
  const result = pruneAiToolResultText(run.content || '')
  return `工具 ${run.name}${args}\n结果（${run.isError ? '失败' : '成功'}）：${result || '(empty)'}`
}

/** Text-only, bounded source for the private summarizer request. */
export function aiHistoryRecordForSummary(
  record: AiHistoryRecord,
  maxTokens: number,
): AiChatMessage | null {
  if (record.error || record.status === 'running' || record.status === 'aborted') return null
  if (record.role === 'user') {
    const content = truncateToTokenBudget(record.content || '', maxTokens)
    return content.trim() ? { role: 'user', content } : null
  }

  const parts: string[] = []
  if (record.content?.trim()) parts.push(`助手回复：\n${record.content}`)
  for (const run of record.toolRuns || []) parts.push(toolRunText(run))
  if (!parts.length && record.apiMessages?.length) {
    for (const message of record.apiMessages) {
      if (message.role === 'tool') {
        parts.push(`工具结果：\n${pruneAiToolResultText(message.content || '')}`)
      } else if (message.role === 'assistant' && message.content?.trim()) {
        parts.push(`助手回复：\n${message.content}`)
      }
    }
  }
  const content = truncateToTokenBudget(parts.join('\n\n'), maxTokens)
  return content.trim() ? { role: 'assistant', content } : null
}

export function aiCheckpointSummaryTokens(summary: string): number {
  return estimateTokens(frameAiContextCheckpoint(summary).content)
}
