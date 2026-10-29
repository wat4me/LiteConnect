import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../manager', () => ({ SSHManager: class {} }))
import { MonitorCollector } from './monitor'

afterEach(() => vi.useRealTimers())

it.each([false, true])('retimes live collection without losing cache or CPU samples (alerts only: %s)', async alertsOnly => {
  vi.useFakeTimers()
  let cpuSample = 0
  const exec = vi.fn(async (_session: string, command: string) => {
    if (command.includes('cat /proc/stat')) { cpuSample++; return `cpu ${cpuSample * 60} 0 0 ${cpuSample * 40}\ncpu0 ${cpuSample * 60} 0 0 ${cpuSample * 40}\n` }
    if (command === 'uname -a') return 'Linux test-server 6.8.0 x86_64'
    return ''
  })
  const collector = new MonitorCollector({ hasSession: () => true, sftpExec: exec } as never, vi.fn())
  collector.start('server', 'terminal', 5000, alertsOnly)
  await vi.advanceTimersByTimeAsync(0)
  expect(cpuSample).toBe(1)
  const cached = collector.getCached('server')!
  collector.updateInterval(2000)
  expect(collector.getCached('terminal')).toEqual(cached)
  expect(vi.getTimerCount()).toBe(alertsOnly ? 2 : 3)
  await vi.advanceTimersByTimeAsync(1999)
  expect(cpuSample).toBe(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(cpuSample).toBe(2)
  expect(collector.getCached('server')!.cpu.usage).toBe(60)
  collector.start('server', 'terminal', 3000, alertsOnly)
  await vi.advanceTimersByTimeAsync(2999)
  expect(cpuSample).toBe(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(cpuSample).toBe(3)
  collector.stopAll()
  expect(vi.getTimerCount()).toBe(0)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(cpuSample).toBe(3)
})
