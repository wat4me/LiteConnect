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
}

export interface ChatProcessStats {
  steps: number
  /** Modifying calls that actually ran. */
  changes: number
  failed: number
  blocked: number
}

export interface ChatProcessGroup {
  start: number
  firstRunId: string
  live: boolean
  interrupted: boolean
  /** Runs awaiting user input stay visible under the folded summary. */
  pinnedRunIds: Set<string>
  stats: ChatProcessStats
}

const FAILED: ReadonlySet<ToolDisplayState> = new Set(['failed', 'timeout', 'invalid'])
const BLOCKED: ReadonlySet<ToolDisplayState> = new Set(['denied', 'blocked'])
const ACTION_REQUIRED: ReadonlySet<ToolDisplayState> = new Set(['waiting', 'question'])
const PERFORMED: ReadonlySet<ToolDisplayState> = new Set(['completed', 'started', 'running', 'scheduled'])
const MODIFYING: ReadonlySet<string> = new Set(['write', 'destructive', 'privileged'])

export function isChatContentBoundary(segment: AiChatSegment): boolean {
  return segment.kind === 'content' && /\S/.test(segment.text)
}

/** Group adjacent tool steps and reasoning without moving the assistant's text. */
export function chatProcessLayout(source: ChatProcessSource): Map<number, ChatProcessGroup> {
  const { items } = source
  const groupsByIndex = new Map<number, ChatProcessGroup>()
  let start = 0
  let group: ChatProcessGroup | undefined

  function finishGroup(end: number) {
    if (!group) return
    for (let index = group.start; index < end; index++) groupsByIndex.set(index, group)
    group = undefined
  }

  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    if (isChatContentBoundary(item.seg)) {
      finishGroup(index)
      start = index + 1
      continue
    }
    if (item.seg.kind !== 'tool' || !item.run) continue
    const run = item.run
    group ??= {
      start, firstRunId: run.id, live: false, interrupted: false,
      pinnedRunIds: new Set(), stats: { steps: 0, changes: 0, failed: 0, blocked: 0 },
    }
    const { stats } = group
    stats.steps++
    const { state } = toolRunPresentation(run, formatToolRunDisplay(run).summary, source.streaming)
    if (FAILED.has(state)) stats.failed++
    else if (BLOCKED.has(state)) stats.blocked++
    if (MODIFYING.has(run.risk || '') && PERFORMED.has(state)) stats.changes++
    if (ACTION_REQUIRED.has(state)) group.pinnedRunIds.add(run.id)
  }
  if (group) {
    group.live = Boolean(source.streaming)
    group.interrupted = !group.live && (source.status === 'aborted' || source.status === 'error' || Boolean(source.error))
    finishGroup(items.length)
  }
  return groupsByIndex
}
