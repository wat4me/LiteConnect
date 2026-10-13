import { aiScheduleConcurrency, aiScheduleConnectionIds, aiScheduleHasToolFailure, type AiSchedule, type AiScheduleExecutionResult, type AiScheduleHealth, type AiScheduleHostRun } from '../../shared/aiSchedules'

export function scheduleHealth(content: string): { content: string; health: AiScheduleHealth } {
  const match = /\s*<liteconnect-health>(healthy|warning|critical|unknown)<\/liteconnect-health>\s*$/.exec(content)
  return { content: match ? content.slice(0, match.index).trimEnd() : content, health: match ? match[1] as AiScheduleHealth : 'unknown' }
}

export async function orchestrateInspection(plan: AiSchedule, runId: string, signal: AbortSignal, ports: {
  name: (id: string) => string
  execute: (plan: AiSchedule, runId: string, signal: AbortSignal) => Promise<AiScheduleExecutionResult>
  summarize: (plan: AiSchedule, hosts: AiScheduleHostRun[], signal: AbortSignal) => Promise<string>
  progress?: (hosts: AiScheduleHostRun[]) => void
}): Promise<AiScheduleExecutionResult> {
  const ids = aiScheduleConnectionIds(plan)
  const hosts: AiScheduleHostRun[] = ids.map(connectionId => ({ connectionId, name: ports.name(connectionId), status: 'queued' }))
  const publish = () => ports.progress?.(structuredClone(hosts))
  publish()
  const concurrency = Math.min(aiScheduleConcurrency(plan), hosts.length)
  let next = 0
  const inspect = async (host: AiScheduleHostRun, index: number) => {
    signal.throwIfAborted()
    host.status = 'running'
    // Progress/storage errors belong to the run, not to this host's inspection.
    publish()
    try {
      signal.throwIfAborted()
      const result = await ports.execute({ ...plan, connectionId: host.connectionId, connectionIds: undefined }, ids.length === 1 ? runId : `${runId}-${index}`, signal)
      signal.throwIfAborted()
      const failed = aiScheduleHasToolFailure(result.toolRuns) || !!result.error
      Object.assign(host, { content: result.content?.slice(0, 8000), truncated: (result.content?.length || 0) > 8000, toolRuns: result.toolRuns, health: failed && result.health === 'healthy' ? 'unknown' : result.health || 'unknown',
        status: failed ? 'failed' : 'completed', error: result.error })
    } catch (error) {
      if (signal.aborted) {
        Object.assign(host, { status: 'cancelled', health: 'unknown' })
        publish()
        throw signal.reason
      }
      Object.assign(host, { status: 'failed', health: 'unknown', error: error instanceof Error ? error.message : String(error) })
    }
    publish()
  }
  const worker = async () => {
    while (true) {
      const index = next++
      if (index >= hosts.length) return
      await inspect(hosts[index], index)
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()))
  } catch (error) {
    if (signal.aborted) {
      for (const pending of hosts) if (pending.status === 'running' || pending.status === 'queued') pending.status = 'cancelled'
      publish()
      throw signal.reason
    }
    throw error
  }
  const rank: Record<AiScheduleHealth, number> = { healthy: 0, unknown: 1, warning: 2, critical: 3 }
  const health = hosts.reduce<AiScheduleHealth>((current, host) => rank[host.health || 'unknown'] > rank[current] ? host.health || 'unknown' : current, 'healthy')
  let content = hosts.map(host => `## ${host.name}\n\n${host.error || host.content || ''}`).join('\n\n')
  let error: string | undefined
  if (hosts.length > 1 && hosts.some(host => host.status === 'completed')) {
    try { content = await ports.summarize(plan, structuredClone(hosts), signal) }
    catch (failure) {
      signal.throwIfAborted()
      error = `跨服务器汇总失败：${failure instanceof Error ? failure.message : String(failure)}`
    }
  } else if (hosts.length === 1) content = hosts[0].content || hosts[0].error || ''
  return { content: content.slice(0, 30000), hosts, health, error,
    toolRuns: hosts.length === 1 ? hosts[0].toolRuns : undefined }
}
