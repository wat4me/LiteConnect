import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export type X11PortOwnerKind = 'xserver_residual' | 'other' | 'unknown'

export type X11PortOwner = {
  pid: number
  name: string
  kind: X11PortOwnerKind
}

/** Image names we treat as local X display servers (hung / residual after quit). */
const XSERVER_NAME_RE = /^(vcxsrv|xming|xwin|xorg|xserver)(\.exe)?$/i

export function classifyPortOwnerName(name: string): X11PortOwnerKind {
  const base = name.trim().split(/[/\\]/).pop() || ''
  if (!base) return 'unknown'
  if (XSERVER_NAME_RE.test(base)) return 'xserver_residual'
  return 'other'
}

/**
 * Parse `netstat -ano` for a LISTENING row on the given TCP port.
 * Works with English and common localized "LISTENING" (连接/侦听) rows if PID column is last.
 */
export function parseNetstatListeningPid(output: string, port: number): number | null {
  const portToken = `:${port}`
  const lines = output.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    // Prefer rows that look like TCP + LISTENING (EN) or contain 侦听/监听 (ZH)
    const isListen =
      /\bLISTENING\b/i.test(line)
      || line.includes('LISTENING')
      || /侦听|监听/.test(line)
    if (!isListen && !/\bLISTEN\b/i.test(line)) continue
    // Must mention :port as local endpoint (avoid matching remote :6000 only)
    // netstat: Proto Local Foreign State PID
    const parts = line.split(/\s+/)
    if (parts.length < 4) continue
    const local = parts[1] || ''
    if (!local.endsWith(portToken) && !local.includes(portToken)) continue
    // For IPv6 netstat may show [::]:6000
    const localPortMatch = local.match(/:(\d+)$/)
    if (!localPortMatch || Number(localPortMatch[1]) !== port) continue
    const pidStr = parts[parts.length - 1]
    const pid = Number(pidStr)
    if (Number.isInteger(pid) && pid > 0) return pid
  }
  return null
}

/** Parse `tasklist /FI "PID eq N" /FO CSV /NH` → image name. */
export function parseTasklistCsvImageName(output: string, pid: number): string | null {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (const line of lines) {
    // "name.exe","1234","Console","1","12,345 K"
    const m = /^"([^"]+)"\s*,\s*"(\d+)"/.exec(line)
    if (m && Number(m[2]) === pid) return m[1]
    // sometimes without quotes
    const parts = line.split(',').map((p) => p.replace(/^"|"$/g, '').trim())
    if (parts.length >= 2 && Number(parts[1]) === pid && parts[0]) return parts[0]
  }
  return null
}

async function runCapture(cmd: string, args: string[], timeoutMs = 4000): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    })
    return `${stdout || ''}\n${stderr || ''}`
  } catch (err: any) {
    // tasklist / netstat often exit 0; on failure still may have stdout
    if (typeof err?.stdout === 'string' || typeof err?.stderr === 'string') {
      return `${err.stdout || ''}\n${err.stderr || ''}`
    }
    return ''
  }
}

/**
 * Resolve which process is LISTENING on TCP `port` (Windows).
 * Returns null on non-Windows or if lookup fails.
 */
export async function findListeningPortOwner(port: number): Promise<X11PortOwner | null> {
  if (process.platform !== 'win32') return null
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null

  const netstatOut = await runCapture('netstat.exe', ['-ano', '-p', 'tcp'])
  const pid = parseNetstatListeningPid(netstatOut, port)
  if (!pid) {
    return { pid: 0, name: '', kind: 'unknown' }
  }

  const taskOut = await runCapture('tasklist.exe', [
    '/FI',
    `PID eq ${pid}`,
    '/FO',
    'CSV',
    '/NH',
  ])
  const name = parseTasklistCsvImageName(taskOut, pid) || `PID ${pid}`
  return {
    pid,
    name,
    kind: classifyPortOwnerName(name),
  }
}

/** Force-kill a process tree by PID (Windows taskkill). */
export async function killPortOwnerProcess(pid: number): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'unsupported platform' }
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, error: 'invalid pid' }
  }
  // Refuse to kill critical system processes by low pid heuristic
  if (pid <= 4) {
    return { ok: false, error: 'refused system process' }
  }
  try {
    await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 8000,
      encoding: 'utf8',
    })
    return { ok: true }
  } catch (err: any) {
    const msg = String(err?.stderr || err?.message || err).trim()
    // taskkill prints success to stderr sometimes; check code
    if (err?.code === 0 || /SUCCESS/i.test(msg)) return { ok: true }
    return { ok: false, error: msg || 'taskkill failed' }
  }
}

/** Human-readable owner line for notices (no i18n — composed by callers with t()). */
export function formatPortOwnerLabel(owner: X11PortOwner | null | undefined): string {
  if (!owner || !owner.pid) return ''
  return owner.name ? `${owner.name} (PID ${owner.pid})` : `PID ${owner.pid}`
}
