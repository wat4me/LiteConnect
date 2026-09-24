import type { MonitorData } from '../../../shared/types/monitor'
import type { MonitorAlertRule } from '../../../shared/monitorAlerts'
import { MONITOR_ALERT_CONSECUTIVE_SAMPLES, MONITOR_ALERT_COOLDOWN_MS } from '../../../shared/monitorAlerts'

type Metric = 'cpu' | 'memory'
type MetricState = { streak: number; active: boolean }

export class MonitorAlertEvaluator {
  private readonly state = new Map<string, { cpu: MetricState; memory: MetricState }>()

  reset(connectionId: string): void {
    this.state.delete(connectionId)
  }

  evaluate(
    connectionId: string,
    data: MonitorData,
    updated: readonly (keyof MonitorData)[],
    rule: MonitorAlertRule,
    now: number,
    sentTimes: number[],
  ): Metric[] {
    if (!rule.enabled) return []
    let state = this.state.get(connectionId)
    if (!state) {
      state = { cpu: { streak: 0, active: false }, memory: { streak: 0, active: false } }
      this.state.set(connectionId, state)
    }
    const check = (metric: Metric, value: number, threshold: number) => {
      if (!Number.isFinite(value) || value < 0) return
      const current = state![metric]
      if (value >= threshold) {
        current.streak += 1
        if (current.streak >= MONITOR_ALERT_CONSECUTIVE_SAMPLES) current.active = true
      } else if (value <= threshold - 5) {
        current.streak = 0
        current.active = false
      }
    }
    if (updated.includes('cpu')) check('cpu', data.cpu.usage, rule.cpuThreshold)
    if (updated.includes('memory') && data.memory.total > 0) {
      check('memory', data.memory.used / data.memory.total * 100, rule.memoryThreshold)
    }
    const active = (['cpu', 'memory'] as const).filter(metric => state![metric].active)
    if (!active.length || sentTimes.length >= rule.maxNotificationsPer24h) return []
    const last = sentTimes.at(-1)
    if (last !== undefined && now - last < MONITOR_ALERT_COOLDOWN_MS) return []
    return [...active]
  }
}
