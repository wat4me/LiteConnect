import { beforeEach, expect, it, vi } from 'vitest'
import { McpHttpGateway, type McpHttpSettingsPort } from './httpGateway'
import type { SshMcpRuntime } from './runtime'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('./httpServer', () => ({ createMcpHttpServer: mocks.create }))
beforeEach(() => mocks.create.mockReset())

function setup() {
  const settings = {
    getMcpHttpEnabled: () => true, getMcpHttpPort: () => 2211, getMcpHttpToken: () => 'test-token', getMcpApprovalMode: () => 'deny-destructive',
    ensureMcpHttpToken: vi.fn(async () => 'test-token'), setMcpHttpEnabled: vi.fn(async () => {}),
    setMcpHttpPort: vi.fn(async () => {}), setMcpApprovalMode: vi.fn(), rotateMcpHttpToken: vi.fn(),
  } satisfies McpHttpSettingsPort
  const handles: { listen: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; forceClose: ReturnType<typeof vi.fn> }[] = []
  mocks.create.mockImplementation(() => {
    const handle = { listen: vi.fn(async () => 2211), close: vi.fn(async () => {}), forceClose: vi.fn() }
    handles.push(handle)
    return handle
  })
  return { gateway: new McpHttpGateway({} as SshMcpRuntime, settings, { name: 'test', version: '1' }), settings, handles }
}

it('cannot open a listener after shutdown while token initialization is pending', async () => {
  const { gateway, settings } = setup()
  let finish!: () => void
  settings.ensureMcpHttpToken.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve('test-token') }))
  const starting = gateway.applyFromSettings()
  await vi.waitFor(() => expect(settings.ensureMcpHttpToken).toHaveBeenCalledOnce())
  let stopped = false
  const stopping = gateway.dispose().then(() => { stopped = true })
  await expect(gateway.setEnabled(true)).rejects.toThrow('disposed')
  expect(settings.setMcpHttpEnabled).not.toHaveBeenCalled()
  expect(stopped).toBe(false)
  finish()
  await starting; await stopping
  expect(mocks.create).not.toHaveBeenCalled()
  expect(gateway.getStatus().listening).toBe(false)
})

it('serializes concurrent starts and releases the old listener before replacement', async () => {
  const { gateway, handles } = setup()
  await Promise.all([gateway.start(), gateway.start(), gateway.setPort(2212)])
  expect(handles).toHaveLength(3)
  expect(handles[0].close).toHaveBeenCalledOnce()
  expect(handles[1].close).toHaveBeenCalledOnce()
  expect(gateway.getStatus().listening).toBe(true)
  await gateway.dispose()
  await gateway.dispose()
  expect(handles[2].close).toHaveBeenCalledOnce()
  expect(gateway.getStatus().listening).toBe(false)
  await expect(gateway.start()).rejects.toThrow('disposed')
})

it('a reversible stop invalidates token-delayed startup and permits a later explicit restart', async () => {
  const { gateway, settings } = setup()
  let finish!: () => void
  settings.ensureMcpHttpToken.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve('token') }))
  const starting = gateway.start()
  await vi.waitFor(() => expect(settings.ensureMcpHttpToken).toHaveBeenCalledOnce())
  await gateway.stop()
  finish(); await starting
  expect(mocks.create).not.toHaveBeenCalled()
  await gateway.start()
  expect(gateway.getStatus().listening).toBe(true)
  await gateway.dispose()
})

it('invalidates startup that was queued in the same turn before stop', async () => {
  const { gateway } = setup()
  const starting = gateway.start()
  await gateway.stop()
  await starting
  expect(mocks.create).not.toHaveBeenCalled()
  await gateway.dispose()
})

it('force-closes a stalled draining listener at the application deadline', async () => {
  const { gateway, handles } = setup()
  await gateway.start()
  let finish!: () => void
  handles[0].close.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const stopping = gateway.dispose()
  gateway.forceClose()
  expect(handles[0].forceClose).toHaveBeenCalledOnce()
  finish(); await stopping
})
