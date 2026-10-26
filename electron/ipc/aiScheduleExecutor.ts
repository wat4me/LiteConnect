import { t } from '../i18n'
import { randomUUID } from 'crypto'
import { aiScheduleHasToolFailure, type AiSchedule, type AiScheduleExecutionResult, type AiScheduleHostRun } from '../../shared/aiSchedules'
import type { AiExecutionService } from '../ai/execution/executionService'
import type { SSHManager } from '../ssh/manager'
import type { CredentialStore } from '../store/credentialStore'
import { writeAiSessionStore } from '../ai/history/historyStore'
import { aiSessionKey, getAppDatabase } from '../store/appDatabase'
import { formatToolRunDisplay, parseJsonValue } from '../../shared/aiToolRunDisplay'
import { orchestrateInspection, scheduleHealth } from '../ai/schedules/orchestrator'
import { runAiChatCompletion } from '../ai/execution/chatCompletion'
import type { AiResolvedConfig } from '../../shared/types/ai'

export function createScheduleExecutor(service: AiExecutionService, ssh: SSHManager, credentials: CredentialStore, config?: (plan?: AiSchedule) => AiResolvedConfig) {
  const execute = async (plan: AiSchedule, runId: string, signal: AbortSignal): Promise<AiScheduleExecutionResult> => {
    // Unique owner per host run so parallel inspections do not dispose each other.
    const ownerId = `schedule:${runId}`
    const historyId = `schedule:${runId}`
    const threadId = randomUUID()
    const requestId = randomUUID()
    let sessionId: string | undefined
    let attempted = false
    let needsAuthentication = false
    const abort = () => {
      service.disposeOwner(ownerId)
      if (sessionId) ssh.disconnect(sessionId)
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      signal.throwIfAborted()
      const settings = config?.(plan)
      await credentials.init()
      signal.throwIfAborted()
      if (ssh.getPendingHostKey(plan.connectionId)) throw new Error(t('notice.scheduleHostKeyPending'))
      const connection = credentials.getConnectionForAuth(plan.connectionId)
      if (!connection) throw new Error(t('notice.scheduleConnectionDeleted'))
      attempted = true
      sessionId = await ssh.connect(connection, {
        signal, onData: () => {}, onClose: () => {}, onError: () => {},
        onKeyboardInteractive: async () => { needsAuthentication = true; return null },
      })
      signal.throwIfAborted()
      const now = Date.now()
      await writeAiSessionStore(historyId, { version: 1, activeThreadId: threadId, defaultContextFiles: [], threads: [{
        id: threadId, title: plan.name, createdAt: now, updatedAt: now, contextFiles: [], messages: [{
          id: randomUUID(), role: 'user', createdAt: now,
          content: t('notice.scheduleInspectionPrompt', { prompt: plan.prompt }),
        }],
      }] })
      signal.throwIfAborted()
      const result = await service.run({ requestId, historyId, foregroundOnly: true, settings,
        owner: { id: ownerId, kind: 'automation', isAlive: () => !signal.aborted },
        target: { sessionId, threadId, assistantMessageId: randomUUID(), createdAt: Date.now() },
      })
      signal.throwIfAborted()
      if (result.aborted) throw new Error(t('notice.scheduleInterrupted'))
      const assessment = scheduleHealth(result.content)
      const failed = aiScheduleHasToolFailure(result.toolRuns)
      return { content: assessment.content.slice(0, 30000), health: assessment.health !== 'healthy' || (!failed && result.toolRuns?.some(tool => tool.status === 'done' && !tool.isError)) ? assessment.health : 'unknown',
        error: failed ? t('notice.scheduleToolFailure') : undefined, toolRuns: result.toolRuns?.slice(0, 20).map(tool => {
        const view = formatToolRunDisplay(tool)
        const payload = parseJsonValue(tool.content) as Record<string, unknown> | null
        // Trim output fields before serialization, never cut JSON in half and
        // lose the exit status that determines a report's outcome.
        const content = view.summary.kind === 'exit' ? JSON.stringify({ exitCode: view.summary.code,
          stdout: typeof payload?.stdout === 'string' ? payload.stdout.slice(0, 3000) : view.body.slice(0, 3000),
          stderr: typeof payload?.stderr === 'string' ? payload.stderr.slice(0, 800) : '',
          truncated: view.summary.truncated || view.body.length > 3000,
        }) : view.body.slice(0, 4000)
        return { ...tool, content }
      }) }
    } catch (error) {
      if (needsAuthentication) throw new Error(t('notice.scheduleNeedsInteractiveAuth'))
      if (attempted && ssh.getPendingHostKey(plan.connectionId)?.callbacks.signal === signal) {
        ssh.rejectHostKey(plan.connectionId)
        throw new Error(t('notice.scheduleHostKeyUnverified'))
      }
      throw error
    } finally {
      signal.removeEventListener('abort', abort)
      service.disposeOwner(ownerId)
      if (sessionId) ssh.disconnect(sessionId)
      // Quit can close storage before an aborted provider finishes unwinding.
      // Startup also clears any temporary histories left by an interrupted run.
      try { getAppDatabase().deleteSingleton(aiSessionKey(historyId)) } catch (error) { if (!signal.aborted) throw error }
    }
  }
  return async (plan: AiSchedule, runId: string, signal: AbortSignal, progress?: (hosts: AiScheduleHostRun[]) => void) => {
    signal.throwIfAborted()
    await credentials.init()
    signal.throwIfAborted()
    return orchestrateInspection(plan, runId, signal, {
      execute, progress, name: id => {
        const connection = credentials.getConnection?.(id)
        return connection ? `${connection.name || connection.host} · ${connection.username}@${connection.host}:${connection.port || 22}` : id
      },
      summarize: async (target, hosts, abortSignal) => {
        if (!config) throw new Error(t('notice.scheduleModelUnavailable'))
        const hostsJson = JSON.stringify(hosts.map(host => ({ name: host.name, status: host.status, health: host.health, error: host.error, content: host.content?.slice(0, 1800), truncated: host.truncated || (host.content?.length || 0) > 1800 })))
        const result = await runAiChatCompletion(config(target), [{ role: 'user', content: t('notice.scheduleSummaryUser', { prompt: target.prompt, hosts: hostsJson }) }], abortSignal,
          t('notice.scheduleSummarySystem'))
        return result.content
      },
    })
  }
}
