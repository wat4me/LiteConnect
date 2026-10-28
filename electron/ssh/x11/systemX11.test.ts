import { describe, expect, it, vi } from 'vitest'
import { buildXauthority } from './x11Auth'
import { SystemX11Service, type SystemX11Dependencies } from './systemX11'

vi.mock('../../i18n', () => ({ t: (key: string) => key }))
const cookie = Buffer.alloc(16, 8)
const macDisplay = '/private/tmp/com.apple.launchd.test/org.xquartz:0'
function fixture(platform: NodeJS.Platform = 'linux', environment: NodeJS.ProcessEnv = { DISPLAY: ':1', XAUTHORITY: '/run/user/1000/xauth' }) {
  let time = 0
  const deps: SystemX11Dependencies = {
    platform, environment, home: '/home/desktop', hostname: 'desktop',
    exists: vi.fn(async () => false),
    authority: vi.fn(async () => buildXauthority(platform === 'linux' ? 1 : 0, cookie)),
    run: vi.fn(async () => ''), probe: vi.fn(async () => true), activate: vi.fn(async () => {}),
    wait: vi.fn(async () => { time += 1000 }), now: () => time,
  }
  return { deps, service: new SystemX11Service(deps) }
}

describe('Linux desktop integration', () => {
  it('uses the inherited Wayland/Xorg authority and local socket without launching another server', async () => {
    const { deps, service } = fixture()
    const target = await service.ensure()
    expect(target.endpoint).toEqual({ path: '/tmp/.X11-unix/X1' })
    expect(target.localCookie).toEqual(cookie)
    expect(deps.authority).toHaveBeenCalledWith('/run/user/1000/xauth')
    expect(deps.run).not.toHaveBeenCalled()
    expect(deps.environment).toEqual({ DISPLAY: ':1', XAUTHORITY: '/run/user/1000/xauth' })
  })
  it('recovers missing desktop variables from the user service environment', async () => {
    const { deps, service } = fixture('linux', {})
    vi.mocked(deps.run).mockResolvedValue('DISPLAY=:1\nXAUTHORITY=/run/user/1000/wayland-auth\nPRIVATE_TOKEN=never-expose\n')
    expect((await service.ensure()).endpoint).toEqual({ path: '/tmp/.X11-unix/X1' })
    expect(deps.authority).toHaveBeenCalledWith('/run/user/1000/wayland-auth')
    expect(deps.environment).toEqual({})
    expect(JSON.stringify(await service.status())).not.toContain('PRIVATE_TOKEN')
  })
  it('does not replace an explicitly inherited display with another session’s credentials', async () => {
    const { deps, service } = fixture('linux', { DISPLAY: ':1', XDG_RUNTIME_DIR: '/run/user/1000' })
    vi.mocked(deps.run).mockResolvedValue('DISPLAY=:0\nXAUTHORITY=/different/session/auth\n')
    await service.ensure()
    expect(deps.authority).toHaveBeenCalledWith('/home/desktop/.Xauthority')
  })
  it('tries Linux abstract sockets when a filesystem socket cannot be reached', async () => {
    const { deps, service } = fixture()
    vi.mocked(deps.probe).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    expect((await service.ensure()).endpoint).toEqual({ path: '\0/tmp/.X11-unix/X1' })
  })
  it('explains missing desktop sessions and never launches a display server', async () => {
    const { deps, service } = fixture('linux', {})
    await expect(service.ensure()).rejects.toThrow('x11.desktopMissing')
    expect((await service.status()).dependencyMissing).toBe('desktop')
    expect(vi.mocked(deps.run).mock.calls.every(([exe]) => exe === '/usr/bin/systemctl')).toBe(true)
  })
  it('fails safely when the authority cannot be read', async () => {
    const { deps, service } = fixture()
    vi.mocked(deps.authority).mockRejectedValue(new Error('permission denied'))
    await expect(service.ensure()).rejects.toThrow('x11.desktopAuthMissing')
    expect(deps.probe).not.toHaveBeenCalled()
  })
  it('reports a failed authenticated probe instead of advertising an unusable display', async () => {
    const { deps, service } = fixture()
    vi.mocked(deps.probe).mockResolvedValue(false)
    await expect(service.ensure()).rejects.toThrow('x11.desktopUnavailable')
  })
  it('rereads rotated cookies for new connections', async () => {
    const { deps, service } = fixture()
    await service.ensure()
    const replacement = Buffer.alloc(16, 9)
    vi.mocked(deps.authority).mockResolvedValue(buildXauthority(1, replacement))
    expect((await service.ensure()).localCookie).toEqual(replacement)
  })
})

describe('macOS XQuartz integration', () => {
  it('reuses an already authenticated display without launching or modifying anything', async () => {
    const { deps, service } = fixture('darwin', { DISPLAY: macDisplay })
    expect((await service.ensure()).endpoint).toEqual({ path: macDisplay })
    expect(deps.run).not.toHaveBeenCalled()
    expect(deps.activate).not.toHaveBeenCalled()
  })
  it('opens installed XQuartz once and obtains its launchd display and authentication', async () => {
    const { deps, service } = fixture('darwin', {})
    let launched = false
    vi.mocked(deps.exists).mockImplementation(async path => path === '/Applications/Utilities/XQuartz.app')
    vi.mocked(deps.run).mockImplementation(async exe => {
      if (exe === '/usr/bin/open') { launched = true; return '' }
      return launched ? macDisplay : ''
    })
    const [first, second] = await Promise.all([service.ensure(), service.ensure()])
    expect(first).toBe(second)
    expect(first.endpoint).toEqual({ path: macDisplay })
    expect(first.started).toBe(true)
    expect(vi.mocked(deps.run).mock.calls.filter(([exe]) => exe === '/usr/bin/open')).toEqual([
      ['/usr/bin/open', ['-g', '-a', '/Applications/Utilities/XQuartz.app']],
    ])
  })
  it('prefers launchd socket activation without changing XQuartz preferences or opening an xterm', async () => {
    const { deps, service } = fixture('darwin', { DISPLAY: macDisplay })
    let active = false
    vi.mocked(deps.exists).mockResolvedValue(true)
    vi.mocked(deps.authority).mockImplementation(async () => {
      if (!active) throw new Error('not generated yet')
      return buildXauthority(0, cookie)
    })
    vi.mocked(deps.activate).mockImplementation(async () => { active = true })
    vi.mocked(deps.run).mockResolvedValue(macDisplay)
    expect((await service.ensure()).started).toBe(true)
    expect(deps.activate).toHaveBeenCalledWith({ path: macDisplay })
    expect(vi.mocked(deps.run).mock.calls.every(([exe]) => exe === '/bin/launchctl')).toBe(true)
  })
  it('provides first-use guidance when XQuartz is absent', async () => {
    const { deps, service } = fixture('darwin', {})
    expect((await service.status()).dependencyMissing).toBe('xquartz')
    await expect(service.ensure()).rejects.toThrow('x11.xquartzMissing')
    expect(vi.mocked(deps.run).mock.calls.some(([exe]) => exe === '/usr/bin/open')).toBe(false)
  })
  it('explains when first installation requires a new login session', async () => {
    const { deps, service } = fixture('darwin', {})
    vi.mocked(deps.exists).mockResolvedValue(true)
    await expect(service.ensure()).rejects.toThrow('x11.xquartzLoginRequired')
  })
  it('stops a pending preparation without taking ownership of the desktop process', async () => {
    const { deps, service } = fixture('darwin', {})
    vi.mocked(deps.exists).mockResolvedValue(true)
    vi.mocked(deps.run).mockImplementation(async exe => {
      if (exe === '/usr/bin/open') void service.stop()
      return ''
    })
    await expect(service.ensure()).rejects.toThrow('x11.systemStopping')
    await expect(service.ensure()).rejects.toThrow('x11.systemStopping')
  })
})
