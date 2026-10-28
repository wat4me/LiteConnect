import { execFile } from 'node:child_process'
import { access, readFile, stat } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { posix } from 'node:path'
import { promisify } from 'node:util'
import { t } from '../../i18n'
import { probeAuthenticatedX11Endpoint, probeX11SetupEndpoint } from './x11Auth'
import { buildX11ConnectionSetupPacket } from './x11Probe'
import { parseSystemX11Display, readXauthorityCookies } from './systemX11Display'
import type { X11Endpoint } from './x11Endpoint'

export type SystemX11Target = {
  endpoint: X11Endpoint
  display: number
  screen: number
  displayAddress: string
  localCookie: Buffer
  executablePath?: string
  started: boolean
}

export type SystemX11Status = {
  supported: boolean
  resolvedExecutablePath: string | null
  displayAddress?: string
  dependencyMissing?: 'xquartz' | 'desktop'
}

/** Injected boundaries let Windows CI exercise macOS/Linux session behavior. */
export type SystemX11Dependencies = {
  platform: NodeJS.Platform
  environment: NodeJS.ProcessEnv
  home: string
  hostname: string
  exists(path: string): Promise<boolean>
  authority(path: string): Promise<Buffer>
  run(executable: string, args: string[]): Promise<string>
  probe(endpoint: X11Endpoint, cookie: Buffer): Promise<boolean>
  activate(endpoint: X11Endpoint): Promise<unknown>
  wait(): Promise<void>
  now(): number
}

const runFile = promisify(execFile)
function defaultDependencies(): SystemX11Dependencies {
  return {
    platform: process.platform, environment: process.env, home: homedir(), hostname: hostname(),
    exists: async path => { try { await access(path); return true } catch { return false } },
    authority: async path => {
      const info = await stat(path)
      if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Invalid Xauthority file')
      const data = await readFile(path)
      if (data.length > 1024 * 1024) throw new Error('Invalid Xauthority file')
      return data
    },
    run: async (executable, args) => (await runFile(executable, args, { timeout: 2500, maxBuffer: 256 * 1024, encoding: 'utf8' })).stdout,
    probe: (endpoint, cookie) => probeAuthenticatedX11Endpoint(endpoint, cookie, 500),
    activate: endpoint => probeX11SetupEndpoint(endpoint, buildX11ConnectionSetupPacket(), 500),
    wait: () => new Promise(resolve => setTimeout(resolve, 200)), now: Date.now,
  }
}

export class SystemX11Service {
  private pending?: Promise<SystemX11Target>
  private stopping = false
  constructor(private readonly deps = defaultDependencies()) {}

  private async xquartz(): Promise<string | null> {
    for (const path of ['/Applications/Utilities/XQuartz.app', '/Applications/XQuartz.app', posix.join(this.deps.home, 'Applications/XQuartz.app')]) {
      if (await this.deps.exists(path)) return path
    }
    return null
  }

  private async environment(refreshMac = false): Promise<NodeJS.ProcessEnv> {
    const env = { ...this.deps.environment }
    if (this.deps.platform === 'darwin' && (!env.DISPLAY || refreshMac)) {
      try {
        const display = (await this.deps.run('/bin/launchctl', ['getenv', 'DISPLAY'])).trim()
        if (display) env.DISPLAY = display
      } catch { /* XQuartz may not have installed its launch agent yet. */ }
    }
    if (this.deps.platform === 'linux' && (!env.DISPLAY || !env.XAUTHORITY && env.XDG_RUNTIME_DIR)) {
      try {
        // Desktop-launched applications may lack shell variables. Only select
        // display variables; never expose the rest of the user's environment.
        const values: Record<string, string> = {}
        for (const line of (await this.deps.run('/usr/bin/systemctl', ['--user', 'show-environment'])).split('\n')) {
          const match = /^(DISPLAY|XAUTHORITY)=(.*)$/.exec(line)
          if (match) values[match[1]] = match[2]
        }
        if (!env.DISPLAY || env.DISPLAY === values.DISPLAY) {
          env.DISPLAY ||= values.DISPLAY
          env.XAUTHORITY ||= values.XAUTHORITY
        }
      } catch { /* Non-systemd desktops still use the inherited environment. */ }
    }
    return env
  }

  async status(): Promise<SystemX11Status> {
    const supported = this.deps.platform === 'darwin' || this.deps.platform === 'linux'
    const env = await this.environment()
    const app = this.deps.platform === 'darwin' ? await this.xquartz() : null
    return {
      supported, resolvedExecutablePath: app,
      displayAddress: env.DISPLAY || undefined,
      dependencyMissing: this.deps.platform === 'darwin' && !app && !env.DISPLAY ? 'xquartz'
        : this.deps.platform === 'linux' && !env.DISPLAY ? 'desktop' : undefined,
    }
  }

  ensure(): Promise<SystemX11Target> {
    if (this.stopping) return Promise.reject(new Error(t('x11.systemStopping')))
    return this.pending ??= this.prepare().finally(() => { this.pending = undefined })
  }

  private async tryDisplay(env: NodeJS.ProcessEnv): Promise<SystemX11Target | string> {
    if (!env.DISPLAY) return 'x11.desktopMissing'
    const parsed = parseSystemX11Display(env.DISPLAY, this.deps.platform)
    if (!parsed) return 'x11.displayInvalid'
    let cookies: Buffer[] = []
    try {
      const path = env.XAUTHORITY || posix.join(this.deps.home, '.Xauthority')
      cookies = readXauthorityCookies(await this.deps.authority(path), parsed.display, this.deps.hostname)
    } catch { /* Missing, unreadable or malformed authority fails closed. */ }
    if (!cookies.length) return 'x11.desktopAuthMissing'
    for (const endpoint of parsed.endpoints) {
      for (const cookie of cookies.slice(0, 4)) {
        if (this.stopping) throw new Error(t('x11.systemStopping'))
        if (await this.deps.probe(endpoint, cookie)) return {
          endpoint, display: parsed.display, screen: parsed.screen,
          displayAddress: env.DISPLAY, localCookie: cookie, started: false,
        }
      }
    }
    return 'x11.desktopUnavailable'
  }

  private async prepare(): Promise<SystemX11Target> {
    if (this.deps.platform !== 'darwin' && this.deps.platform !== 'linux') throw new Error(t('x11.platformUnsupported'))
    let env = await this.environment()
    let result = await this.tryDisplay(env)
    if (typeof result !== 'string') return result
    if (this.deps.platform === 'linux') throw new Error(t(result))

    const app = await this.xquartz()
    if (!app) throw new Error(t('x11.xquartzMissing'))
    if (this.stopping) throw new Error(t('x11.systemStopping'))
    const parsed = parseSystemX11Display(env.DISPLAY || '', 'darwin')
    const activation = parsed?.endpoints.find(endpoint => 'path' in endpoint && endpoint.path.startsWith('/'))
    if (activation && 'path' in activation && await this.deps.exists(activation.path)) {
      // Socket activation avoids changing XQuartz preferences or opening its
      // default xterm. launchd owns this display, not LiteConnect.
      await this.deps.activate(activation)
    } else {
      await this.deps.run('/usr/bin/open', ['-g', '-a', app])
    }
    const deadline = this.deps.now() + 8000
    while (!this.stopping && this.deps.now() < deadline) {
      env = await this.environment(true)
      result = await this.tryDisplay(env)
      if (typeof result !== 'string') return { ...result, executablePath: app, started: true }
      await this.deps.wait()
    }
    throw new Error(t(this.stopping ? 'x11.systemStopping' : result === 'x11.desktopMissing' ? 'x11.xquartzLoginRequired' : result as string))
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.pending?.catch(() => {})
    // Never terminate the desktop's Xorg, XWayland, or XQuartz process.
  }
}

export const systemX11Service = new SystemX11Service()
