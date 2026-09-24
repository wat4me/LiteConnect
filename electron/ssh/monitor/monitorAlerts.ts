import { Notification, type BrowserWindow } from 'electron'
import type { MonitorData } from '../../../shared/types/monitor'
import type { MonitorAlertRule } from '../../../shared/monitorAlerts'
import { MONITOR_ALERT_WINDOW_MS } from '../../../shared/monitorAlerts'
import { MonitorAlertEvaluator } from './monitorAlertEvaluator'
import { MonitorAlertStore } from './monitorAlertStore'
import type { MonitorCollector } from './monitor'

export class MonitorAlerts {
  private readonly store = new MonitorAlertStore()
  private readonly evaluator = new MonitorAlertEvaluator()
  private readonly sessions = new Map<string, string[]>()
  private readonly panels = new Set<string>()
  private readonly recentSends = new Map<string, number[]>()

  constructor(
    private readonly collector: MonitorCollector,
    private readonly getIntervalMs: () => number,
    private readonly getConnectionName: (connectionId: string) => string,
    private readonly getWindow: () => BrowserWindow | null,
  ) {}

  getRule(connectionId: string): MonitorAlertRule {
    return this.store.getRule(connectionId)
  }

  setRule(connectionId: string, value: unknown): MonitorAlertRule {
    const rule = this.store.setRule(connectionId, value)
    this.evaluator.reset(connectionId)
    const sessionId = this.sessions.get(connectionId)?.at(-1)
    if (rule.enabled && sessionId) this.collector.start(connectionId, sessionId, this.getIntervalMs())
    else if (!rule.enabled && !this.panels.has(connectionId)) this.collector.stop(connectionId)
    return rule
  }

  attach(connectionId: string, sessionId: string): void {
    const previous = this.sessions.get(connectionId) || []
    this.sessions.set(connectionId, [...previous.filter(id => id !== sessionId), sessionId])
    if (this.getRule(connectionId).enabled || this.panels.has(connectionId)) {
      this.collector.start(connectionId, sessionId, this.getIntervalMs())
    }
  }

  detach(sessionId: string): void {
    for (const [connectionId, ids] of this.sessions) {
      if (!ids.includes(sessionId)) continue
      const remaining = ids.filter(id => id !== sessionId)
      if (remaining.length) this.sessions.set(connectionId, remaining)
      else this.sessions.delete(connectionId)
      if (ids.at(-1) !== sessionId) continue
      this.collector.stop(connectionId)
      this.evaluator.reset(connectionId)
      const fallback = remaining.at(-1)
      if (fallback && (this.getRule(connectionId).enabled || this.panels.has(connectionId))) {
        this.collector.start(connectionId, fallback, this.getIntervalMs())
      }
    }
  }

  startPanel(connectionId: string, sessionId: string): void {
    this.panels.add(connectionId)
    this.attach(connectionId, sessionId)
  }

  stopPanel(connectionId: string): void {
    this.panels.delete(connectionId)
    this.recentSends.delete(connectionId)
    if (!this.getRule(connectionId).enabled) this.collector.stop(connectionId)
  }

  deleteConnection(connectionId: string): void {
    this.store.delete(connectionId)
    this.evaluator.reset(connectionId)
    this.sessions.delete(connectionId)
    this.panels.delete(connectionId)
    this.collector.stop(connectionId)
  }

  onData(connectionId: string, data: MonitorData, updated: readonly (keyof MonitorData)[]): void {
    if (!updated.includes('cpu') && !updated.includes('memory')) return
    if (!this.sessions.has(connectionId)) return
    const rule = this.getRule(connectionId)
    if (!rule.enabled) return
    const now = Date.now()
    const local = (this.recentSends.get(connectionId) || []).filter(time => time > now - MONITOR_ALERT_WINDOW_MS)
    const sentTimes = [...new Set([...this.store.getSentTimes(connectionId, now), ...local])].sort((a, b) => a - b)
    const active = this.evaluator.evaluate(connectionId, data, updated, rule, now, sentTimes)
    if (!active.length || !Notification.isSupported()) return

    const details = active.map(metric => metric === 'cpu'
      ? `CPU ${data.cpu.usage.toFixed(1)}%`
      : `内存 ${(data.memory.used / data.memory.total * 100).toFixed(1)}%`).join('，')
    const name = this.getConnectionName(connectionId)
    const notification = new Notification({
      title: `LiteConnect · ${name} 资源告警`,
      body: `${details} 持续超过设定阈值。点击查看服务器监控。`,
    })
    notification.on('click', () => {
      const win = this.getWindow()
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send('monitor:alertClick', connectionId)
    })
    let failed = false
    notification.on('failed', (_event, error) => {
      failed = true
      this.recentSends.set(connectionId, (this.recentSends.get(connectionId) || []).filter(time => time !== now))
      try {
        this.store.removeSent(connectionId, now)
      } catch (err) {
        console.warn('[Monitor Alert] failed to roll back notification count:', err)
      }
      console.warn('[Monitor Alert] native notification failed:', error)
    })
    try {
      notification.show()
      if (failed) return
      this.recentSends.set(connectionId, [...local, now])
    } catch (err) {
      console.warn('[Monitor Alert] notification failed:', err)
      return
    }
    try {
      this.store.recordSent(connectionId, now)
    } catch (err) {
      console.warn('[Monitor Alert] failed to persist notification count:', err)
    }
  }
}
