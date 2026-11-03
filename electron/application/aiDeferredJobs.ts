import { AiDeferredJobs, type AiDeferredJobsSnapshot } from '../ai/schedules/deferredJobs'
import type { AiExecutionService } from '../ai/execution/executionService'
import type { SshMcpRuntime } from '../mcp/runtime'
import { getAppDatabase } from '../store/appDatabase'
import { onSessionOwned } from '../window/windowRegistry'

const DEFERRED_JOBS_KEY = 'ai-deferred-jobs'

/** Wire the model-scheduled job service to storage, the MCP runtime and result delivery. */
export function createAiDeferredJobs(execution: AiExecutionService, runtime: SshMcpRuntime) {
  const service = new AiDeferredJobs({
    read: () => getAppDatabase().getSingleton<AiDeferredJobsSnapshot>(DEFERRED_JOBS_KEY),
    save: state => getAppDatabase().setSingleton(DEFERRED_JOBS_KEY, state),
    runtime: {
      registerScheduledJob: input => { runtime.registerScheduledJob(input) },
      setScheduledJobAwaiting: (jobId, waiting) => runtime.setScheduledJobAwaiting(jobId, waiting),
      startScheduledJob: (jobId, sessionId, input) => runtime.startScheduledJob(jobId, sessionId, input),
      failScheduledJob: (jobId, message) => runtime.failScheduledJob(jobId, message),
      cancelJob: jobId => runtime.cancelJob(jobId),
      listSessionsForConnection: connectionId => runtime.listSessionsForConnection(connectionId),
      onJobSettled: listener => runtime.onJobSettled(listener),
    },
    execution: {
      bindDeferredJob: input => execution.bindDeferredJob(input),
      recordDeferredJobResult: (binding, job) => execution.recordDeferredJobResult(binding, job),
    },
    onError: error => console.error('[AI deferred jobs]', error),
  })
  execution.attachDeferredJobs({ schedule: input => service.schedule(input) })
  const unsubscribe = onSessionOwned(sessionId => {
    const snapshot = runtime.getSessionSnapshot(sessionId)
    if (snapshot) service.sessionReady(snapshot.connectionId)
  })
  return { service, dispose: () => { unsubscribe(); service.dispose() } }
}
