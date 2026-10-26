import { t } from '../../i18n'
import {
  aiCheckpointSummaryTokens,
  aiHistoryRecordForSummary,
  aiMessagesTokenCount,
  frameAiContextCheckpoint,
  findAiCheckpointIndex,
  projectAiHistoryForContext,
  pruneAiToolResultsForContext,
  selectAiCompactionPlan,
  normalizeAiCompactionCount,
} from '../../../shared/aiCompaction'
import { aiToolSchemaTokens, measureAiContextPressure, resolveAiContextBudget } from '../../../shared/aiContextPressure'
import { flattenConversationForApi } from '../../../shared/aiMessages'
import type { AiFunctionTool } from '../providers/types'
import {
  messageTokens,
  resolveContextWindowTokens,
  truncateToTokenBudget,
} from '../../../shared/aiContext'
import type {
  AiChatMessage,
  AiChatStreamPayload,
  AiContextCheckpoint,
  AiHistoryRecord,
  AiResolvedConfig,
  AiUsage,
} from '../../../shared/types/ai'
import { readHttpErrorMessage } from '../providers/http'
import { getAiProviderAdapter } from '../providers/registry'

type ContextCompactionOptions = {
  force?: boolean
  /** Live tool exchanges or new application events; never checkpointed as history. */
  continuation?: AiChatMessage[]
  compactionCount?: number
  records: AiHistoryRecord[]
  checkpoint?: AiContextCheckpoint
  settings: AiResolvedConfig
  extraSystem?: string
  tools?: unknown
  signal: AbortSignal
  emit: (payload: AiChatStreamPayload) => void
  onUsage?: (usage: AiUsage | undefined) => void
  saveCheckpoint: (checkpoint: AiContextCheckpoint) => Promise<void>
}

/** Reduce completed exchanges inside a long live turn without rewriting its audit transcript. */
export async function compactAiLiveMessages(opts: Omit<ContextCompactionOptions, 'records' | 'saveCheckpoint' | 'checkpoint'> & {
  messages: AiChatMessage[]
}): Promise<AiChatMessage[]> {
  const measure = (messages: AiChatMessage[]) => measureAiContextPressure({
    ...opts.settings, extraSystem: opts.extraSystem, toolSchemaTokens: aiToolSchemaTokens(opts.tools), messages,
  })
  const before = measure(opts.messages)
  if (!opts.force && before.usedTokens < before.thresholdTokens) return opts.messages
  const pruned = pruneAiToolResultsForContext(opts.messages, t).messages
  if (!opts.force && measure(pruned).usedTokens < before.thresholdTokens) return pruned

  // A unit contains an assistant's calls and every following tool result.
  const units: AiChatMessage[][] = []
  for (const message of pruned.filter(message => message.role !== 'system')) {
    if (message.role === 'tool' && units.length) units[units.length - 1].push(message)
    else units.push([message])
  }
  let split = units.length
  let retained = 0
  while (split > 0) {
    const tokens = aiMessagesTokenCount(units[split - 1])
    if (retained && retained + tokens > before.retainTokens) break
    retained += tokens
    split -= 1
  }
  if (!split || split === units.length) return pruned
  const older = units.slice(0, split).flat()
  const recent = units.slice(split).flat()
  let completed = false
  opts.emit({ type: 'compaction', value: { phase: 'start', beforeTokens: before.usedTokens, budgetTokens: before.inputBudgetTokens } })
  try {
    opts.signal.throwIfAborted()
    const maxTokens = maxSummaryOutputTokens(before.windowTokens)
    const system = [opts.settings.systemPrompt, opts.extraSystem].filter(text => text?.trim()).join('\n\n') || t('sharedText.promptSummarySystem')
    const source = older.map(({ reasoningContent: _reasoning, anthropicContent: _blocks, ...message }) => message)
    const input: AiChatMessage[] = [{ role: 'system', content: system }, ...source, { role: 'user', content: `${t('sharedText.promptSummaryInstruction')}\n${t('sharedText.promptSummarySystem')}` }]
    if (aiMessagesTokenCount(input) + aiToolSchemaTokens(opts.tools) > before.windowTokens - maxTokens - 256) return pruned
    const summary = await requestSummary(opts.settings, input, maxTokens, opts.signal, opts.onUsage, opts.tools as AiFunctionTool[] | undefined)
    const next = [frameAiContextCheckpoint(summary, t), ...recent]
    const after = measure(next)
    if (after.usedTokens >= before.usedTokens || aiCheckpointSummaryTokens(summary, t) >= aiMessagesTokenCount(older)) throw new Error('Live context compaction did not shrink its source')
    completed = true
    opts.emit({ type: 'compaction', value: { phase: 'done', beforeTokens: before.usedTokens, afterTokens: after.usedTokens, budgetTokens: before.inputBudgetTokens, compactedMessages: older.length } })
    return next
  } catch (error) {
    if (opts.signal.aborted) throw error
    console.warn('Live AI context compaction failed:', error)
    return pruned
  } finally {
    // A failed/oversized summary must also close the renderer's progress notice.
    if (!completed) opts.emit({ type: 'compaction', value: { phase: 'failed', beforeTokens: before.usedTokens, budgetTokens: before.inputBudgetTokens } })
  }
}

export type PreparedAiContext = {
  compacted?: boolean
  messages: AiChatMessage[]
  checkpoint?: AiContextCheckpoint
}

function maxSummaryOutputTokens(contextWindow: number): number {
  return Math.max(512, Math.min(8_192, Math.floor(contextWindow * 0.08)))
}

function summarySystemPrompt(contextWindow: number): string {
  return truncateToTokenBudget(
    t('sharedText.promptSummarySystem'),
    Math.max(256, Math.min(2_000, Math.floor(contextWindow * 0.12))),
  )
}

async function requestSummary(
  settings: AiResolvedConfig,
  messages: AiChatMessage[],
  maxTokens: number,
  signal: AbortSignal,
  onUsage?: (usage: AiUsage | undefined) => void,
  tools?: AiFunctionTool[],
): Promise<string> {
  const provider = getAiProviderAdapter(settings.protocol)
  const request = provider.buildRequest(settings, messages, { stream: false, maxTokens, temperature: 0.1, tools })
  const response = await fetch(request.url, {
    method: 'POST',
    signal,
    headers: request.headers,
    body: request.body,
  })
  if (!response.ok) {
    throw new Error(await readHttpErrorMessage(response, `AI compaction failed (${response.status})`))
  }
  const data = await response.json()
  const reply = provider.parseResponse(settings, data)
  onUsage?.(reply.usage)
  const finish = String(reply.finishReason || '').toLowerCase()
  if (finish === 'tool_calls' || finish === 'tool_use' || reply.apiMessages?.some(message => message.toolCalls?.length)) {
    throw new Error('AI compaction returned tool calls instead of a summary')
  }
  if (finish === 'length' || finish === 'max_tokens') {
    throw new Error('AI compaction summary reached its output limit')
  }
  const summary = reply.content.trim()
  if (!summary) throw new Error('AI compaction returned an empty summary')
  return summary
}

async function summarizePlan(
  opts: ContextCompactionOptions,
  promptBudget: number,
  contextWindow: number,
  records: AiHistoryRecord[],
  previousSummary?: string,
): Promise<string> {
  const outputTokens = maxSummaryOutputTokens(contextWindow)
  // Preserve the normal request prefix when the old span fits in one summary call.
  // Reasoning remains private; only operational evidence is condensed.
  const system = [opts.settings.systemPrompt, opts.extraSystem].filter(text => text?.trim()).join('\n\n') || t('sharedText.promptSummarySystem')
  const source = pruneAiToolResultsForContext([
    ...(previousSummary ? [frameAiContextCheckpoint(previousSummary, t)] : []),
    ...flattenConversationForApi(records),
  ], t).messages.map(({ reasoningContent: _reasoning, anthropicContent: _blocks, ...message }) => message)
  const direct: AiChatMessage[] = [{ role: 'system', content: system }, ...source, { role: 'user', content: `${t('sharedText.promptSummaryInstruction')}\n${t('sharedText.promptSummarySystem')}` }]
  if (aiMessagesTokenCount(direct) + aiToolSchemaTokens(opts.tools) <= contextWindow - outputTokens - 256) {
    return requestSummary(opts.settings, direct, outputTokens, opts.signal, opts.onUsage, opts.tools as AiFunctionTool[] | undefined)
  }
  const boundedSystem = summarySystemPrompt(contextWindow)
  const fixedMessages: AiChatMessage[] = [
    ...(boundedSystem ? [{ role: 'system' as const, content: boundedSystem }] : []),
    { role: 'user', content: t('sharedText.promptSummaryInstruction') },
  ]
  const hardInputBudget = Math.max(
    1_024,
    Math.min(
      Math.floor(promptBudget * 0.72),
      contextWindow - outputTokens - 256,
    ),
  )
  const fixedTokens = aiMessagesTokenCount(fixedMessages)
  const perRecordLimit = Math.max(256, Math.min(12_000, Math.floor(hardInputBudget * 0.45)))
  const units = records
    .map(record => aiHistoryRecordForSummary(record, perRecordLimit, t))
    .filter((message): message is AiChatMessage => message !== null)
  if (!units.length) throw new Error('No useful history was available for compaction')

  let rolling = previousSummary?.trim() || ''
  let index = 0
  while (index < units.length) {
    opts.signal.throwIfAborted()
    const prior = rolling ? frameAiContextCheckpoint(rolling, t) : undefined
    let available = hardInputBudget - fixedTokens - (prior ? messageTokens(prior) : 0)
    if (available < 128) {
      rolling = truncateToTokenBudget(rolling, Math.max(128, Math.floor(hardInputBudget * 0.35)))
      available = hardInputBudget - fixedTokens - messageTokens(frameAiContextCheckpoint(rolling, t))
    }

    const chunk: AiChatMessage[] = []
    let used = 0
    while (index < units.length) {
      let unit = units[index]
      let tokens = messageTokens(unit)
      if (!chunk.length && tokens > available) {
        unit = {
          ...unit,
          content: truncateToTokenBudget(unit.content, Math.max(64, available - 8)),
        }
        tokens = messageTokens(unit)
      }
      if (chunk.length && used + tokens > available) break
      chunk.push(unit)
      used += tokens
      index += 1
      if (used >= available) break
    }
    if (!chunk.length) throw new Error('A history record is too large to summarize safely')

    const messages: AiChatMessage[] = [
      ...(boundedSystem ? [{ role: 'system', content: boundedSystem } as AiChatMessage] : []),
      ...(rolling ? [frameAiContextCheckpoint(rolling, t)] : []),
      ...chunk,
      { role: 'user', content: t('sharedText.promptSummaryInstruction') },
    ]
    if (aiMessagesTokenCount(messages) > hardInputBudget) {
      throw new Error('Compaction input exceeded its bounded summary budget')
    }
    rolling = await requestSummary(opts.settings, messages, outputTokens, opts.signal, opts.onUsage)
  }
  return rolling
}

/**
 * Prepare the model projection before the normal hard packer runs. Failures are
 * deliberately non-fatal: callers continue with the pre-existing safe truncation.
 */
export async function maybeCompactAiContext(opts: ContextCompactionOptions): Promise<PreparedAiContext> {
  const systemPrompt = [opts.settings.systemPrompt, opts.extraSystem]
    .filter(value => value && value.trim())
    .join('\n\n')
  const contextWindow = resolveContextWindowTokens(opts.settings.model, opts.settings.contextWindowTokens)
  const budget = resolveAiContextBudget(opts.settings)
  const promptBudget = budget.inputBudgetTokens
  const threshold = budget.thresholdTokens
  const overhead = measureAiContextPressure({ ...opts.settings, systemPrompt, toolSchemaTokens: aiToolSchemaTokens(opts.tools), messages: [] }).usedTokens
  const projected = [...projectAiHistoryForContext(opts.records, opts.checkpoint, t), ...(opts.continuation || [])]
  const beforeTokens = overhead + aiMessagesTokenCount(projected)
  if (!opts.force && beforeTokens < threshold) return { messages: projected, checkpoint: opts.checkpoint }

  opts.emit({
    type: 'compaction',
    value: { phase: 'start', beforeTokens, budgetTokens: promptBudget },
  })

  try {
    opts.signal.throwIfAborted()
    const pruned = pruneAiToolResultsForContext(projected, t)
    const afterPruneTokens = overhead + aiMessagesTokenCount(pruned.messages)
    if (!opts.force && afterPruneTokens < threshold) {
      opts.emit({
        type: 'compaction',
        value: {
          phase: 'done', beforeTokens, afterTokens: afterPruneTokens,
          budgetTokens: promptBudget, compactedMessages: 0,
        },
      })
      return { messages: pruned.messages, checkpoint: opts.checkpoint }
    }

    const retainTokens = opts.force ? Math.min(budget.retainTokens, Math.max(1, Math.floor(aiMessagesTokenCount(projected) * 0.2))) : budget.retainTokens
    let plan = selectAiCompactionPlan(opts.records, opts.checkpoint, promptBudget, retainTokens, t)
    // An idle single exchange can be condensed as a whole. A pending question
    // or running assistant must stay outside a durable checkpoint.
    if (!plan && opts.force && opts.records.at(-1)?.role === 'assistant' && opts.records.every(record => record.status !== 'running')) {
      const first = findAiCheckpointIndex(opts.records, opts.checkpoint) + 1
      const records = opts.records.slice(first)
      if (records.length >= 2) {
        const previousSummary = opts.checkpoint?.summary
        plan = {
          records, previousSummary, recentMessages: [], throughMessageId: records[records.length - 1].id,
          coveredMessageCount: opts.records.length,
          sourceTokens: aiMessagesTokenCount(pruneAiToolResultsForContext([
            ...(previousSummary ? [frameAiContextCheckpoint(previousSummary, t)] : []), ...flattenConversationForApi(records),
          ], t).messages),
        }
      }
    }
    if (!plan && opts.force) {
      opts.emit({ type: 'compaction', value: { phase: 'done', beforeTokens, afterTokens: beforeTokens, budgetTokens: promptBudget, compactedMessages: 0 } })
      return { messages: projected, checkpoint: opts.checkpoint, compacted: false }
    }
    if (!plan) throw new Error('No balanced older history range can be compacted')
    const summary = await summarizePlan(
      opts,
      promptBudget,
      contextWindow,
      plan.records,
      plan.previousSummary,
    )
    const summaryTokens = aiCheckpointSummaryTokens(summary, t)
    if (summaryTokens >= plan.sourceTokens) {
      throw new Error(`Compaction summary did not shrink its source (${summaryTokens} >= ${plan.sourceTokens})`)
    }

    const checkpoint: AiContextCheckpoint = {
      compactionCount: Math.max(normalizeAiCompactionCount(opts.compactionCount), normalizeAiCompactionCount(opts.checkpoint?.compactionCount), opts.checkpoint ? 1 : 0) + 1,
      version: 1,
      summary,
      throughMessageId: plan.throughMessageId,
      createdAt: Date.now(),
      sourceTokens: plan.sourceTokens,
      summaryTokens,
      model: opts.settings.model,
    }
    const next = pruneAiToolResultsForContext([...projectAiHistoryForContext(opts.records, checkpoint, t), ...(opts.continuation || [])], t).messages
    const afterTokens = overhead + aiMessagesTokenCount(next)
    if (afterTokens >= beforeTokens) {
      throw new Error(`Compaction did not reduce request pressure (${afterTokens} >= ${beforeTokens})`)
    }
    await opts.saveCheckpoint(checkpoint)
    opts.emit({
      type: 'compaction',
      value: {
        phase: 'done', beforeTokens, afterTokens,
        budgetTokens: promptBudget, compactedMessages: plan.coveredMessageCount,
        compactionCount: checkpoint.compactionCount,
      },
    })
    return { messages: next, checkpoint, compacted: true }
  } catch (error) {
    if (opts.signal.aborted) throw error
    console.warn('AI context compaction failed; falling back to safe packing:', error)
    opts.emit({
      type: 'compaction',
      value: { phase: 'failed', beforeTokens, budgetTokens: promptBudget },
    })
    return { messages: projected, checkpoint: opts.checkpoint }
  }
}
