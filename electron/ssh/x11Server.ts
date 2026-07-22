import { spawn, type ChildProcess } from 'child_process'
import { access } from 'fs/promises'
import { constants } from 'fs'
import { join } from 'path'
import { probeX11Port } from './x11'
import { t } from '../i18n'

export type X11EnsureResult = {
  ready: boolean
  /** True when we spawned a process this call */
  started: boolean
  host: string
  port: number
  display: number
  message?: string
  executablePath?: string
}

export type X11ServerStatus = {
  autoStart: boolean
  executablePath: string
  resolvedExecutablePath: string | null
  platform: NodeJS.Platform
  supported: boolean
}

const DEFAULT_WAIT_MS = 8000
const POLL_MS = 200

let autoStartEnabled = true
let configuredExecutablePath = ''
let managedProcess: ChildProcess | null = null
let managedDisplay: number | null = null
let startInFlight: Promise<X11EnsureResult> | null = null

export function configureX11ServerOptions(opts: {
  autoStart?: boolean
  executablePath?: string
}): void {
  if (typeof opts.autoStart === 'boolean') {
    autoStartEnabled = opts.autoStart
  }
  if (typeof opts.executablePath === 'string') {
    configuredExecutablePath = opts.executablePath.trim()
  }
}

export function getX11ServerOptions(): { autoStart: boolean; executablePath: string } {
  return {
    autoStart: autoStartEnabled,
    executablePath: configuredExecutablePath,
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Common install locations for VcXsrv / Xming on Windows. */
export function candidateX11ExecutablePaths(customPath?: string): string[] {
  const out: string[] = []
  const custom = (customPath ?? configuredExecutablePath).trim()
  if (custom) out.push(custom)

  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const local = process.env['LOCALAPPDATA'] || ''
    out.push(
      join(pf, 'VcXsrv', 'vcxsrv.exe'),
      join(pf86, 'VcXsrv', 'vcxsrv.exe'),
      join(pf, 'Xming', 'Xming.exe'),
      join(pf86, 'Xming', 'Xming.exe'),
    )
    if (local) {
      out.push(join(local, 'Programs', 'VcXsrv', 'vcxsrv.exe'))
    }
  }
  return [...new Set(out)]
}

export async function resolveX11Executable(customPath?: string): Promise<string | null> {
  for (const p of candidateX11ExecutablePaths(customPath)) {
    if (await fileExists(p)) return p
  }
  return null
}

/**
 * Resolve either the saved path or a draft path supplied by the settings UI.
 * A draft must not mutate the runtime startup configuration before it is saved.
 */
export async function getX11ServerStatus(draftExecutablePath?: string): Promise<X11ServerStatus> {
  const executablePath = typeof draftExecutablePath === 'string'
    ? draftExecutablePath.trim()
    : configuredExecutablePath
  const resolved = await resolveX11Executable(executablePath)
  return {
    autoStart: autoStartEnabled,
    executablePath,
    resolvedExecutablePath: resolved,
    platform: process.platform,
    supported: process.platform === 'win32',
  }
}

export function buildX11ServerArgs(exePath: string, display: number): string[] {
  const base = exePath.toLowerCase()
  // `-ac` remains necessary because we do not manage the X server's xauth
  // cookie database ourselves. VcXsrv 1.20.14 rejects `-localhost` as an
  // unknown option, so the SSH connection itself is kept on loopback instead.
  if (base.endsWith('vcxsrv.exe')) {
    return [`:${display}`, '-multiwindow', '-clipboard', '-wgl', '-ac']
  }
  // Xming
  if (base.endsWith('xming.exe')) {
    return [`:${display}`, '-multiwindow', '-clipboard', '-localhost', '-ac']
  }
  return [`:${display}`, '-multiwindow', '-clipboard', '-localhost', '-ac']
}

async function waitForPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probeX11Port(host, port)) return true
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  return probeX11Port(host, port)
}

function spawnXServer(exePath: string, display: number): ChildProcess {
  const args = buildX11ServerArgs(exePath, display)
  const child = spawn(exePath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  return child
}

/**
 * Ensure a local X server is listening for X11 forwarding.
 * - If already up: ok
 * - If auto-start on and Windows: try VcXsrv/Xming
 * - Never blocks non-X11 connections (caller only invokes when x11Forwarding is on)
 */
export async function ensureX11ServerReady(
  host: string,
  display: number,
): Promise<X11EnsureResult> {
  const port = 6000 + display
  const base: Omit<X11EnsureResult, 'ready' | 'started'> = { host, port, display }

  if (await probeX11Port(host, port)) {
    return { ...base, ready: true, started: false }
  }

  if (!autoStartEnabled) {
    return {
      ...base,
      ready: false,
      started: false,
      message: t('x11.autoStartDisabled'),
    }
  }

  if (process.platform !== 'win32') {
    return {
      ...base,
      ready: false,
      started: false,
      message: t('x11.platformUnsupported'),
    }
  }

  // Serialize concurrent connect attempts for the same boot path
  if (startInFlight) {
    const prev = await startInFlight
    if (prev.port === port && prev.ready) return prev
    if (await probeX11Port(host, port)) {
      return { ...base, ready: true, started: false, executablePath: prev.executablePath }
    }
  }

  startInFlight = (async (): Promise<X11EnsureResult> => {
    if (await probeX11Port(host, port)) {
      return { ...base, ready: true, started: false }
    }

    const exe = await resolveX11Executable()
    if (!exe) {
      return {
        ...base,
        ready: false,
        started: false,
        message: t('x11.notFound'),
      }
    }

    try {
      // Reuse managed process only if same display; otherwise start another display instance
      if (managedProcess && managedDisplay === display && !managedProcess.killed) {
        const ok = await waitForPort(host, port, DEFAULT_WAIT_MS)
        return {
          ...base,
          ready: ok,
          started: false,
          executablePath: exe,
          message: ok ? undefined : t('x11.stillNotReady', { host, port }),
        }
      }

      const child = spawnXServer(exe, display)
      managedProcess = child
      managedDisplay = display
      child.once('exit', () => {
        if (managedProcess === child) {
          managedProcess = null
          managedDisplay = null
        }
      })
      child.once('error', () => {
        if (managedProcess === child) {
          managedProcess = null
          managedDisplay = null
        }
      })

      const ok = await waitForPort(host, port, DEFAULT_WAIT_MS)
      return {
        ...base,
        ready: ok,
        started: true,
        executablePath: exe,
        message: ok
          ? undefined
          : t('x11.startedButTimeout', {
              exe,
              host,
              port,
              seconds: DEFAULT_WAIT_MS / 1000,
            }),
      }
    } catch (err: any) {
      return {
        ...base,
        ready: false,
        started: false,
        executablePath: exe,
        message: t('x11.startFailed', { error: err?.message || String(err) }),
      }
    }
  })()

  try {
    return await startInFlight
  } finally {
    startInFlight = null
  }
}
