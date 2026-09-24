import { beforeEach, describe, expect, it, vi } from 'vitest'

const values = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../../store/appDatabase', () => ({
  getAppDatabase: () => ({
    getSingleton: (key: string) => values.get(key),
    setSingleton: (key: string, value: unknown) => values.set(key, value),
  }),
}))

import { MonitorAlertStore } from './monitorAlertStore'

describe('MonitorAlertStore', () => {
  beforeEach(() => values.clear())

  it('keeps disabled defaults and clamps user limits', () => {
    const store = new MonitorAlertStore()
    expect(store.getRule('host').enabled).toBe(false)
    expect(store.setRule('host', { enabled: true, cpuThreshold: 120, memoryThreshold: 10, maxNotificationsPer24h: 999 }))
      .toEqual({ enabled: true, cpuThreshold: 99, memoryThreshold: 50, maxNotificationsPer24h: 10 })
    expect(new MonitorAlertStore().getRule('host').enabled).toBe(true)
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
