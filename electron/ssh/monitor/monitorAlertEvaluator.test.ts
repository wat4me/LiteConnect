import { describe, expect, it } from 'vitest'
import { MonitorAlertEvaluator } from './monitorAlertEvaluator'
import { DEFAULT_MONITOR_ALERT_RULE } from '../../../shared/monitorAlerts'
import type { MonitorData } from '../../../shared/types/monitor'

const rule = { ...DEFAULT_MONITOR_ALERT_RULE, enabled: true }
const sample = (cpu: number, usedPercent: number): MonitorData => ({
  hostname: 'web', kernel: '', arch: '', uptime: '', timestamp: 0,
  cpu: { usage: cpu, cores: [], loadAvg: [0, 0, 0] },
  memory: { total: 100, used: usedPercent, free: 0, buffCache: 0, available: 100 - usedPercent, swapTotal: 0, swapUsed: 0 },
  disk: [], processes: [],
})

describe('MonitorAlertEvaluator', () => {
  it('requires three fresh samples and ignores unrelated or invalid updates', () => {
    const alerts = new MonitorAlertEvaluator()
    expect(alerts.evaluate('host', sample(96, 96), [], rule, 0, [])).toEqual([])
    expect(alerts.evaluate('host', sample(-1, 96), ['cpu'], rule, 1, [])).toEqual([])
    expect(alerts.evaluate('host', sample(96, 96), ['cpu'], rule, 2, [])).toEqual([])
    expect(alerts.evaluate('host', sample(96, 96), ['cpu'], rule, 3, [])).toEqual([])
    expect(alerts.evaluate('host', sample(96, 96), ['cpu'], rule, 4, [])).toEqual(['cpu'])
  })

  it('applies cooldown and a rolling 24-hour cap across both metrics', () => {
    const alerts = new MonitorAlertEvaluator()
    for (let i = 0; i < 2; i++) alerts.evaluate('host', sample(95, 95), ['cpu', 'memory'], rule, i, [])
    expect(alerts.evaluate('host', sample(95, 95), ['cpu', 'memory'], rule, 2, [])).toEqual(['cpu', 'memory'])
    const sent = [2]
    expect(alerts.evaluate('host', sample(95, 95), ['cpu'], rule, 60_000, sent)).toEqual([])
    expect(alerts.evaluate('host', sample(95, 95), ['cpu'], rule, 31 * 60_000, sent)).toEqual(['cpu', 'memory'])
    expect(alerts.evaluate('host', sample(95, 95), ['cpu'], { ...rule, maxNotificationsPer24h: 1 }, 31 * 60_000, sent)).toEqual([])
  })

  it('clears an alert after recovery with a five-point margin', () => {
    const alerts = new MonitorAlertEvaluator()
    for (let i = 0; i < 3; i++) alerts.evaluate('host', sample(94, 0), ['cpu'], rule, i, [])
    expect(alerts.evaluate('host', sample(84, 0), ['cpu'], rule, 3, [])).toEqual([])
    expect(alerts.evaluate('host', sample(94, 0), ['cpu'], rule, 4, [])).toEqual([])
    expect(alerts.evaluate('host', sample(94, 0), ['cpu'], rule, 5, [])).toEqual([])
    expect(alerts.evaluate('host', sample(94, 0), ['cpu'], rule, 6, [])).toEqual(['cpu'])
  })
})
