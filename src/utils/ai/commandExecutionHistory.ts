import type { AiHistoryRecord, AiToolRun } from '@shared/types/ai'
import { aiBackgroundResultNotices } from '@shared/aiBackgroundResults'
import { extractJsonStringField, parseJsonValue } from '@shared/aiToolRunDisplay'
import { TOOL_ARGS_MAX_CHARS, TOOL_DISPLAY_MAX_CHARS } from './toolRunDisplayCache'

export type CommandExecutionRecord = { key: string; run: AiToolRun; streaming: boolean }
type HistoryMessage = Pick<AiHistoryRecord, 'id' | 'role' | 'toolRuns' | 'backgroundNotice' | 'apiMessages'> & { streaming?: boolean }
type Payload = Record<string, unknown>
const asPayload = (value: unknown): Payload | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Payload : undefined
const parsePayload = (content: string) => content.length <= TOOL_DISPLAY_MAX_CHARS ? asPayload(parseJsonValue(content)) : undefined

/** Project saved command calls and their background completions without running anything. */
export function commandExecutionRecords(messages: HistoryMessage[]): CommandExecutionRecord[] {
  const jobs = new Map<string, Payload>()
  const records: CommandExecutionRecord[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const run of message.toolRuns || []) {
      if (run.name === 'exec') records.push({ key: `${message.id}:${run.id}`, run, streaming: message.streaming === true })
      if (run.name === 'get_job' && !run.isError) {
        const job = parsePayload(run.content)
        if (job && typeof job.jobId === 'string') jobs.set(job.jobId, job)
      }
    }
    for (const notice of aiBackgroundResultNotices(message)) {
      // Application notices have their own bounded history allowance.
      if (notice.length > 32_000) continue
      const parsed = parseJsonValue(notice.slice(notice.indexOf('\n') + 1))
      if (!Array.isArray(parsed)) continue
      for (const value of parsed) {
        const job = asPayload(value)
        if (job && typeof job.jobId === 'string') jobs.set(job.jobId, job)
      }
    }
  }
  if (!jobs.size) return records
  return records.map<CommandExecutionRecord>(record => {
    const initial = parsePayload(record.run.content)
    const id = record.run.jobIds?.[0] || (typeof initial?.jobId === 'string' ? initial.jobId : '')
    const job = jobs.get(id)
    if (!job || !['completed', 'failed', 'timeout', 'cancelled'].includes(String(job.status))) return record
    return { ...record, streaming: false, run: {
      ...record.run,
      status: job.status === 'cancelled' ? 'aborted' : 'done',
      isError: job.status === 'failed' || job.status === 'timeout',
      content: JSON.stringify({ stdout: job.stdout, stderr: job.stderr, exitCode: job.exitCode,
        error: job.error, signal: job.signal, truncated: job.truncated,
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
  const error = typeof payload?.error === 'string' ? payload.error : ''
  return {
    command, stdout, stderr, error,
    exitCode: typeof payload?.exitCode === 'number' && Number.isFinite(payload.exitCode) ? payload.exitCode : null,
    signal: typeof payload?.signal === 'string' ? payload.signal : '',
    target: run.target || (typeof payload?.connectionName === 'string' ? payload.connectionName : ''),
    background: !!run.jobIds?.length || typeof payload?.jobId === 'string',
    structured: (!!payload && ('stdout' in payload || 'stderr' in payload || 'exitCode' in payload || 'error' in payload)) || !!stdout || !!stderr,
    truncated: payload?.truncated === true || run.content.length >= TOOL_DISPLAY_MAX_CHARS,
    commandTruncated: run.args.length >= TOOL_ARGS_MAX_CHARS,
  }
}
