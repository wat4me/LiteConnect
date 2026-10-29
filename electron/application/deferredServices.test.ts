import { beforeEach, expect, it, vi } from 'vitest'
import { DeferredServices, type DeferredServiceDependencies } from './deferredServices'

const mocks = vi.hoisted(() => ({
  importGate: undefined as Promise<void> | undefined,
  bind: vi.fn(), execution: vi.fn(), schedules: vi.fn(),
  registerAi: vi.fn(), registerMcp: vi.fn(), registerSchedules: vi.fn(), registerDocker: vi.fn(),
  dockerClose: vi.fn(), x11: vi.fn(), x11Stop: vi.fn(), bash: vi.fn(async () => ({ ok: true })), audit: vi.fn(),
  removeHandler: vi.fn(), gateway: { applyFromSettings: vi.fn(), dispose: vi.fn(), stop: vi.fn(), forceClose: vi.fn() },
}))
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), removeHandler: mocks.removeHandler } }))
vi.mock('../mcp/bind', async () => { await mocks.importGate; return { bindSshMcpRuntime: mocks.bind } })
vi.mock('../mcp/auditLog', () => ({ createMcpAuditLog: () => mocks.audit }))
vi.mock('../mcp/httpGateway', () => ({ McpHttpGateway: class { constructor() { return mocks.gateway } } }))
vi.mock('../ipc/registerMcpHandlers', () => ({ registerMcpHandlers: mocks.registerMcp }))
vi.mock('../ipc/registerAiHandlers', () => ({ registerAiHandlers: mocks.registerAi }))
vi.mock('../ipc/registerAiScheduleHandlers', () => ({ registerAiScheduleHandlers: mocks.registerSchedules }))
vi.mock('./aiExecution', () => ({ createAiExecutionService: mocks.execution }))
vi.mock('./aiKnowledge', () => ({ createAiKnowledgeService: () => ({}) }))
vi.mock('./aiSchedules', () => ({ createAiScheduleServices: mocks.schedules }))
vi.mock('../ssh/x11/x11Server', () => ({ configureX11ServerOptions: mocks.x11 }))
vi.mock('../ssh/x11/automaticX11', () => ({ stopAutomaticX11: mocks.x11Stop }))
vi.mock('../mcp/bashParser', () => ({ initBashAst: mocks.bash }))
vi.mock('../docker/sshSessionHost', () => ({ DockerSshSessionHost: class {} }))
vi.mock('../docker/service', () => ({ DockerService: class { closeAll = mocks.dockerClose } }))
vi.mock('../ipc/registerDockerHandlers', () => ({ registerDockerHandlers: mocks.registerDocker }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mocks.importGate = undefined
  mocks.gateway.applyFromSettings.mockResolvedValue(undefined)
  mocks.gateway.dispose.mockResolvedValue(undefined)
  mocks.gateway.stop.mockResolvedValue(undefined)
})

function setup(migrate: () => Promise<void> = async () => {}) {
  const runtime = { dispose: vi.fn() }
  const execution = { dispose: vi.fn(), waitForIdle: vi.fn(async () => {}), sealPersistence: vi.fn() }
  const scheduler = { start: vi.fn(), dispose: vi.fn(), waitForIdle: vi.fn(async () => {}) }
  mocks.bind.mockReturnValue(runtime)
  mocks.execution.mockReturnValue(execution)
  mocks.schedules.mockReturnValue({ scheduler, notifier: {} })
  const settings = { initMigrations: migrate, getX11AutoStartEnabled: () => false, getX11ServerPath: () => '' }
  const services = new DeferredServices({ settings, version: 'test', historyId: () => 'host', schedulesChanged: vi.fn() } as unknown as DeferredServiceDependencies)
  return { services, runtime, execution, scheduler }
}

it('never constructs or registers delayed services when quitting during settings migration', async () => {
  let finish!: () => void
  const migration = new Promise<void>(resolve => { finish = resolve })
  const { services } = setup(() => migration)
  const starting = services.start()
  expect(services.start()).toBe(starting)
  const stopping = services.stop()
  finish()
  await starting; await stopping
  await services.start()
  expect(mocks.x11Stop).toHaveBeenCalledOnce()
  expect(mocks.bind).not.toHaveBeenCalled()
  expect(mocks.registerAi).not.toHaveBeenCalled()
  expect(mocks.registerDocker).not.toHaveBeenCalled()
  expect(mocks.x11).not.toHaveBeenCalled()
})

it('does not construct AI services from imports that resolve after shutdown started', async () => {
  let finish!: () => void
  mocks.importGate = new Promise<void>(resolve => { finish = resolve })
  const { services } = setup()
  const starting = services.start()
  await vi.waitFor(() => expect(mocks.bash).toHaveBeenCalledOnce())
  const stopping = services.stop()
  finish()
  await starting; await stopping
  expect(mocks.bind).not.toHaveBeenCalled()
  expect(mocks.registerAi).not.toHaveBeenCalled()
  services.seal()
})

it('owns construction, registration, cancellation and draining of each delayed service', async () => {
  const { services, runtime, execution, scheduler } = setup()
  await services.start()
  expect(mocks.bind).toHaveBeenCalledOnce()
  expect(mocks.registerAi.mock.calls[0][1]).toBe(execution)
  expect(mocks.registerSchedules.mock.calls[0][0]).toBe(scheduler)
  expect(scheduler.start).toHaveBeenCalledOnce()
  let finish!: () => void
  execution.waitForIdle.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  let stopped = false
  const stopping = services.stop()
  expect(services.stop()).toBe(stopping)
  void stopping.then(() => { stopped = true })
  expect(runtime.dispose).toHaveBeenCalledOnce()
  expect(scheduler.dispose).toHaveBeenCalledOnce()
  expect(execution.dispose).toHaveBeenCalledOnce()
  expect(mocks.gateway.dispose).toHaveBeenCalledOnce()
  await Promise.resolve()
  expect(stopped).toBe(false)
  finish(); await stopping
  expect(mocks.x11Stop).toHaveBeenCalledOnce()
  services.seal()
  expect(execution.sealPersistence).toHaveBeenCalledOnce()
  expect(mocks.gateway.forceClose).toHaveBeenCalledOnce()
  expect(mocks.dockerClose).toHaveBeenCalledOnce()
})

it('preserves reversible window-close cleanup without disposing AI or the scheduler', async () => {
  const { services, execution, scheduler } = setup()
  await services.start()
  services.closeWindowSessions()
  expect(mocks.dockerClose).toHaveBeenCalledOnce()
  expect(mocks.gateway.stop).toHaveBeenCalledOnce()
  expect(execution.dispose).not.toHaveBeenCalled()
  expect(scheduler.dispose).not.toHaveBeenCalled()
  await services.stop()
})
