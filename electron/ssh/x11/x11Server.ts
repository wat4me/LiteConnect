import { spawn, type ChildProcess } from 'child_process'
import { access } from 'fs/promises'
import { constants } from 'fs'
import { dirname, join } from 'path'
import { probeX11Port, probeX11PortDetailed } from './x11'
import {
  findListeningPortOwner,
  formatPortOwnerLabel,
  type X11PortOwner,
} from './x11PortOwner'
import { t } from '../../i18n'

export type X11EnsureResult = {
  ready: boolean
  /** True when we spawned a process this call */
  started: boolean
  host: string
  port: number
  display: number
  message?: string
  executablePath?: string
  /**
   * TCP accepted but no valid X11 handshake (zombie listener / wrong process on
   * the display port after VcXsrv was closed).
   */
  portOccupiedNotX11?: boolean
  /** Process holding the display TCP port, when resolved (Windows). */
  portOwner?: X11PortOwner
}

export type X11ServerStatus = {
  autoStart: boolean
  executablePath: string
  resolvedExecutablePath: string | null
  platform: NodeJS.Platform
  supported: boolean
}

const DEFAULT_WAIT_MS = 10000
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
  // `-silent-dup-error`: if :N is already taken, exit quietly instead of a modal.
  if (base.endsWith('vcxsrv.exe')) {
    return [`:${display}`, '-multiwindow', '-clipboard', '-wgl', '-ac', '-silent-dup-error']
  }
  // Xming
  if (base.endsWith('xming.exe')) {
    return [`:${display}`, '-multiwindow', '-clipboard', '-localhost', '-ac']
  }
  return [`:${display}`, '-multiwindow', '-clipboard', '-localhost', '-ac']
}

/** True while the Node ChildProcess handle still refers to a live OS process. */
export function isChildProcessAlive(child: ChildProcess | null | undefined): boolean {
  if (!child) return false
  // exitCode/signalCode are set once the process has exited
  if (child.exitCode !== null || child.signalCode !== null) return false
  // killed only reflects kill() from our side; still treat as dead if flagged
  if (child.killed) return false
  return true
}

async function waitForPort(
  host: string,
  port: number,
  timeoutMs: number,
  child?: ChildProcess | null,
): Promise<{ ok: boolean; exitedEarly: boolean; exitCode: number | null; signal: NodeJS.Signals | null }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child && !isChildProcessAlive(child)) {
      return {
        ok: false,
        exitedEarly: true,
        exitCode: child.exitCode,
        signal: child.signalCode,
      }
    }
    if (await probeX11Port(host, port)) {
      return { ok: true, exitedEarly: false, exitCode: null, signal: null }
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  if (child && !isChildProcessAlive(child)) {
    return {
      ok: false,
      exitedEarly: true,
      exitCode: child.exitCode,
      signal: child.signalCode,
    }
  }
  const ok = await probeX11Port(host, port)
  return { ok, exitedEarly: false, exitCode: null, signal: null }
}

function spawnXServer(exePath: string, display: number): ChildProcess {
  const args = buildX11ServerArgs(exePath, display)
  // cwd must be the install dir so VcXsrv can load sibling DLLs (xcb, etc.).
  // windowsHide:false — hidden console-less GUI servers sometimes fail to init.
  const child = spawn(exePath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    cwd: dirname(exePath),
    env: process.env,
  })
  // Keep a ref until we know listen succeeded or failed; unref after settle so
  // the app can exit without waiting on the X server.
  return child
}

function clearManagedIf(child: ChildProcess) {
  if (managedProcess === child) {
    managedProcess = null
    managedDisplay = null
  }
}

/** Diagnose a TCP-open / non-X11 port: identify residual VcXsrv vs other apps. */
async function resultPortOccupiedNotX11(
  base: Omit<X11EnsureResult, 'ready' | 'started'>,
  extra?: Partial<X11EnsureResult>,
): Promise<X11EnsureResult> {
  const owner = await findListeningPortOwner(base.port)
  const ownerLabel = formatPortOwnerLabel(owner)
  let message: string
  if (owner && owner.pid > 0 && owner.kind === 'xserver_residual') {
    message = t('x11.portOccupiedResidualX', {
      host: base.host,
      port: base.port,
      process: ownerLabel,
    })
  } else if (owner && owner.pid > 0 && owner.kind === 'other') {
    message = t('x11.portOccupiedOtherProcess', {
      host: base.host,
      port: base.port,
      process: ownerLabel,
    })
  } else {
    message = t('x11.portOccupiedNotX11', { host: base.host, port: base.port })
  }
  return {
    ...base,
    ready: false,
    started: false,
    portOccupiedNotX11: true,
    portOwner: owner && owner.pid > 0 ? owner : undefined,
    message,
    ...extra,
  }
}

/**
 * Settings-page self-test: force auto-start attempt using an optional draft path
 * without permanently mutating the live auto-start / path configuration.
 * Display defaults to 0 (port 6000) — same as connection defaults.
 */
export async function testX11ServerReady(opts?: {
  executablePath?: string
  host?: string
  display?: number
}): Promise<X11EnsureResult> {
  const host = (opts?.host ?? '127.0.0.1').trim() || '127.0.0.1'
  const display =
    typeof opts?.display === 'number' && Number.isInteger(opts.display) && opts.display >= 0 && opts.display <= 99
      ? opts.display
      : 0

  const prevAuto = autoStartEnabled
  const prevPath = configuredExecutablePath
  try {
    // Explicit user action: always try to start even if auto-start is off in settings.
    autoStartEnabled = true
    if (typeof opts?.executablePath === 'string') {
      configuredExecutablePath = opts.executablePath.trim()
    }
    return await ensureX11ServerReady(host, display)
  } finally {
    autoStartEnabled = prevAuto
    configuredExecutablePath = prevPath
  }
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

  const initial = await probeX11PortDetailed(host, port)
  if (initial.ok) {
    return { ...base, ready: true, started: false }
  }

  // Something still accepts on :6000 after VcXsrv was quit (or another app
  // took the port). Spawning another X server will fail to bind — surface clearly.
  if (initial.tcpOpen) {
    return resultPortOccupiedNotX11(base)
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
    if (prev.portOccupiedNotX11) return { ...base, ...prev, host, port, display }
    if (await probeX11Port(host, port)) {
      return { ...base, ready: true, started: false, executablePath: prev.executablePath }
    }
  }

  startInFlight = (async (): Promise<X11EnsureResult> => {
    const again = await probeX11PortDetailed(host, port)
    if (again.ok) {
      return { ...base, ready: true, started: false }
    }
    if (again.tcpOpen) {
      return resultPortOccupiedNotX11(base)
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
      // Reuse only if the child is still alive; exitCode null ≠ running forever
      if (
        managedProcess
        && managedDisplay === display
        && isChildProcessAlive(managedProcess)
      ) {
        const wait = await waitForPort(host, port, DEFAULT_WAIT_MS, managedProcess)
        if (wait.exitedEarly) {
          clearManagedIf(managedProcess)
          // fall through to spawn a fresh instance below
        } else {
          return {
            ...base,
            ready: wait.ok,
            started: false,
            executablePath: exe,
            message: wait.ok ? undefined : t('x11.stillNotReady', { host, port }),
          }
        }
      }

      // Drop stale handle before spawning again
      if (managedProcess && !isChildProcessAlive(managedProcess)) {
        managedProcess = null
        managedDisplay = null
      }

      const child = spawnXServer(exe, display)
      managedProcess = child
      managedDisplay = display
      console.info(
        `[X11] spawned display :${display}, pid=${child.pid ?? 'unknown'}, exe=${exe}, args=${buildX11ServerArgs(exe, display).join(' ')}`,
      )

      child.once('exit', (code, signal) => {
        console.warn(
          `[X11] display :${display}, pid=${child.pid ?? 'unknown'} exited code=${code ?? 'null'} signal=${signal ?? 'none'}`,
        )
        clearManagedIf(child)
      })
      child.once('error', (err) => {
        console.error(
          `[X11] display :${display}, pid=${child.pid ?? 'unknown'} start error: ${err.message}`,
        )
        clearManagedIf(child)
      })

      const wait = await waitForPort(host, port, DEFAULT_WAIT_MS, child)
      // Allow Node to exit without waiting on the detached X server
      try {
        child.unref()
      } catch {}

      if (wait.exitedEarly) {
        const detail =
          wait.signal
            ? `signal ${wait.signal}`
            : `exit code ${wait.exitCode ?? 'unknown'}`
        // Re-check: process died because display port already taken by non-X?
        const after = await probeX11PortDetailed(host, port, 800)
        if (after.tcpOpen && !after.ok) {
          return resultPortOccupiedNotX11(base, { started: true, executablePath: exe })
        }
        return {
          ...base,
          ready: false,
          started: true,
          executablePath: exe,
          message: t('x11.startExited', { exe, detail, host, port }),
        }
      }

      if (wait.ok) {
        return {
          ...base,
          ready: true,
          started: true,
          executablePath: exe,
        }
      }

      const afterTimeout = await probeX11PortDetailed(host, port, 800)
      if (afterTimeout.tcpOpen && !afterTimeout.ok) {
        return resultPortOccupiedNotX11(base, { started: true, executablePath: exe })
      }

      return {
        ...base,
        ready: false,
        started: true,
        executablePath: exe,
        message: t('x11.startedButTimeout', {
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
