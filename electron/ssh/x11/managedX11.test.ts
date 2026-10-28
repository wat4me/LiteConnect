import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { access } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ManagedX11Server, ManagedX11Service, managedX11Args } from './managedX11'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), probe: vi.fn(), anonymous: vi.fn(), resolve: vi.fn(), free: true }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('./x11Server', () => ({
  resolveX11Executable: mocks.resolve,
  isChildProcessAlive: (child: any) => child && child.exitCode === null && !child.killed,
  getX11ServerOptions: () => ({ autoStart: true }),
}))
vi.mock('./x11Auth', async importOriginal => ({
  ...await importOriginal<object>(), probeAuthenticatedX11: mocks.probe, probeX11Setup: mocks.anonymous,
}))
vi.mock('node:net', () => ({ Socket: class extends EventEmitter {
  connect() { queueMicrotask(() => this.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))) }
  destroy() {}
}, createServer: () => {
  const server = new EventEmitter() as any
  server.listen = (_port: number, callback: () => void) => {
    if (mocks.free) callback()
    else { mocks.free = true; server.emit('error', new Error('occupied')) }
  }
  server.close = (callback: () => void) => callback()
  return server
} }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.free = true
  mocks.resolve.mockImplementation(async (path?: string) => path || 'C:/bundle/vcxsrv.exe')
  mocks.anonymous.mockResolvedValue(false)
  mocks.probe.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValue(true)
  mocks.spawn.mockImplementation(() => {
    const child = new EventEmitter() as any
    child.exitCode = null
    child.killed = false
    child.kill = vi.fn(() => { child.killed = true; child.exitCode = 0; child.emit('exit', 0); return true })
    return child
  })
})

describe('managed Windows display lifecycle', () => {
  it('coalesces simultaneous starts, avoids occupied displays and removes private credentials on stop', async () => {
    mocks.free = false
    const server = new ManagedX11Server()
    const [first, second] = await Promise.all([server.ensure(), server.ensure()])
    expect(first).toBe(second)
    expect(first.display).toBe(51)
    expect(mocks.spawn).toHaveBeenCalledOnce()
    const [exe, args, options] = mocks.spawn.mock.calls[0]
    expect(exe).toBe('C:/bundle/vcxsrv.exe')
    expect(args).not.toContain('-ac')
    expect(options.windowsHide).toBe(true)
    const authority = args[args.indexOf('-auth') + 1]
    await expect(access(authority)).resolves.toBeUndefined()
    expect(await server.ensure()).toBe(first)
    await server.stop()
    expect(mocks.spawn.mock.results[0].value.kill).toHaveBeenCalledOnce()
    await expect(access(dirname(authority))).rejects.toThrow()
    await expect(server.ensure()).rejects.toThrow('stopping')
  })

  it('fails closed if a display accepts an invalid cookie', async () => {
    mocks.probe.mockReset().mockResolvedValue(true)
    const server = new ManagedX11Server()
    await expect(server.ensure()).rejects.toThrow('invalid cookie')
    expect(mocks.spawn.mock.results[0].value.kill).toHaveBeenCalledOnce()
    await server.stop()
  })

  it('does not terminate an existing display when testing a different executable', async () => {
    mocks.probe.mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const service = new ManagedX11Service()
    await service.ensure('C:/first/vcxsrv.exe')
    await service.ensure('C:/second/vcxsrv.exe')
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    for (const child of mocks.spawn.mock.results) expect(child.value.kill).not.toHaveBeenCalled()
    await service.stop()
    for (const child of mocks.spawn.mock.results) expect(child.value.kill).toHaveBeenCalledOnce()
  })

  it('uses authenticated startup without unsupported VcXsrv localhost flag', () => {
    const args = managedX11Args(52, 'C:/private dir/Xauthority')
    expect(args).toContain('-auth')
    expect(args).not.toContain('-ac')
    expect(args).not.toContain('-localhost')
  })
})
