import {
  estimateTokens,
  messageTokens,
  truncateToTokenBudget,
} from './aiContext'
import { flattenConversationForApi } from './aiMessages'
import { aiBackgroundResultNotices } from './aiBackgroundResults'
import { AI_QUESTION_TOOL, AI_QUESTION_ARGS_MAX } from './aiQuestions'
import { interruptedAiExecutionEvidence } from './aiExecutionEvidence'
import { sharedT, type SharedTranslate } from './i18n'
import type {
  AiChatMessage,
  AiContextCheckpoint,
  AiHistoryRecord,
  AiToolRun,
} from './types/ai'

import { AI_COMPACTION_RETAIN_RATIO } from './aiContextPressure'
export { AI_COMPACTION_THRESHOLD_RATIO, AI_COMPACTION_RETAIN_RATIO } from './aiContextPressure'
export const AI_COMPACTION_NEW_THREAD_AT = 3

export function normalizeAiCompactionCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1_000_000, Math.floor(value))) : 0
}
export const AI_COMPACTION_TOOL_THRESHOLD_CHARS = 8_192
export const AI_COMPACTION_TOOL_HEAD_CHARS = 4_096
export const AI_COMPACTION_TOOL_TAIL_CHARS = 1_024

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

export function pruneAiToolResultText(text: string, translate: SharedTranslate = sharedT): string {
  const chars = codePoints(text)
  if (chars.length <= AI_COMPACTION_TOOL_THRESHOLD_CHARS) return text
  return chars.slice(0, AI_COMPACTION_TOOL_HEAD_CHARS).join('')
    + translate('sharedText.promptPruneMarker')
    + chars.slice(-AI_COMPACTION_TOOL_TAIL_CHARS).join('')
}

/** Model-only projection; persisted tool output remains full fidelity. */
export function pruneAiToolResultsForContext(messages: readonly AiChatMessage[], translate: SharedTranslate = sharedT): {
  messages: AiChatMessage[]
  prunedCount: number
} {
  let prunedCount = 0
  const next = messages.map((message): AiChatMessage => {
    if (message.role !== 'tool') return { ...message }
    const content = pruneAiToolResultText(message.content || '', translate)
    if (content !== message.content) prunedCount += 1
    return { ...message, content }
  })
  return { messages: next, prunedCount }
}

export function frameAiContextCheckpoint(summary: string, translate: SharedTranslate = sharedT): AiChatMessage {
  return {
    role: 'user',
    content: `${translate('sharedText.promptCheckpointPreamble')}\n\n<compacted-summary>\n${summary.trim()}\n</compacted-summary>`,
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
  translate: SharedTranslate = sharedT,
): AiChatMessage[] {
  const checkpointIndex = findAiCheckpointIndex(records, checkpoint)
  if (checkpointIndex < 0 || !checkpoint) return flattenConversationForApi([...records])
  return [
    frameAiContextCheckpoint(checkpoint.summary, translate),
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
  retainedTokenBudget = Math.max(256, Math.floor(promptBudgetTokens * AI_COMPACTION_RETAIN_RATIO)),
  translate: SharedTranslate = sharedT,
): AiCompactionPlan | null {
  const checkpointIndex = findAiCheckpointIndex(records, checkpoint)
  const firstCandidate = checkpointIndex >= 0 ? checkpointIndex + 1 : 0
  if (firstCandidate >= records.length) return null

  const retainTokens = retainedTokenBudget
  const turns: Array<{ start: number; tokens: number }> = []
  for (let index = firstCandidate; index < records.length; index += 1) {
    if (records[index].role === 'user' || !turns.length) turns.push({ start: index, tokens: 0 })
    turns[turns.length - 1].tokens += recordTokenCount(records[index])
  }
  let retained = 0
  let keepFrom = records.length
  for (const turn of turns.reverse()) {
    // Keep the newest whole turn, then add older turns only while they fit.
    if (retained && retained + turn.tokens > retainTokens) break
    retained += turn.tokens
    keepFrom = turn.start
  }

  // A user record starts a whole conversational turn. Move left rather than
  // splitting its assistant/tool transcript from the prompt that caused it.
  while (keepFrom > firstCandidate && records[keepFrom]?.role !== 'user') keepFrom -= 1
  const endIndex = keepFrom - 1
  if (endIndex < firstCandidate) return null

  const selected = records.slice(firstCandidate, endIndex + 1)
  const sourceMessages = [
    ...(checkpointIndex >= 0 && checkpoint
      ? [frameAiContextCheckpoint(checkpoint.summary, translate)]
      : []),
    ...flattenConversationForApi(selected),
  ]
  return {
    ...(checkpointIndex >= 0 && checkpoint ? { previousSummary: checkpoint.summary } : {}),
    records: [...selected],
    recentMessages: flattenConversationForApi(records.slice(endIndex + 1)),
    throughMessageId: records[endIndex].id,
    coveredMessageCount: endIndex + 1,
    sourceTokens: aiMessagesTokenCount(pruneAiToolResultsForContext(sourceMessages, translate).messages),
  }
}

function toolRunText(run: AiToolRun, translate: SharedTranslate): string {
  if (run.name === AI_QUESTION_TOOL) return translate('sharedText.promptSummaryQuestion', { args: run.args.slice(0, AI_QUESTION_ARGS_MAX), answer: run.content || translate('sharedText.promptNoAnswer') })
  const args = run.args ? translate('sharedText.promptSummaryArgs', { args: run.args.slice(0, 4_000) }) : ''
  const result = pruneAiToolResultText(run.content || '', translate)
  const stateKey = run.content.startsWith('QUESTION_BATCH_DEFERRED:') || ['ask', 'denied', 'blocked', 'reclassify'].includes(run.status || '') ? 'sharedText.promptStateNotExecuted'
    : run.status !== 'done' || run.content.startsWith('TOOL_RESULT_UNKNOWN:') ? 'sharedText.promptStateUnknown'
      : run.isError ? 'sharedText.promptStateToolError' : run.jobIds?.length ? 'sharedText.promptStateBackground' : 'sharedText.promptStateReturned'
  return translate('sharedText.promptSummaryTool', { name: run.name, target: run.target ? translate('sharedText.promptSummaryTarget', { target: run.target }) : '', args, state: translate(stateKey), result: result || '(empty)' })
}

/** Text-only, bounded source for the private summarizer request. */
export function aiHistoryRecordForSummary(
  record: AiHistoryRecord,
  maxTokens: number,
  translate: SharedTranslate = sharedT,
): AiChatMessage | null {
  if (record.status === 'running') return null
  if (record.role === 'assistant' && (record.error || record.status === 'error' || record.status === 'aborted')) {
    const evidence = interruptedAiExecutionEvidence(record.toolRuns || [])
    const content = truncateToTokenBudget([...aiBackgroundResultNotices(record), evidence].filter(Boolean).join('\n\n'), maxTokens)
    return content.trim() ? { role: 'user', content } : null
  }
  if (record.role === 'user') {
    const imageNote = record.images?.length ? translate('sharedText.promptSummaryImages', { names: record.images.map(image => image.name).join(translate('sharedText.listSeparator')) }) : ''
    const content = truncateToTokenBudget((record.content || '') + imageNote, maxTokens)
    return content.trim() || record.images?.length
      ? { role: 'user', content, ...(record.images?.length ? { images: record.images } : {}) } : null
  }

  const parts: string[] = []
  for (const notice of aiBackgroundResultNotices(record)) parts.push(translate('sharedText.promptSummaryBackground', { notice }))
  if (record.content?.trim()) parts.push(translate('sharedText.promptSummaryAssistant', { content: record.content }))
  for (const run of record.toolRuns || []) parts.push(toolRunText(run, translate))
  if (!parts.length && record.apiMessages?.length) {
    for (const message of record.apiMessages) {
      if (message.role === 'tool') {
        parts.push(translate('sharedText.promptSummaryToolResult', { content: pruneAiToolResultText(message.content || '', translate) }))
      } else if (message.role === 'assistant' && message.content?.trim()) {
        parts.push(translate('sharedText.promptSummaryAssistant', { content: message.content }))
      }
    }
  }
  const content = truncateToTokenBudget(parts.join('\n\n'), maxTokens)
  return content.trim() ? { role: 'assistant', content } : null
}

export function aiCheckpointSummaryTokens(summary: string, translate: SharedTranslate = sharedT): number {
  return estimateTokens(frameAiContextCheckpoint(summary, translate).content)
}
