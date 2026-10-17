import type { SshMcpJobSummary } from '@shared/mcp/types'

export function backgroundJobElapsedSeconds(job: SshMcpJobSummary, now: number): number | null {
  const end = job.status === 'running' ? now : job.finishedAt
  if (!Number.isFinite(job.startedAt) || end == null || !Number.isFinite(end)) return null
  return Math.floor(Math.max(0, end - job.startedAt) / 1000)
}

export function formatBackgroundJobDuration(seconds: number | null): string {
  if (seconds == null) return '—'
  const pad = (value: number) => String(value).padStart(2, '0')
  const hours = Math.floor(seconds / 3600)
  return `${hours ? `${pad(hours)}:` : ''}${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
}
