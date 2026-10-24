import type { AiExecutionService } from '../ai/execution/executionService'
import type { AiScheduler } from '../ai/schedules/scheduler'
import type { SshMcpRuntime } from '../mcp/runtime'
import type { McpHttpGateway } from '../mcp/httpGateway'
import type { CredentialStore } from '../store/credentialStore'
import type { SettingsStore } from '../store/settingsStore'
import type { SSHManager } from '../ssh/manager'
import type { MonitorCollector } from '../ssh/monitor/monitor'
import type { AiScheduleSnapshot } from '../../shared/aiSchedules'
import { ServiceIpcScope } from '../ipc/serviceScope'

export interface DeferredServiceDependencies {
  settings: SettingsStore
  credentials: CredentialStore
  ssh: SSHManager
  monitor: MonitorCollector
  version: string
  historyId: (sessionId: string) => string | undefined
  schedulesChanged: (state: AiScheduleSnapshot) => void
}

/** Main's delayed composition root. Every asynchronous boundary checks admission. */
export class DeferredServices {
  private stopping = false
  private sealed = false
  private starting?: Promise<void>
  private stoppingPromise?: Promise<void>
  private execution?: AiExecutionService
  private scheduler?: AiScheduler
  private runtime?: SshMcpRuntime
  private gateway?: McpHttpGateway
  private docker?: { closeAll(): void }
  private readonly ipc = new ServiceIpcScope()

  constructor(private readonly deps: DeferredServiceDependencies) {}

  start(): Promise<void> {
    if (this.stopping) return Promise.resolve()
    return this.starting ??= this.load().catch(error => console.error('[Main Deferred]', error))
  }

  private async load(): Promise<void> {
    try { await this.deps.settings.initMigrations() }
    catch (error) { console.error('[Main Settings Migration]', error) }
    if (this.stopping) return
    await Promise.allSettled([this.loadX11(), this.loadBashAst(), this.loadDocker(), this.loadAi()]).then(results => {
      for (const result of results) if (result.status === 'rejected') console.error('[Main Deferred]', result.reason)
    })
  }

  private async loadX11() {
    const { configureX11ServerOptions } = await import('../ssh/x11/x11Server')
    if (this.stopping) return
    configureX11ServerOptions({ autoStart: this.deps.settings.getX11AutoStartEnabled(), executablePath: this.deps.settings.getX11ServerPath() })
  }

  private async loadBashAst() {
    const { initBashAst } = await import('../mcp/bashParser')
    if (this.stopping) return
    const status = await initBashAst()
    if (!status.ok) console.error('[Main Bash AST] classifier degraded to text mode:', status.reason)
  }

  private async loadDocker() {
    const [{ DockerSshSessionHost }, { DockerService }, { registerDockerHandlers }] = await Promise.all([
      import('../docker/sshSessionHost'), import('../docker/service'), import('../ipc/registerDockerHandlers'),
    ])
    if (this.stopping) return
    const docker = new DockerService(new DockerSshSessionHost(this.deps.ssh))
    this.docker = docker
    registerDockerHandlers(docker)
  }

  private async loadAi() {
    const [{ bindSshMcpRuntime }, { createMcpAuditLog }, { McpHttpGateway }, { registerMcpHandlers },
      { registerAiHandlers }, { registerAiScheduleHandlers }, { createAiExecutionService }, { createAiScheduleServices }] = await Promise.all([
      import('../mcp/bind'), import('../mcp/auditLog'), import('../mcp/httpGateway'), import('../ipc/registerMcpHandlers'),
      import('../ipc/registerAiHandlers'), import('../ipc/registerAiScheduleHandlers'), import('./aiExecution'), import('./aiSchedules'),
    ])
    if (this.stopping) return
    const { settings, ssh, credentials, monitor } = this.deps
    const runtime = this.runtime = bindSshMcpRuntime(ssh, credentials, monitor, {
      getApprovalMode: () => settings.getMcpApprovalMode(),
      getDownloadSettings: () => ({ directory: settings.getDownloadPath(), conflict: settings.getDownloadConflictStrategy() }),
    })
    const audit = createMcpAuditLog()
    const gateway = this.gateway = new McpHttpGateway(runtime, settings,
      { name: 'liteconnect-ssh', version: this.deps.version }, event => { if (!this.sealed) audit(event) })
    const execution = this.execution = createAiExecutionService(settings, runtime)
    const { scheduler, notifier } = createAiScheduleServices(execution, ssh, credentials, settings, this.deps.schedulesChanged)
    this.scheduler = scheduler
    registerMcpHandlers(runtime, gateway, this.ipc)
    registerAiHandlers(settings, execution, this.deps.historyId, this.ipc)
    registerAiScheduleHandlers(scheduler, notifier, credentials, this.ipc)
    scheduler.start()
    try { await gateway.applyFromSettings() }
    catch (error) { if (!this.stopping) console.error('[Main MCP HTTP]', error) }
  }

  /** The all-windows-closed policy is reversible on macOS. */
  closeWindowSessions(): void {
    this.docker?.closeAll()
    void this.gateway?.stop().catch(error => console.warn('[Main MCP HTTP stop]', error))
  }

  stop(): Promise<void> {
    if (this.stoppingPromise) return this.stoppingPromise
    this.stopping = true
    const tasks: Promise<unknown>[] = []
    const stop = (action: () => unknown) => {
      try { tasks.push(Promise.resolve(action())) }
      catch (error) { console.error('[Main Service Stop]', error) }
    }
    stop(() => this.ipc.dispose())
    stop(() => this.scheduler?.dispose())
    stop(() => this.execution?.dispose())
    stop(() => this.gateway?.dispose())
    stop(() => this.runtime?.dispose())
    stop(() => this.scheduler?.waitForIdle())
    stop(() => this.execution?.waitForIdle())
    stop(() => this.ipc.waitForIdle())
    tasks.push(this.starting ?? Promise.resolve())
    return this.stoppingPromise = Promise.allSettled(tasks).then(results => {
      for (const result of results) if (result.status === 'rejected') console.error('[Main Service Stop]', result.reason)
    })
  }

  /** Also used at the deadline, before the database is closed. */
  seal(): void {
    this.sealed = true
    for (const seal of [() => this.execution?.sealPersistence(), () => this.gateway?.forceClose(), () => this.docker?.closeAll()]) {
      try { seal() } catch (error) { console.error('[Main Service Seal]', error) }
    }
  }
}
