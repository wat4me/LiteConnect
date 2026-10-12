import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SshMcpJobSummary } from '@shared/mcp/types'
import { useAiBackgroundJobs } from './useAiBackgroundJobs'

afterEach(() => vi.unstubAllGlobals())

describe('background task status', () => {
  it('shares updates across panels, follows sessions, and rejects a stale initial snapshot', async () => {
    let publish: (snapshot: SshMcpJobSummary[]) => void = () => {}
    let resolveInitial: (snapshot: SshMcpJobSummary[]) => void = () => {}
    const unsubscribe = vi.fn()
    const listJobs = vi.fn(() => new Promise<SshMcpJobSummary[]>(resolve => { resolveInitial = resolve }))
    const onChanged = vi.fn(callback => { publish = callback; return unsubscribe })
    vi.stubGlobal('window', { LiteConnect: { mcpListJobs: listJobs, onMcpJobsChanged: onChanged } })
    const session = ref('A')
    const workspace = effectScope()
    const panel = effectScope()
    const first = workspace.run(() => useAiBackgroundJobs(() => session.value))!
    const second = panel.run(() => useAiBackgroundJobs(() => 'A'))!
    try {
      expect(listJobs).toHaveBeenCalledOnce()
      expect(onChanged).toHaveBeenCalledOnce()
      const job: SshMcpJobSummary = { jobId: 'job', sessionId: 'A', command: 'sleep 5', startedAt: 1, status: 'running' }
      publish([job])
      resolveInitial([])
      await Promise.resolve()
      expect(first.runningCount.value).toBe(1)
      expect(second.runningCount.value).toBe(1)
      session.value = 'C'
      expect(first.runningCount.value).toBe(0)
      expect(first.runningSessionIds.value.has('A')).toBe(true)
      panel.stop()
      expect(unsubscribe).not.toHaveBeenCalled()
      publish([{ ...job, status: 'completed', exitCode: 0 }])
      session.value = 'A'
      expect(first.runningCount.value).toBe(0)
      expect(first.sessionJobs.value[0].status).toBe('completed')
    } finally {
      panel.stop()
      workspace.stop()
    }
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
