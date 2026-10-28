import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createServer, Socket } from 'node:net'
import { buildXauthority, probeAuthenticatedX11, probeX11Setup } from './x11Auth'
import { buildX11ConnectionSetupPacket } from './x11Probe'
import { isChildProcessAlive, resolveX11Executable } from './x11Server'

export type ManagedX11Target = { host: string; display: number; localCookie: Buffer; executablePath: string }

export function managedX11Args(display: number, authorityPath: string): string[] {
  // VcXsrv 1.20 does not implement -localhost. Authentication is mandatory;
  // do not use -ac. SSH channels connect locally and receive session cookies.
  return [`:${display}`, '-multiwindow', '-clipboard', '-wgl', '-auth', authorityPath, '-listen', 'tcp', '-silent-dup-error', '-noreset']
}

async function portFree(port: number): Promise<boolean> {
  // Windows may permit a loopback bind beside an existing wildcard listener.
  // A successful TCP connection always means this display already has an owner.
  const unused = await new Promise<boolean>(resolve => {
    const socket = new Socket()
    let settled = false
    const finish = (free: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      socket.destroy()
      resolve(free)
    }
    const timeout = setTimeout(() => finish(false), 250)
    socket.once('connect', () => finish(false))
    socket.once('error', (error: NodeJS.ErrnoException) => finish(error.code === 'ECONNREFUSED'))
    socket.connect(port, '127.0.0.1')
  })
  if (!unused) return false
  return new Promise(resolve => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => server.close(() => resolve(true)))
  })
}

export class ManagedX11Server {
  private target?: ManagedX11Target
  private child?: ChildProcess
  private directory?: string
  private starting?: Promise<ManagedX11Target>
  private stopping = false

  ensure(executablePath?: string): Promise<ManagedX11Target> {
    if (this.stopping) return Promise.reject(new Error('X11 service is stopping'))
    return this.starting ??= this.start(executablePath).finally(() => { this.starting = undefined })
  }

  private async start(executablePath?: string): Promise<ManagedX11Target> {
    if (this.target && isChildProcessAlive(this.child)
      && await probeAuthenticatedX11(this.target.host, 6000 + this.target.display, this.target.localCookie)) return this.target
    await this.release()
    const exe = await resolveX11Executable(executablePath)
    if (!exe) throw new Error('Bundled X11 runtime is missing. Run npm run prepare:x11 or reinstall LiteConnect.')
    for (let display = 50; display <= 99; display++) {
      if (this.stopping) throw new Error('X11 service is stopping')
      if (!await portFree(6000 + display)) continue
      const directory = await mkdtemp(join(tmpdir(), 'liteconnect-x11-'))
      this.directory = directory
      const cookie = randomBytes(16)
      const authority = join(directory, 'Xauthority')
      await writeFile(authority, buildXauthority(display, cookie), { mode: 0o600 })
      if (this.stopping) { await this.release(); throw new Error('X11 service is stopping') }
      const child = this.child = spawn(exe, managedX11Args(display, authority), {
        cwd: dirname(exe), windowsHide: true, stdio: 'ignore',
      })
      let startError: Error | undefined
      child.on('error', error => { startError = error })
      const deadline = Date.now() + 10_000
      while (!this.stopping && !startError && isChildProcessAlive(child) && Date.now() < deadline) {
        if (await probeAuthenticatedX11('127.0.0.1', 6000 + display, cookie)) {
          // An anonymous connection must not bypass cookie authentication.
          const wrongCookieAccepted = await probeAuthenticatedX11('127.0.0.1', 6000 + display, randomBytes(16))
          const anonymousAccepted = await probeX11Setup('127.0.0.1', 6000 + display, buildX11ConnectionSetupPacket())
          if (wrongCookieAccepted || anonymousAccepted) {
            await this.release()
            throw new Error(`X11 server accepted ${wrongCookieAccepted ? 'an invalid cookie' : 'an anonymous connection'}; automatic forwarding was disabled`)
          }
          this.target = { host: '127.0.0.1', display, localCookie: cookie, executablePath: exe }
          return this.target
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      await this.release()
      // Only a genuine port race should try the next display; other errors
      // must not repeatedly launch a failing server or display error dialogs.
      if (!this.stopping && !await portFree(6000 + display)) continue
      throw startError ?? new Error('X11 server did not become ready within 10 seconds')
    }
    throw new Error('No free local X11 display (50–99)')
  }

  private async release(): Promise<void> {
    const child = this.child
    this.child = undefined
    this.target = undefined
    if (child && isChildProcessAlive(child)) {
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 1000)
        child.once('exit', () => { clearTimeout(timeout); resolve() })
        child.kill()
      })
    }
    const directory = this.directory
    this.directory = undefined
    if (directory) await rm(directory, { recursive: true, force: true })
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.starting?.catch(() => {})
    await this.release()
  }
}

/** Draft path tests must not terminate a running display's graphical windows. */
export class ManagedX11Service {
  private readonly servers = new Map<string, ManagedX11Server>()
  private stopping = false

  async ensure(path?: string): Promise<ManagedX11Target> {
    if (this.stopping) throw new Error('X11 service is stopping')
    const executable = await resolveX11Executable(path)
    if (!executable) throw new Error('Bundled X11 runtime is missing. Reinstall LiteConnect.')
    if (this.stopping) throw new Error('X11 service is stopping')
    let server = this.servers.get(executable)
    if (!server) { server = new ManagedX11Server(); this.servers.set(executable, server) }
    return server.ensure(executable)
  }

  async stop(): Promise<void> {
    this.stopping = true
    await Promise.all([...this.servers.values()].map(server => server.stop()))
    this.servers.clear()
  }
}

export const managedX11Server = new ManagedX11Service()
