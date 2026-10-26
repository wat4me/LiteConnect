import type { AiHistoryRecord, AiToolRun } from '@shared/types/ai'
import { aiBackgroundResultNotices } from '@shared/aiBackgroundResults'
import { extractJsonStringField, parseJsonValue } from '@shared/aiToolRunDisplay'
import { TOOL_ARGS_MAX_CHARS, TOOL_DISPLAY_MAX_CHARS } from './toolRunDisplayCache'
import { readAiCommandResult, serializeAiCommandResult } from '@shared/aiCommandResult'
import type { SshMcpJobSummary } from '@shared/mcp/types'

export type CommandExecutionRecord = { key: string; run: AiToolRun; streaming: boolean }
type HistoryMessage = Pick<AiHistoryRecord, 'id' | 'role' | 'toolRuns' | 'backgroundNotice' | 'apiMessages'> & { streaming?: boolean }
type Payload = Record<string, unknown>
const asPayload = (value: unknown): Payload | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Payload : undefined
const parsePayload = readAiCommandResult
const finished = (job: Payload) => ['completed', 'failed', 'timeout', 'cancelled'].includes(String(job.status))

export function commandExecutionJobId(run: AiToolRun): string {
  const payload = parsePayload(run.content)
  return run.jobIds?.[0] || (typeof payload?.jobId === 'string' ? payload.jobId : '')
}

/** Project saved command calls and their background completions without running anything. */
export function commandExecutionRecords(messages: HistoryMessage[], liveJobs: readonly SshMcpJobSummary[] = []): CommandExecutionRecord[] {
  const jobs = new Map<string, Payload>()
  const mergeJob = (job: Payload) => {
    if (typeof job.jobId !== 'string') return
    const previous = jobs.get(job.jobId)
    if (previous && finished(previous) && !finished(job)) return
    jobs.set(job.jobId, { ...previous, ...Object.fromEntries(Object.entries(job).filter(([, value]) => value !== undefined)) })
  }
  const records: CommandExecutionRecord[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const run of message.toolRuns || []) {
      if (run.name === 'exec') records.push({ key: `${message.id}:${run.id}`, run, streaming: message.streaming === true })
      if ((run.name === 'get_job' || run.name === 'cancel_job') && !run.isError) {
        const job = parsePayload(run.content)
        if (job) {
          const id = typeof job.jobId === 'string' ? job.jobId : extractJsonStringField(run.args.slice(0, TOOL_ARGS_MAX_CHARS), 'jobId')
          // Older serializers retained the exit code but dropped job identity/status.
          const status = job.status || (job.code === 'EXEC_TIMEOUT' ? 'timeout'
            : job.error ? 'failed' : typeof job.exitCode === 'number' || job.signal ? 'completed' : undefined)
          if (id && status) mergeJob({ ...job, jobId: id, status })
        }
      }
    }
    for (const notice of aiBackgroundResultNotices(message)) {
      // Application notices have their own bounded history allowance.
      if (notice.length > 32_000) continue
      const parsed = parseJsonValue(notice.slice(notice.indexOf('\n') + 1))
      if (!Array.isArray(parsed)) continue
      for (const value of parsed) {
        const job = asPayload(value)
        if (job) mergeJob(job)
      }
    }
  }
  for (const job of liveJobs) mergeJob({ ...job })
  if (!jobs.size) return records
  return records.map<CommandExecutionRecord>(record => {
    const initial = parsePayload(record.run.content)
    const id = commandExecutionJobId(record.run)
    const job = jobs.get(id)
    if (!job || !finished(job)) return record
    return { ...record, streaming: false, run: {
      ...record.run,
      status: job.status === 'cancelled' ? 'aborted' : 'done',
      isError: job.status === 'failed' || job.status === 'timeout',
      content: serializeAiCommandResult({ ...initial, ...job,
        code: job.status === 'timeout' ? 'EXEC_TIMEOUT' : undefined }),
    } }
  })
}

export function commandExecutionCommand(run: AiToolRun): string {
  return extractJsonStringField(run.args.slice(0, TOOL_ARGS_MAX_CHARS), 'command') || ''
}

export function commandExecutionDetail(run: AiToolRun) {
  const payload = parsePayload(run.content)
  const command = commandExecutionCommand(run)
  const stdout = typeof payload?.stdout === 'string' ? payload.stdout : extractJsonStringField(run.content.slice(0, TOOL_DISPLAY_MAX_CHARS), 'stdout') || ''
  const stderr = typeof payload?.stderr === 'string' ? payload.stderr : extractJsonStringField(run.content.slice(0, TOOL_DISPLAY_MAX_CHARS), 'stderr') || ''
  const error = typeof payload?.error === 'string' ? payload.error : typeof payload?.message === 'string' ? payload.message : ''
  return {
    command, stdout, stderr, error,
    exitCode: typeof payload?.exitCode === 'number' && Number.isFinite(payload.exitCode) ? payload.exitCode : null,
    signal: typeof payload?.signal === 'string' ? payload.signal : '',
    target: run.target || (typeof payload?.connectionName === 'string' ? payload.connectionName : ''),
    background: !!run.jobIds?.length || typeof payload?.jobId === 'string',
    structured: (!!payload && ('stdout' in payload || 'stderr' in payload || 'exitCode' in payload || 'error' in payload || 'message' in payload || 'signal' in payload)) || !!stdout || !!stderr,
    truncated: payload?.truncated === true || run.content.length >= TOOL_DISPLAY_MAX_CHARS,
    commandTruncated: run.args.length >= TOOL_ARGS_MAX_CHARS,
  }
}
