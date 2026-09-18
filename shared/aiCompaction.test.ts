import { describe, expect, it } from 'vitest'
import {
  AI_COMPACTION_TOOL_THRESHOLD_CHARS,
  aiHistoryRecordForSummary,
  findAiCheckpointIndex,
  projectAiHistoryForContext,
  pruneAiToolResultText,
  pruneAiToolResultsForContext,
  selectAiCompactionPlan,
} from './aiCompaction'
import type { AiContextCheckpoint, AiHistoryRecord } from './types/ai'

function record(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  extra: Partial<AiHistoryRecord> = {},
): AiHistoryRecord {
  return { id, role, content, createdAt: Number(id.slice(1)) || 1, ...extra }
}

function checkpoint(throughMessageId: string): AiContextCheckpoint {
  return {
    version: 1,
    summary: '旧摘要',
    throughMessageId,
    createdAt: 1,
    sourceTokens: 100,
    summaryTokens: 10,
  }
}

describe('AI context compaction helpers', () => {
  it('keeps persisted history untouched while pruning only model-facing tool results', () => {
    const original = '头'.repeat(5_000) + '中'.repeat(5_000) + '尾'.repeat(2_000)
    const pruned = pruneAiToolResultText(original)
    expect(original.length).toBeGreaterThan(AI_COMPACTION_TOOL_THRESHOLD_CHARS)
    expect(pruned).toContain('工具结果中段已由上下文压缩移除')
    expect(pruned.startsWith('头'.repeat(100))).toBe(true)
    expect(pruned.endsWith('尾'.repeat(100))).toBe(true)

    const projected = pruneAiToolResultsForContext([
      { role: 'tool', toolCallId: 'call-1', content: original },
    ])
    expect(projected.prunedCount).toBe(1)
    expect(projected.messages[0].content).toBe(pruned)
    expect(original.length).toBe(12_000)
  })

  it('projects a hidden checkpoint followed by recent raw turns', () => {
    const records = [
      record('m1', 'user', 'old question'),
      record('m2', 'assistant', 'old answer', { status: 'completed' }),
      record('m3', 'user', 'recent question'),
    ]
    const cp = checkpoint('m2')
    expect(findAiCheckpointIndex(records, cp)).toBe(1)
    const messages = projectAiHistoryForContext(records, cp)
    expect(messages).toHaveLength(2)
    expect(messages[0].content).toContain('<compacted-summary>')
    expect(messages[1]).toEqual({ role: 'user', content: 'recent question' })
  })

  it('selects old complete turns and retains a recent user/assistant turn', () => {
    const long = 'x'.repeat(2_000)
    const records = [
      record('m1', 'user', long),
      record('m2', 'assistant', long, { status: 'completed' }),
      record('m3', 'user', long),
      record('m4', 'assistant', long, { status: 'completed' }),
    ]
    const plan = selectAiCompactionPlan(records, undefined, 2_000)
    expect(plan?.throughMessageId).toBe('m2')
    expect(plan?.records.map(item => item.id)).toEqual(['m1', 'm2'])
    expect(plan?.recentMessages.map(item => item.role)).toEqual(['user', 'assistant'])
    expect(plan?.coveredMessageCount).toBe(2)
  })

  it('rolls a prior checkpoint forward instead of resummarizing covered records', () => {
    const long = 'x'.repeat(2_000)
    const records = [
      record('m1', 'user', long),
      record('m2', 'assistant', long, { status: 'completed' }),
      record('m3', 'user', long),
      record('m4', 'assistant', long, { status: 'completed' }),
      record('m5', 'user', long),
      record('m6', 'assistant', long, { status: 'completed' }),
    ]
    const plan = selectAiCompactionPlan(records, checkpoint('m2'), 2_000)
    expect(plan?.previousSummary).toBe('旧摘要')
    expect(plan?.records.map(item => item.id)).toEqual(['m3', 'm4'])
    expect(plan?.throughMessageId).toBe('m4')
  })

  it('does not resend stored reasoning to the summarizer', () => {
    const message = aiHistoryRecordForSummary(record('m1', 'assistant', 'final', {
      status: 'completed',
      reasoningContent: 'private reasoning',
    }), 1_000)
    expect(message?.content).toContain('final')
    expect(message?.content).not.toContain('private reasoning')
  })
})
