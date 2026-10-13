import { validateAiNotification, type AiNotificationInput, type AiNotificationSettings } from '../../shared/aiNotifications'
import type { AiRunNotification, AiSchedule, AiScheduleRun } from '../../shared/aiSchedules'

export interface StoredAiNotification { enabled: boolean; mode: 'issues' | 'all'; sealedUrl: string; sealedToken: string }
export class AiScheduleNotifier {
  constructor(private readonly ports: {
    read: () => StoredAiNotification | undefined
    save: (value: StoredAiNotification) => void
    seal: (value: string) => string
    unseal: (value: string) => string
    post?: typeof fetch
    timeoutMs?: number
  }) {}
  private stored() { return this.ports.read() || { enabled: false, mode: 'issues' as const, sealedUrl: '', sealedToken: '' } }
  settings(): AiNotificationSettings {
    const stored = this.stored()
    return { enabled: stored.enabled, mode: stored.mode, url: this.ports.unseal(stored.sealedUrl), hasToken: !!stored.sealedToken }
  }
  save(input: AiNotificationInput) {
    const value = validateAiNotification(input)
    const previous = this.stored()
    // Never silently forward a saved bearer token to a different endpoint.
    let sameUrl = false
    if (value.token === undefined) { try { sameUrl = value.url === this.ports.unseal(previous.sealedUrl) } catch { /* A new address can replace inaccessible settings. */ } }
    const sealedToken = value.token === undefined ? sameUrl ? previous.sealedToken : '' : this.ports.seal(value.token)
    this.ports.save({ enabled: value.enabled, mode: value.mode, sealedUrl: this.ports.seal(value.url), sealedToken })
    return this.settings()
  }
  async notify(plan: AiSchedule, run: AiScheduleRun, signal: AbortSignal): Promise<AiRunNotification> {
    const settings = this.stored()
    if (!settings.enabled || run.status === 'cancelled' || (settings.mode === 'issues' && run.status === 'completed' && run.health === 'healthy')) return { status: 'skipped' }
    return this.send({ event: 'liteconnect.inspection.completed', version: 1, id: run.id, plan: { id: plan.id, name: plan.name },
      result: { status: run.status, health: run.health || 'unknown', startedAt: run.startedAt, finishedAt: run.finishedAt,
        summary: run.content?.slice(0, 6000), error: run.error?.slice(0, 500),
        hosts: run.hosts?.map(host => ({ name: host.name, status: host.status, health: host.health || 'unknown', error: host.error?.slice(0, 300) })) } }, signal)
  }
  test(signal = new AbortController().signal) { return this.send({ event: 'liteconnect.notification.test', version: 1, message: 'LiteConnect 巡检通知测试' }, signal) }
  private async send(body: unknown, parent: AbortSignal): Promise<AiRunNotification> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    parent.addEventListener('abort', abort, { once: true })
    if (parent.aborted) abort()
    const timer = setTimeout(abort, this.ports.timeoutMs ?? 8000)
    try {
      const settings = this.stored()
      const url = this.ports.unseal(settings.sealedUrl)
      if (!url) throw new Error('missing endpoint')
      const token = this.ports.unseal(settings.sealedToken)
      const response = await (this.ports.post || fetch)(url, { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
      await response.body?.cancel().catch(() => {})
      return response.ok ? { status: 'sent', at: Date.now() } : { status: 'failed', at: Date.now(), error: `通知服务返回 HTTP ${response.status}。` }
    } catch {
      // Network/provider errors may embed endpoint query tokens. Never persist them.
      return { status: 'failed', at: Date.now(), error: controller.signal.aborted ? '通知发送超时或已取消，未确认送达。' : '通知发送失败，请检查地址、网络或凭据。' }
    } finally { clearTimeout(timer); parent.removeEventListener('abort', abort) }
  }
}
