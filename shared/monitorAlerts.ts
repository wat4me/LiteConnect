export interface MonitorAlertRule {
  enabled: boolean
  cpuThreshold: number
  memoryThreshold: number
  maxNotificationsPer24h: number
}

export const DEFAULT_MONITOR_ALERT_RULE: MonitorAlertRule = {
  enabled: false,
  cpuThreshold: 90,
  memoryThreshold: 90,
  maxNotificationsPer24h: 3,
}

export const MONITOR_ALERT_MAX_NOTIFICATIONS = 10
export const MONITOR_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000
export const MONITOR_ALERT_COOLDOWN_MS = 30 * 60 * 1000
export const MONITOR_ALERT_CONSECUTIVE_SAMPLES = 3

export function normalizeMonitorAlertRule(value: unknown): MonitorAlertRule {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const threshold = (input: unknown, fallback: number) =>
    typeof input === 'number' && Number.isFinite(input)
      ? Math.max(50, Math.min(99, Math.round(input))) : fallback
  return {
    enabled: raw.enabled === true,
    cpuThreshold: threshold(raw.cpuThreshold, DEFAULT_MONITOR_ALERT_RULE.cpuThreshold),
    memoryThreshold: threshold(raw.memoryThreshold, DEFAULT_MONITOR_ALERT_RULE.memoryThreshold),
    maxNotificationsPer24h: typeof raw.maxNotificationsPer24h === 'number' && Number.isFinite(raw.maxNotificationsPer24h)
      ? Math.max(1, Math.min(MONITOR_ALERT_MAX_NOTIFICATIONS, Math.round(raw.maxNotificationsPer24h)))
      : DEFAULT_MONITOR_ALERT_RULE.maxNotificationsPer24h,
  }
}
