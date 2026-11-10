export interface MonitorAlertRule {
  enabled: boolean
  /** Keep monitoring through a dedicated SSH connection when no terminal is open. */
  backgroundEnabled: boolean
  cpuThreshold: number
  memoryThreshold: number
  maxNotificationsPer24h: number
}

export type BackgroundMonitorStatus = {
  state: 'off' | 'terminal-only' | 'using-terminal' | 'connecting' | 'sampling' | 'monitoring' | 'retrying' | 'needs-attention' | 'unavailable'
  detail?: string
  nextRetryAt?: number
}

export const DEFAULT_MONITOR_ALERT_RULE: MonitorAlertRule = {
  enabled: false,
  backgroundEnabled: false,
  cpuThreshold: 90,
  memoryThreshold: 90,
  maxNotificationsPer24h: 3,
}

export const MONITOR_ALERT_MIN_THRESHOLD = 50
export const MONITOR_ALERT_MAX_THRESHOLD = 99
export const MONITOR_ALERT_MIN_NOTIFICATIONS = 1
export const MONITOR_ALERT_MAX_NOTIFICATIONS = 10
export const MONITOR_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000
export const MONITOR_ALERT_COOLDOWN_MS = 30 * 60 * 1000
export const MONITOR_ALERT_CONSECUTIVE_SAMPLES = 3

/** Shared by the dock alert dialog and the global background-monitor settings. */
export function isValidMonitorAlertRule(value: MonitorAlertRule): boolean {
  return [value.cpuThreshold, value.memoryThreshold, value.maxNotificationsPer24h].every(Number.isInteger)
    && value.cpuThreshold >= MONITOR_ALERT_MIN_THRESHOLD && value.cpuThreshold <= MONITOR_ALERT_MAX_THRESHOLD
    && value.memoryThreshold >= MONITOR_ALERT_MIN_THRESHOLD && value.memoryThreshold <= MONITOR_ALERT_MAX_THRESHOLD
    && value.maxNotificationsPer24h >= MONITOR_ALERT_MIN_NOTIFICATIONS
    && value.maxNotificationsPer24h <= MONITOR_ALERT_MAX_NOTIFICATIONS
}

export function normalizeMonitorAlertRule(value: unknown): MonitorAlertRule {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const threshold = (input: unknown, fallback: number) =>
    typeof input === 'number' && Number.isFinite(input)
      ? Math.max(MONITOR_ALERT_MIN_THRESHOLD, Math.min(MONITOR_ALERT_MAX_THRESHOLD, Math.round(input))) : fallback
  return {
    enabled: raw.enabled === true,
    backgroundEnabled: raw.backgroundEnabled === true,
    cpuThreshold: threshold(raw.cpuThreshold, DEFAULT_MONITOR_ALERT_RULE.cpuThreshold),
    memoryThreshold: threshold(raw.memoryThreshold, DEFAULT_MONITOR_ALERT_RULE.memoryThreshold),
    maxNotificationsPer24h: typeof raw.maxNotificationsPer24h === 'number' && Number.isFinite(raw.maxNotificationsPer24h)
      ? Math.max(MONITOR_ALERT_MIN_NOTIFICATIONS, Math.min(MONITOR_ALERT_MAX_NOTIFICATIONS, Math.round(raw.maxNotificationsPer24h)))
      : DEFAULT_MONITOR_ALERT_RULE.maxNotificationsPer24h,
  }
}
