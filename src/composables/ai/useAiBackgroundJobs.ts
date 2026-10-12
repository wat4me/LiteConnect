import { computed, onScopeDispose, shallowRef } from 'vue'
import type { SshMcpJobSummary } from '@shared/mcp/types'

const jobs = shallowRef<SshMcpJobSummary[]>([])
let consumers = 0
let unsubscribe: (() => void) | undefined
let revision = 0

/** One shared subscription survives closing the panel while the workspace is mounted. */
export function useAiBackgroundJobs(sessionId: () => string | null | undefined) {
  consumers++
  if (consumers === 1) {
    const initialRevision = ++revision
    unsubscribe = window.LiteConnect.onMcpJobsChanged?.(snapshot => {
      revision++
      jobs.value = snapshot
    })
    void window.LiteConnect.mcpListJobs?.().then(snapshot => {
      // An event or a remount supersedes an older initial snapshot.
      if (revision === initialRevision) jobs.value = snapshot
    }).catch(error => { console.warn('Could not load background task status', error) })
  }
  onScopeDispose(() => {
    if (--consumers === 0) {
      unsubscribe?.()
      unsubscribe = undefined
      revision++
      jobs.value = []
    }
  })
  const sessionJobs = computed(() => jobs.value.filter(job => job.sessionId === sessionId()))
  const runningCount = computed(() => sessionJobs.value.filter(job => job.status === 'running').length)
  const runningSessionIds = computed(() => new Set(jobs.value.filter(job => job.status === 'running').map(job => job.sessionId)))
  return { sessionJobs, runningCount, runningSessionIds }
}
