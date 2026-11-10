import { beforeEach, describe, expect, it, vi } from 'vitest'

const values = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../../store/appDatabase', () => ({
  getAppDatabase: () => ({
    getSingleton: (key: string) => values.get(key),
    setSingleton: (key: string, value: unknown) => values.set(key, value),
  }),
}))

import { MonitorAlertStore } from './monitorAlertStore'
import { DEFAULT_MONITOR_ALERT_RULE, isValidMonitorAlertRule, normalizeMonitorAlertRule } from '../../../shared/monitorAlerts'

describe('isValidMonitorAlertRule', () => {
  it('accepts defaults and custom thresholds inside the shared bounds', () => {
    expect(isValidMonitorAlertRule(DEFAULT_MONITOR_ALERT_RULE)).toBe(true)
    expect(isValidMonitorAlertRule({ ...DEFAULT_MONITOR_ALERT_RULE, cpuThreshold: 50, memoryThreshold: 99, maxNotificationsPer24h: 10 })).toBe(true)
    expect(isValidMonitorAlertRule({ ...DEFAULT_MONITOR_ALERT_RULE, cpuThreshold: 60 })).toBe(true)
  })

  it('rejects out-of-range, fractional and invalid notification limits', () => {
    expect(isValidMonitorAlertRule({ ...DEFAULT_MONITOR_ALERT_RULE, cpuThreshold: 49 })).toBe(false)
    expect(isValidMonitorAlertRule({ ...DEFAULT_MONITOR_ALERT_RULE, memoryThreshold: 100 })).toBe(false)
    expect(isValidMonitorAlertRule({ ...DEFAULT_MONITOR_ALERT_RULE, cpuThreshold: 60.5 })).toBe(false)
    expect(isValidMonitorAlertRule({ ...DEFAULT_MONITOR_ALERT_RULE, maxNotificationsPer24h: 0 })).toBe(false)
    expect(isValidMonitorAlertRule({ ...DEFAULT_MONITOR_ALERT_RULE, maxNotificationsPer24h: 11 })).toBe(false)
  })

  it('uses the same bounds as normalizeMonitorAlertRule', () => {
    expect(isValidMonitorAlertRule(normalizeMonitorAlertRule({ cpuThreshold: 120, memoryThreshold: 1, maxNotificationsPer24h: 999 }))).toBe(true)
  })
})

describe('MonitorAlertStore', () => {
  beforeEach(() => values.clear())

  it('keeps disabled defaults and clamps user limits', () => {
    const store = new MonitorAlertStore()
    expect(store.getRule('host').enabled).toBe(false)
    expect(store.setRule('host', { enabled: true, cpuThreshold: 120, memoryThreshold: 10, maxNotificationsPer24h: 999 }))
      .toEqual({ enabled: true, backgroundEnabled: false, cpuThreshold: 99, memoryThreshold: 50, maxNotificationsPer24h: 10 })
    expect(new MonitorAlertStore().getRule('host').enabled).toBe(true)
    expect(store.getBackgroundConnectionIds()).toEqual([])
    store.setRule('host', { enabled: true, backgroundEnabled: true })
    expect(new MonitorAlertStore().getBackgroundConnectionIds()).toEqual(['host'])
  })

  it('persists a rolling 24-hour count and removes it with the connection', () => {
    const store = new MonitorAlertStore()
    const day = 24 * 60 * 60 * 1000
    store.recordSent('host', 100)
    store.recordSent('host', 200)
    expect(new MonitorAlertStore().getSentTimes('host', 200)).toEqual([100, 200])
    store.removeSent('host', 100)
    expect(store.getSentTimes('host', 200)).toEqual([200])
    expect(store.getSentTimes('host', day + 101)).toEqual([200])
    store.delete('host')
    expect(store.getSentTimes('host', day + 101)).toEqual([])
    expect(store.getRule('host').enabled).toBe(false)
  })
})
