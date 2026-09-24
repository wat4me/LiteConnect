import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitorData } from '../../../shared/types/monitor'

const fixtures = vi.hoisted(() => ({
  rules: new Map<string, unknown>(),
  sent: new Map<string, number[]>(),
  notifications: [] as Array<{ title: string; body: string; show: ReturnType<typeof vi.fn> }>,
}))

vi.mock('./monitorAlertStore', () => ({
  MonitorAlertStore: class {
    getRule(id: string) { return fixtures.rules.get(id) || { enabled: false, cpuThreshold: 90, memoryThreshold: 90, maxNotificationsPer24h: 3 } }
    setRule(id: string, value: unknown) { fixtures.rules.set(id, value); return value }
    getSentTimes(id: string, now: number) { return (fixtures.sent.get(id) || []).filter(time => time > now - 86_400_000) }
    recordSent(id: string, now: number) { fixtures.sent.set(id, [...(fixtures.sent.get(id) || []), now]) }
    removeSent(id: string, at: number) { fixtures.sent.set(id, (fixtures.sent.get(id) || []).filter(time => time !== at)) }
    delete(id: string) { fixtures.rules.delete(id); fixtures.sent.delete(id) }
  },
}))

vi.mock('electron', () => ({
  Notification: class {
    static isSupported() { return true }
    show = vi.fn()
    on = vi.fn()
    constructor(public options: { title: string; body: string }) {
      fixtures.notifications.push({ title: options.title, body: options.body, show: this.show })
    }
  },
}))

import { MonitorAlerts } from './monitorAlerts'

const highCpu: MonitorData = {
  hostname: 'web', kernel: '', arch: '', uptime: '', timestamp: 0,
  cpu: { usage: 95, cores: [], loadAvg: [0, 0, 0] },
  memory: { total: 100, used: 40, free: 60, buffCache: 0, available: 60, swapTotal: 0, swapUsed: 0 },
  disk: [], processes: [],
}

describe('MonitorAlerts', () => {
  beforeEach(() => {
    fixtures.rules.clear()
    fixtures.sent.clear()
    fixtures.notifications.length = 0
    vi.restoreAllMocks()
  })

  it('keeps collecting after the panel closes only when an alert rule is enabled', () => {
    const collector = { start: vi.fn(), stop: vi.fn() }
    const alerts = new MonitorAlerts(collector as never, () => 5000, () => 'web', () => null)
    alerts.attach('host', 'session')
    expect(collector.start).not.toHaveBeenCalled()
    alerts.startPanel('host', 'session')
    expect(collector.start).toHaveBeenCalledOnce()
    alerts.setRule('host', { enabled: true, cpuThreshold: 90, memoryThreshold: 90, maxNotificationsPer24h: 3 })
    alerts.stopPanel('host')
    expect(collector.stop).not.toHaveBeenCalled()
    alerts.detach('session')
    expect(collector.stop).toHaveBeenCalledOnce()
  })

  it('sends at most the configured number in a rolling day', () => {
    const collector = { start: vi.fn(), stop: vi.fn() }
    const alerts = new MonitorAlerts(collector as never, () => 5000, () => 'web', () => null)
    alerts.setRule('host', { enabled: true, cpuThreshold: 90, memoryThreshold: 90, maxNotificationsPer24h: 1 })
    alerts.attach('host', 'session')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    for (let i = 0; i < 4; i++) alerts.onData('host', highCpu, ['cpu'])
    expect(fixtures.notifications).toHaveLength(1)
    expect(fixtures.notifications[0].body).toContain('CPU 95.0%')
    clock.mockReturnValue(1_000_000 + 60 * 60 * 1000)
    alerts.onData('host', highCpu, ['cpu'])
    expect(fixtures.notifications).toHaveLength(1)
  })

  it('falls back to another live terminal for the same server', () => {
    const collector = { start: vi.fn(), stop: vi.fn() }
    const alerts = new MonitorAlerts(collector as never, () => 5000, () => 'web', () => null)
    alerts.setRule('host', { enabled: true, cpuThreshold: 90, memoryThreshold: 90, maxNotificationsPer24h: 3 })
    alerts.attach('host', 'first')
    alerts.attach('host', 'second')
    alerts.detach('second')
    expect(collector.stop).toHaveBeenCalledOnce()
    expect(collector.start).toHaveBeenLastCalledWith('host', 'first', 5000)
  })
})
