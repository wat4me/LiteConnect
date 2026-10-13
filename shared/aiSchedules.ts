import type { AiToolRun } from './types/ai'

export type AiScheduleTiming = { kind: 'interval' } | { kind: 'daily'; time: string } | { kind: 'weekly'; time: string; weekday: number }
export type AiScheduleHealth = 'healthy' | 'warning' | 'critical' | 'unknown'
export interface AiScheduleHostRun {
  connectionId: string
  name: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  health?: AiScheduleHealth
  content?: string
  error?: string
  toolRuns?: AiToolRun[]
  truncated?: boolean
}
export interface AiRunNotification { status: 'sending' | 'sent' | 'failed' | 'skipped'; at?: number; error?: string }
export type AiScheduleExecutionResult = Pick<AiScheduleRun, 'content' | 'toolRuns' | 'hosts' | 'health' | 'error'>

export interface AiScheduleInput {
  id?: string
  name: string
  connectionId: string
  connectionIds?: string[]
  prompt: string
  intervalMinutes: number
  /** Absent on older saved plans; defaults to interval scheduling. */
  timing?: AiScheduleTiming
  /** Absent = use the app's current active provider/model at run time. */
  providerId?: string
  model?: string
  /** Hosts inspected at once. Absent or 1 = serial; capped at 5. */
  concurrency?: number
  enabled: boolean
}
export interface AiSchedule extends AiScheduleInput {
  id: string
  createdAt: number
  updatedAt: number
  nextRunAt: number
  timeZone?: string
}
export interface AiScheduleRun {
  id: string
  scheduleId: string
  name: string
  connectionId: string
  startedAt: number
  finishedAt?: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  content?: string
  error?: string
  toolRuns?: AiToolRun[]
  hosts?: AiScheduleHostRun[]
  health?: AiScheduleHealth
  notification?: AiRunNotification
}
export interface AiScheduleSnapshot { plans: AiSchedule[]; runs: AiScheduleRun[] }

export function validateAiSchedule(input: AiScheduleInput): AiScheduleInput {
  if (!input || typeof input !== 'object' || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 ||
    typeof input.connectionId !== 'string' || !input.connectionId || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 8000 ||
    !Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 5 || input.intervalMinutes > 10080 || typeof input.enabled !== 'boolean' ||
    (input.id !== undefined && (typeof input.id !== 'string' || !input.id))) throw new Error('Invalid AI schedule')
  const timing = input.timing
  if (input.connectionIds !== undefined && (!Array.isArray(input.connectionIds) || input.connectionIds.length < 1 || input.connectionIds.length > 10 ||
    input.connectionIds.some(id => typeof id !== 'string' || !id))) throw new Error('请选择 1 至 10 台服务器。')
  const ids = [...new Set(input.connectionIds || [input.connectionId])]
  if (timing !== undefined && (!timing || typeof timing !== 'object' || !['interval', 'daily', 'weekly'].includes(timing.kind) ||
    (timing.kind !== 'interval' && (typeof timing.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(timing.time))) ||
    (timing.kind === 'weekly' && (!Number.isInteger(timing.weekday) || timing.weekday < 0 || timing.weekday > 6)))) throw new Error('Invalid AI schedule time')
  const hasProvider = input.providerId !== undefined && input.providerId !== ''
  const hasModel = input.model !== undefined && input.model !== ''
  if (hasProvider !== hasModel || (hasProvider && (typeof input.providerId !== 'string' || typeof input.model !== 'string' ||
    input.providerId.length > 120 || input.model.trim().length < 1 || input.model.length > 200))) throw new Error('请选择完整的 AI 服务商和模型，或使用当前默认模型。')
  if (input.concurrency !== undefined && (!Number.isInteger(input.concurrency) || input.concurrency < 1 || input.concurrency > 5)) {
    throw new Error('并行主机数需在 1 至 5 之间。')
  }
  const normalized: AiScheduleTiming | undefined = !timing || timing.kind === 'interval' ? undefined
    : timing.kind === 'daily' ? { kind: 'daily', time: timing.time.slice(0, 5) } : { kind: 'weekly', time: timing.time.slice(0, 5), weekday: timing.weekday }
  return {
    id: input.id, name: input.name.trim(), connectionId: ids[0], connectionIds: ids.length > 1 ? ids : undefined,
    prompt: input.prompt.trim(), intervalMinutes: input.intervalMinutes, timing: normalized, enabled: input.enabled,
    providerId: hasProvider ? input.providerId : undefined, model: hasModel && typeof input.model === 'string' ? input.model.trim() : undefined,
    concurrency: input.concurrency && input.concurrency > 1 ? input.concurrency : undefined,
  }
}

export function aiScheduleConcurrency(plan: AiScheduleInput): number {
  return plan.concurrency && plan.concurrency > 1 ? Math.min(5, plan.concurrency) : 1
}

export function aiScheduleConnectionIds(plan: AiScheduleInput): string[] { return plan.connectionIds?.length ? [...plan.connectionIds] : [plan.connectionId] }

export function aiScheduleHasToolFailure(tools?: AiToolRun[]): boolean {
  return tools?.some(tool => {
    if (tool.isError || ['blocked', 'denied', 'reclassify', 'aborted'].includes(tool.status || '')) return true
    try { const payload = JSON.parse(tool.content); return typeof payload.exitCode === 'number' && payload.exitCode !== 0 } catch { return false }
  }) || false
}

export function aiScheduleTimingKey(plan: AiScheduleInput): string {
  const timing = plan.timing
  return !timing || timing.kind === 'interval' ? `interval:${plan.intervalMinutes}` : `${timing.kind}:${timing.time}:${timing.kind === 'weekly' ? timing.weekday : ''}`
}

/** Strictly after the reference instant, using local calendar days (including DST). */
export function nextAiScheduleRun(plan: AiScheduleInput, after: number): number {
  const timing = plan.timing
  if (!timing || timing.kind === 'interval') return after + plan.intervalMinutes * 60_000
  const [hour, minute] = timing.time.split(':').map(Number)
  const current = new Date(after)
  const offset = timing.kind === 'weekly' ? (timing.weekday - current.getDay() + 7) % 7 : 0
  const candidate = new Date(current.getFullYear(), current.getMonth(), current.getDate() + offset, hour, minute, 0, 0)
  if (candidate.getTime() > after) return candidate.getTime()
  return new Date(current.getFullYear(), current.getMonth(), current.getDate() + offset + (timing.kind === 'weekly' ? 7 : 1), hour, minute, 0, 0).getTime()
}
