import type { CredentialStore } from '../../store/credentialStore'
import type { SSHManager } from '../manager'
import { isNonRetryableSshError } from '../../../shared/sshErrorRetry'
import type { MonitorAlerts } from './monitorAlerts'
import type { BackgroundMonitorStatus } from '../../../shared/monitorAlerts'
import type { MonitorData } from '../../../shared/types/monitor'

const MAX_RETRY_MS = 5 * 60 * 1000
const SAMPLE_TIMEOUT_MS = 30_000

/** Owns one non-interactive SSH session per opted-in server only while no terminal is open. */
export class BackgroundMonitor {
  private running = false
  private disposed = false
  private readonly sessions = new Map<string, string>()
  private readonly connecting = new Set<string>()
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly sampleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly failures = new Map<string, number>()
  private readonly generations = new Map<string, number>()
  private readonly statuses = new Map<string, BackgroundMonitorStatus>()
  private readonly intentionalStops = new Set<string>()

  constructor(
    private readonly ssh: SSHManager,
    private readonly credentials: CredentialStore,
    private readonly alerts: MonitorAlerts,
  ) {}

  start(): void {
    if (this.running || this.disposed) return
    this.running = true
    for (const connectionId of this.alerts.getBackgroundConnectionIds()) this.refresh(connectionId)
  }

  stop(): void {
    this.running = false
    for (const timer of this.retries.values()) clearTimeout(timer)
    this.retries.clear()
    for (const timer of this.sampleTimers.values()) clearTimeout(timer)
    this.sampleTimers.clear()
    for (const id of new Set([...this.sessions.keys(), ...this.connecting])) {
      this.bump(id)
      this.stopSession(id)
    }
    this.statuses.clear()
    this.failures.clear()
  }

  dispose(): void {
    this.disposed = true
    this.stop()
  }

  getStatus(connectionId: string): BackgroundMonitorStatus {
    const rule = this.alerts.getRule(connectionId)
    if (!rule.enabled) return { state: 'off' }
    if (!rule.backgroundEnabled) return { state: 'terminal-only' }
    if (this.alerts.hasSession(connectionId, this.sessions.get(connectionId))) return { state: 'using-terminal' }
    return this.statuses.get(connectionId) || { state: 'connecting' }
  }

  onSample(connectionId: string, data: MonitorData, updated: readonly (keyof MonitorData)[]): void {
    if (!this.sessions.has(connectionId)) return
    const validCpu = updated.includes('cpu') && Number.isFinite(data.cpu.usage) && data.cpu.usage >= 0
    const validMemory = updated.includes('memory') && data.memory.total > 0
    if (!validCpu && !validMemory) return
    this.clearSampleTimer(connectionId)
    this.statuses.set(connectionId, { state: 'monitoring' })
  }

  refresh(connectionId: string): void {
    const retry = this.retries.get(connectionId)
    if (retry) clearTimeout(retry)
    this.retries.delete(connectionId)
    this.failures.delete(connectionId)
    if (this.statuses.get(connectionId)?.state === 'needs-attention') this.statuses.delete(connectionId)
    if (!this.shouldRun(connectionId)) {
      this.bump(connectionId)
      this.stopSession(connectionId)
      this.statuses.delete(connectionId)
      return
    }
    this.ensure(connectionId)
  }

  connectionChanged(connectionId: string): void {
    this.bump(connectionId)
    this.stopSession(connectionId)
    this.refresh(connectionId)
  }

  foregroundAttached(connectionId: string): void {
    this.bump(connectionId)
    const retry = this.retries.get(connectionId)
    if (retry) clearTimeout(retry)
    this.retries.delete(connectionId)
    this.stopSession(connectionId)
    this.statuses.set(connectionId, { state: 'using-terminal' })
  }

  sessionTeardown(sessionId: string): void {
    if (this.intentionalStops.has(sessionId)) return
    const backgroundId = [...this.sessions].find(([, id]) => id === sessionId)?.[0]
    if (backgroundId) {
      this.clearSampleTimer(backgroundId)
      this.sessions.delete(backgroundId)
      if (this.shouldRun(backgroundId) && !this.alerts.hasSession(backgroundId)) {
        this.scheduleRetry(backgroundId, '后台 SSH 连接已断开')
      }
      return
    }
    if (!this.running) return
    for (const id of this.alerts.getBackgroundConnectionIds()) {
      if (!this.alerts.hasSession(id) && !this.sessions.has(id)) this.ensure(id)
    }
  }

  private shouldRun(connectionId: string): boolean {
    const rule = this.alerts.getRule(connectionId)
    return this.running && rule.enabled && rule.backgroundEnabled && !!this.credentials.getConnection(connectionId)
  }

  private bump(connectionId: string): number {
    const next = (this.generations.get(connectionId) || 0) + 1
    this.generations.set(connectionId, next)
    return next
  }

  private stopSession(connectionId: string): void {
    this.clearSampleTimer(connectionId)
    const sessionId = this.sessions.get(connectionId)
    if (!sessionId) return
    this.sessions.delete(connectionId)
    this.intentionalStops.add(sessionId)
    try {
      this.ssh.disconnect(sessionId)
    } finally {
      this.intentionalStops.delete(sessionId)
    }
  }

  private clearSampleTimer(connectionId: string): void {
    const timer = this.sampleTimers.get(connectionId)
    if (timer) clearTimeout(timer)
    this.sampleTimers.delete(connectionId)
  }

  private ensure(connectionId: string): void {
    if (!this.shouldRun(connectionId) || this.connecting.has(connectionId)
      || this.sessions.has(connectionId) || this.retries.has(connectionId)
      || this.statuses.get(connectionId)?.state === 'needs-attention') return
    if (this.alerts.hasSession(connectionId)) {
      this.statuses.set(connectionId, { state: 'using-terminal' })
      return
    }
    const generation = this.bump(connectionId)
    this.connecting.add(connectionId)
    this.statuses.set(connectionId, { state: 'connecting' })
    void this.connect(connectionId, generation)
  }

  private async connect(connectionId: string, generation: number): Promise<void> {
    let stale = false
    let connectedSessionId: string | undefined
    try {
      const connection = this.credentials.getConnectionForAuth(connectionId)
      if (!connection) throw new Error('服务器连接已删除')
      const sessionId = await this.ssh.connect({
        ...connection,
        x11Forwarding: false,
        localForwards: [],
        remoteForwards: [],
        dynamicForwards: [],
      }, {
        onData: () => {},
        onClose: () => {},
        onError: () => {},
        onKeyboardInteractive: async () => null,
      })
      connectedSessionId = sessionId
      stale = generation !== this.generations.get(connectionId)
        || !this.shouldRun(connectionId) || this.alerts.hasSession(connectionId)
      if (stale) {
        this.ssh.disconnect(sessionId)
        return
      }
      if (!this.ssh.hasSession(sessionId)) {
        this.scheduleRetry(connectionId, '后台 SSH 连接在采样前已断开')
        return
      }
      this.sessions.set(connectionId, sessionId)
      this.failures.delete(connectionId)
      this.statuses.set(connectionId, { state: 'sampling' })
      this.sampleTimers.set(connectionId, setTimeout(() => {
        this.sampleTimers.delete(connectionId)
        if (this.sessions.get(connectionId) === sessionId && this.statuses.get(connectionId)?.state === 'sampling') {
          this.statuses.set(connectionId, {
            state: 'unavailable',
            detail: 'SSH 已连接，但未能获取 CPU 或内存数据；请检查服务器监控命令',
          })
        }
      }, SAMPLE_TIMEOUT_MS))
      this.alerts.attach(connectionId, sessionId, true)
    } catch (error) {
      if (connectedSessionId) {
        if (this.sessions.get(connectionId) === connectedSessionId) this.stopSession(connectionId)
        else this.ssh.disconnect(connectedSessionId)
      }
      if (generation !== this.generations.get(connectionId) || !this.shouldRun(connectionId)) {
        stale = true
        return
      }
      const detail = error instanceof Error ? error.message : String(error)
      if (isNonRetryableSshError(detail) || /decrypt|解密/i.test(detail)) {
        this.statuses.set(connectionId, { state: 'needs-attention', detail: '请手动连接服务器，检查主机密钥或认证信息' })
      } else {
        this.scheduleRetry(connectionId, detail.slice(0, 160))
      }
    } finally {
      this.connecting.delete(connectionId)
      if (stale && this.shouldRun(connectionId) && !this.alerts.hasSession(connectionId)) this.ensure(connectionId)
    }
  }

  private scheduleRetry(connectionId: string, detail: string): void {
    if (this.retries.has(connectionId) || !this.shouldRun(connectionId)) return
    const failures = (this.failures.get(connectionId) || 0) + 1
    this.failures.set(connectionId, failures)
    const delay = Math.min(MAX_RETRY_MS, 5000 * 2 ** Math.min(failures - 1, 6))
    this.statuses.set(connectionId, { state: 'retrying', detail, nextRetryAt: Date.now() + delay })
    this.retries.set(connectionId, setTimeout(() => {
      this.retries.delete(connectionId)
      this.ensure(connectionId)
    }, delay))
  }
}
