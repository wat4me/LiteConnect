import { randomUUID } from 'crypto'
import { aiScheduleHasToolFailure, aiScheduleTimingKey, nextAiScheduleRun, validateAiSchedule, type AiRunNotification, type AiScheduleExecutionResult, type AiScheduleHostRun, type AiSchedule, type AiScheduleInput, type AiScheduleRun, type AiScheduleSnapshot } from '../../../shared/aiSchedules'

/** Local scheduler. The clock checks plans; it never polls SSH or AI. */
export class AiScheduler {
  private state: AiScheduleSnapshot
  private active?: { run: AiScheduleRun; controller: AbortController; timeout: ReturnType<typeof setTimeout> }
  private timer?: ReturnType<typeof setInterval>
  private deliveries = new Map<string, AbortController>()
  private disposed = false
  private timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  constructor(private readonly ports: {
    read: () => AiScheduleSnapshot
    save: (state: AiScheduleSnapshot) => void
    execute: (plan: AiSchedule, runId: string, signal: AbortSignal, progress: (hosts: AiScheduleHostRun[]) => void) => Promise<AiScheduleExecutionResult>
    notify?: (plan: AiSchedule, run: AiScheduleRun, signal: AbortSignal) => Promise<AiRunNotification>
    changed: (state: AiScheduleSnapshot) => void
    now?: () => number
    timeoutMs?: number
    onError?: (error: unknown) => void
  }) {
    this.state = structuredClone(ports.read())
    // A closed app cannot retain a live SSH execution. Do not leave stale spinners.
    let recovered = false
    for (const run of this.state.runs) if (run.status === 'running' || (run.status === 'cancelled' && run.finishedAt == null)) {
      Object.assign(run, { status: 'cancelled', finishedAt: this.now(), error: '应用关闭，执行已中断。' })
      recovered = true
    }
    for (const plan of this.state.plans) if (plan.timing && plan.timing.kind !== 'interval' && plan.timeZone !== this.timeZone) {
      plan.nextRunAt = nextAiScheduleRun(plan, this.now())
      plan.timeZone = this.timeZone
      recovered = true
    }
    for (const run of this.state.runs) if (run.notification?.status === 'sending') {
      run.notification = { status: 'failed', at: this.now(), error: '应用关闭，未确认通知送达。' }; recovered = true
    }
    for (const run of this.state.runs) if (run.status !== 'running') for (const host of run.hosts || []) if (host.status === 'queued' || host.status === 'running') {
      host.status = 'cancelled'; recovered = true
    }
    if (recovered) this.persist()
  }
  private now() { return this.ports.now?.() ?? Date.now() }
  snapshot(): AiScheduleSnapshot { return structuredClone(this.state) }
  private persist() {
    this.ports.save(this.snapshot())
    this.notify()
  }
  private notify() {
    try { this.ports.changed(this.snapshot()) } catch (error) { this.ports.onError?.(error) }
  }
  start() {
    if (this.disposed || this.timer) return
    this.timer = setInterval(() => this.tick(), 30_000)
    this.timer.unref?.()
    this.tick()
  }
  save(input: AiScheduleInput) {
    if (this.disposed) throw new Error('Scheduler is unavailable')
    if (this.active) throw new Error('请先中断正在执行的巡检。')
    const value = validateAiSchedule(input)
    const previous = value.id ? this.state.plans.find(plan => plan.id === value.id) : undefined
    if (value.id && !previous) throw new Error('Schedule not found')
    if (!previous && this.state.plans.length >= 50) throw new Error('最多保存 50 个巡检计划。')
    const time = this.now()
    const plan: AiSchedule = { ...value, id: previous?.id || randomUUID(), createdAt: previous?.createdAt ?? time, updatedAt: time,
      timeZone: value.timing && value.timing.kind !== 'interval' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
      nextRunAt: previous && previous.enabled === value.enabled && aiScheduleTimingKey(previous) === aiScheduleTimingKey(value) &&
        (!value.timing || value.timing.kind === 'interval' || previous.timeZone === Intl.DateTimeFormat().resolvedOptions().timeZone) ? previous.nextRunAt : nextAiScheduleRun(value, time) }
    const next = this.snapshot()
    const index = next.plans.findIndex(item => item.id === plan.id)
    if (index >= 0) next.plans[index] = plan
    else next.plans.push(plan)
    this.ports.save(next)
    this.state = next
    this.notify()
    return structuredClone(plan)
  }
  remove(id: string) {
    if (this.active) throw new Error('请先中断正在执行的巡检。')
    const next = this.snapshot()
    next.plans = next.plans.filter(plan => plan.id !== id)
    next.runs = next.runs.filter(run => run.scheduleId !== id)
    this.ports.save(next)
    this.state = next
    this.notify()
  }
  tick() {
    if (this.disposed || this.active) return
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone !== this.timeZone) {
      this.timeZone = zone
      for (const plan of this.state.plans) if (plan.timing && plan.timing.kind !== 'interval') {
        plan.nextRunAt = nextAiScheduleRun(plan, this.now())
        plan.timeZone = zone
      }
      try { this.persist() } catch (error) { this.ports.onError?.(error); return }
    }
    const due = this.state.plans.filter(plan => plan.enabled && plan.nextRunAt <= this.now()).sort((a, b) => a.nextRunAt - b.nextRunAt)[0]
    if (due) void this.executeRun(due.id, true).catch(error => this.ports.onError?.(error))
  }
  runNow(id: string) { return this.executeRun(id, false) }
  private async executeRun(id: string, scheduled: boolean) {
    if (this.disposed) throw new Error('Scheduler is unavailable')
    if (this.active) throw new Error('已有巡检正在执行，请稍后重试。')
    const plan = this.state.plans.find(item => item.id === id)
    if (!plan) throw new Error('Schedule not found')
    const before = this.snapshot()
    const run: AiScheduleRun = { id: randomUUID(), scheduleId: id, name: plan.name, connectionId: plan.connectionId, startedAt: this.now(), status: 'running' }
    // Only a scheduled trigger consumes a slot. Manual runs leave every cadence intact.
    if (scheduled) {
      plan.nextRunAt = nextAiScheduleRun(plan, this.now())
      if (plan.timing && plan.timing.kind !== 'interval') plan.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    }
    this.state.runs.unshift(run)
    this.state.runs = this.state.runs.slice(0, 200)
    try { this.persist() } catch (error) { this.state = before; throw error }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('巡检超过 10 分钟，已中断。')), this.ports.timeoutMs ?? 600_000)
    this.active = { run, controller, timeout }
    try {
      const result = await this.ports.execute(structuredClone(plan), run.id, controller.signal, hosts => {
        if (this.disposed) return
        run.hosts = structuredClone(hosts)
        this.persist()
      })
      controller.signal.throwIfAborted()
      Object.assign(run, result, { status: 'completed' })
      if (result.error || result.hosts?.some(host => host.status === 'failed') || aiScheduleHasToolFailure(result.toolRuns)) {
        Object.assign(run, { status: 'failed', error: result.error || '部分主机或巡检工具未能执行，请查看执行详情。' })
      }
    } catch (error) {
      if (run.status !== 'cancelled') Object.assign(run, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
    } finally {
      clearTimeout(timeout)
      run.finishedAt = this.now()
      for (const host of run.hosts || []) if (host.status === 'queued' || host.status === 'running') host.status = 'cancelled'
      this.active = undefined
      if (!this.disposed) {
        if (run.status !== 'cancelled' && this.ports.notify) run.notification = { status: 'sending' }
        this.persist()
        if (run.notification?.status === 'sending') void this.deliver(structuredClone(plan), structuredClone(run))
        // Drain overdue plans immediately, independently of Webhook delivery.
        this.tick()
      }
    }
    return structuredClone(run)
  }
  private async deliver(plan: AiSchedule, run: AiScheduleRun) {
    const controller = new AbortController()
    this.deliveries.set(run.id, controller)
    try {
      let notification: AiRunNotification
      try { notification = await this.ports.notify!(plan, run, controller.signal) }
      catch { notification = { status: 'failed', at: this.now(), error: '通知发送失败。' } }
      if (this.disposed) return
      // Editing/deleting plans replaces the snapshot; never mutate a stale run reference.
      const current = this.state.runs.find(item => item.id === run.id)
      if (current) {
        current.notification = notification
        this.persist()
      }
    } catch (error) { this.ports.onError?.(error) }
    finally { this.deliveries.delete(run.id) }
  }
  stop(runId: string) {
    if (this.active?.run.id !== runId || this.active.run.status !== 'running') return
    this.active.run.status = 'cancelled'
    this.active.controller.abort()
    this.persist()
  }
  dispose() {
    if (this.timer) clearInterval(this.timer)
    this.disposed = true
    let changed = false
    for (const [id, controller] of this.deliveries) {
      const run = this.state.runs.find(item => item.id === id)
      if (run?.notification?.status === 'sending') {
        run.notification = { status: 'failed', at: this.now(), error: '应用关闭，未确认通知送达。' }
        changed = true
      }
      controller.abort()
    }
    this.deliveries.clear()
    if (this.active) {
      clearTimeout(this.active.timeout)
      if (this.active.run.status === 'running') this.active.run.status = 'cancelled'
      for (const host of this.active.run.hosts || []) if (host.status === 'running' || host.status === 'queued') host.status = 'cancelled'
      this.active.run.finishedAt = this.now()
      this.active.controller.abort()
      changed = true
    }
    if (changed) this.persist()
  }
}
