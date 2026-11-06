import type { AiChatSegment, AiToolRun } from '@shared/types/ai'
import { formatToolRunDisplay } from '@shared/aiToolRunDisplay'
import { toolRunPresentation, type ToolDisplayState } from './toolRunPresentation'

export interface ChatProcessItem { seg: AiChatSegment; run?: AiToolRun }

export interface ChatProcessSource {
  /** Display items of one assistant turn in recorded order. */
  items: ChatProcessItem[]
  streaming?: boolean
  status?: 'running' | 'completed' | 'aborted' | 'error'
  error?: boolean
  createdAt?: number
  completedAt?: number
}

export interface ChatProcessStats {
  steps: number
  /** Modifying calls that actually ran. */
  changes: number
  failed: number
  blocked: number
  durationSeconds: number | null
}

export interface ChatProcessLayout {
  /** At least one tool step precedes the conclusion. */
  hasProcess: boolean
  /** Still working and no conclusion has started: steps stay expanded. */
  live: boolean
  /** The turn failed or was stopped before its conclusion. */
  interrupted: boolean
  /** Index of the conclusion segment, or -1 while there is none. */
  conclusionIndex: number
  processIndexes: Set<number>
  /** Runs that stay visible under the folded summary. */
  pinnedRunIds: Set<string>
  stats: ChatProcessStats
}

const FAILED: ReadonlySet<ToolDisplayState> = new Set(['failed', 'timeout', 'invalid'])
const BLOCKED: ReadonlySet<ToolDisplayState> = new Set(['denied', 'blocked'])
const PINNED: ReadonlySet<ToolDisplayState> = new Set(['failed', 'timeout', 'invalid', 'denied', 'blocked', 'stopped', 'waiting', 'question'])
const PERFORMED: ReadonlySet<ToolDisplayState> = new Set(['completed', 'started', 'running', 'scheduled'])
const MODIFYING: ReadonlySet<string> = new Set(['write', 'destructive', 'privileged'])

/**
 * Split one assistant turn into the steps it took and the conclusion it reached.
 * The last segment counts as the conclusion only when it is text; text between
 * tool calls is part of the process. Read-only steps fold into a count, while
 * failures, blocked calls and performed changes stay pinned under the summary.
 */
export function chatProcessLayout(source: ChatProcessSource): ChatProcessLayout {
  const { items } = source
  const last = items.length - 1
  const conclusionIndex = last >= 0 && items[last].seg.kind === 'content' ? last : -1
  const end = conclusionIndex === -1 ? items.length : conclusionIndex
  const processIndexes = new Set<number>()
  const pinnedRunIds = new Set<string>()
  const stats: ChatProcessStats = { steps: 0, changes: 0, failed: 0, blocked: 0, durationSeconds: null }
  for (let index = 0; index < end; index++) {
    processIndexes.add(index)
    const item = items[index]
    if (item.seg.kind !== 'tool' || !item.run) continue
    const run = item.run
    stats.steps++
    const { state } = toolRunPresentation(run, formatToolRunDisplay(run).summary, source.streaming)
    if (FAILED.has(state)) stats.failed++
    else if (BLOCKED.has(state)) stats.blocked++
    const change = MODIFYING.has(run.risk || '') && PERFORMED.has(state)
    if (change) stats.changes++
    if (change || PINNED.has(state)) pinnedRunIds.add(run.id)
  }
  const hasProcess = stats.steps > 0
  const live = Boolean(source.streaming) && conclusionIndex === -1
  const interrupted = hasProcess && !live
    && (source.status === 'error' || Boolean(source.error) || (source.status === 'aborted' && conclusionIndex === -1))
  if (typeof source.createdAt === 'number' && typeof source.completedAt === 'number' && source.completedAt >= source.createdAt) {
    stats.durationSeconds = Math.round((source.completedAt - source.createdAt) / 1000)
  }
  return { hasProcess, live, interrupted, conclusionIndex, processIndexes, pinnedRunIds, stats }
}
