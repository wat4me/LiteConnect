import { expect, it } from 'vitest'
import type { SshMcpJobSummary } from '@shared/mcp/types'
import { backgroundJobElapsedSeconds, formatBackgroundJobDuration } from './backgroundJobDuration'

const job: SshMcpJobSummary = { jobId: 'job', sessionId: 'host', command: 'inspect', status: 'running', startedAt: 1000 }

it('counts from actual start time and clamps future starts to zero', () => {
  expect(backgroundJobElapsedSeconds(job, 63999)).toBe(62)
  expect(backgroundJobElapsedSeconds(job, 0)).toBe(0)
  expect(backgroundJobElapsedSeconds({ ...job, finishedAt: 2000 }, 64000)).toBe(63)
})

it.each(['completed', 'failed', 'cancelled', 'timeout'] as const)('freezes %s duration at the actual finish timestamp', status => {
  const finished = { ...job, status, finishedAt: 125000 }
  expect(backgroundJobElapsedSeconds(finished, 130000)).toBe(124)
  expect(backgroundJobElapsedSeconds(finished, 999999)).toBe(124)
  expect(backgroundJobElapsedSeconds({ ...job, status }, 999999)).toBeNull()
})

it('does not invent durations from missing or invalid timestamps', () => {
  expect(backgroundJobElapsedSeconds({ ...job, startedAt: NaN }, 10000)).toBeNull()
  expect(backgroundJobElapsedSeconds({ ...job, status: 'failed', finishedAt: Infinity }, 10000)).toBeNull()
})

it.each([[0, '00:00'], [59, '00:59'], [60, '01:00'], [3599, '59:59'], [3600, '01:00:00'], [90061, '25:01:01'], [null, '—']] as const)('formats %s seconds as %s', (seconds, expected) => {
  expect(formatBackgroundJobDuration(seconds)).toBe(expected)
})
