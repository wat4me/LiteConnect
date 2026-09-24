import { getAppDatabase } from '../../store/appDatabase'
import { DEFAULT_MONITOR_ALERT_RULE, MONITOR_ALERT_WINDOW_MS, normalizeMonitorAlertRule, type MonitorAlertRule } from '../../../shared/monitorAlerts'

const RULES_KEY = 'monitor-alert-rules'
const SENT_KEY = 'monitor-alert-sent-times'

export class MonitorAlertStore {
  getRule(connectionId: string): MonitorAlertRule {
    const rules = getAppDatabase().getSingleton<Record<string, unknown>>(RULES_KEY) || {}
    return rules[connectionId] === undefined
      ? { ...DEFAULT_MONITOR_ALERT_RULE }
      : normalizeMonitorAlertRule(rules[connectionId])
  }

  setRule(connectionId: string, value: unknown): MonitorAlertRule {
    const rule = normalizeMonitorAlertRule(value)
    const db = getAppDatabase()
    const rules = db.getSingleton<Record<string, unknown>>(RULES_KEY) || {}
    db.setSingleton(RULES_KEY, { ...rules, [connectionId]: rule })
    return rule
  }

  getSentTimes(connectionId: string, now: number): number[] {
    const all = getAppDatabase().getSingleton<Record<string, unknown>>(SENT_KEY) || {}
    const raw = all[connectionId]
    return Array.isArray(raw)
      ? raw.filter((value): value is number => typeof value === 'number' && value > now - MONITOR_ALERT_WINDOW_MS && value <= now)
      : []
  }

  recordSent(connectionId: string, now: number): void {
    const db = getAppDatabase()
    const all = db.getSingleton<Record<string, unknown>>(SENT_KEY) || {}
    db.setSingleton(SENT_KEY, { ...all, [connectionId]: [...this.getSentTimes(connectionId, now), now] })
  }

  removeSent(connectionId: string, at: number): void {
    const db = getAppDatabase()
    const all = db.getSingleton<Record<string, unknown>>(SENT_KEY) || {}
    const raw = all[connectionId]
    if (!Array.isArray(raw)) return
    db.setSingleton(SENT_KEY, { ...all, [connectionId]: raw.filter(value => value !== at) })
  }

  delete(connectionId: string): void {
    const db = getAppDatabase()
    for (const key of [RULES_KEY, SENT_KEY]) {
      const all = db.getSingleton<Record<string, unknown>>(key) || {}
      if (!(connectionId in all)) continue
      const next = { ...all }
      delete next[connectionId]
      db.setSingleton(key, next)
    }
  }
}
