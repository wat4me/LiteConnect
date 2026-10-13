import type { AiToolRun } from '@shared/types/ai'
import { parseJsonValue, type ToolRunSummary } from '@shared/aiToolRunDisplay'

export type ToolDisplayState = 'waiting' | 'running' | 'completed' | 'started' | 'failed' | 'denied' | 'blocked' | 'invalid' | 'stopped' | 'timeout'

export const toolStateKeys: Record<ToolDisplayState, string> = {
  waiting: 'ai.toolWaitingApproval', running: 'ai.toolRunning', completed: 'ai.toolCompleted',
  started: 'ai.toolStarted', failed: 'ai.toolFailed', denied: 'ai.toolDenied',
  blocked: 'ai.toolBlocked', invalid: 'ai.toolReclassify', stopped: 'ai.toolAborted', timeout: 'ai.toolTimeout',
}

/** Shared wording for job rows and job results, independent of tool-call lifecycle. */
export function backgroundJobState(status: string, exitCode?: number | null): ToolDisplayState {
  if (status === 'running') return 'running'
  if (status === 'cancelled') return 'stopped'
  if (status === 'timeout') return 'timeout'
  if (status === 'failed' || (exitCode != null && exitCode !== 0)) return 'failed'
  return 'completed'
}

/** A completed tool call and its result summary are separate UI fields. */
export function toolRunPresentation(run: AiToolRun, summary: ToolRunSummary, streaming = false): {
  state: ToolDisplayState
  detailKey?: string
  detailParams?: Record<string, number>
  truncated?: boolean
} {
  if (run.status === 'ask') return { state: 'waiting' }
  if (run.status === 'denied') return { state: 'denied' }
  if (run.status === 'blocked') return { state: 'blocked' }
  if (run.status === 'reclassify') return { state: 'invalid' }
  if (run.status === 'aborted') return { state: 'stopped' }
  if (run.status === 'running' || (streaming && !run.content && run.status !== 'done')) return { state: 'running' }
  const payload = (run.name === 'exec' || run.isError) && run.content.length <= 20_000 ? parseJsonValue(run.content) : undefined
  const result = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown> : undefined
  if (run.isError) return { state: result?.code === 'EXEC_TIMEOUT' || /^EXEC_TIMEOUT\b/.test(run.content) ? 'timeout' : 'failed' }
  if (summary.kind === 'exit') return {
    state: summary.code === 0 ? 'completed' : 'failed',
    truncated: summary.truncated,
  }
  if (run.name === 'exec' && result?.jobId && result.status === 'running') return { state: 'started' }
  const detailKeys = {
    sessions: 'ai.toolSummarySessions', connections: 'ai.toolSummaryConnections', groups: 'ai.toolSummaryGroups',
    jobs: 'ai.toolSummaryJobs', entries: run.name === 'grep' ? 'ai.toolSummaryMatches' : 'ai.toolSummaryEntries', ptys: 'ai.toolSummaryPtys',
  }
  if (summary.kind in detailKeys && 'count' in summary) return {
    state: 'completed', detailKey: detailKeys[summary.kind as keyof typeof detailKeys], detailParams: { n: summary.count },
  }
  return { state: 'completed' }
}
