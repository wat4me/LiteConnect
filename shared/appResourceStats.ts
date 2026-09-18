/** Warn the first time this many SSH tabs are open, then every STEP thereafter. */
export const SSH_SESSION_WARN_AT = 12
export const SSH_SESSION_WARN_STEP = 8

/** xterm.js BufferLine: 3× uint32 per cell. */
export const XTERM_BYTES_PER_CELL = 12
/** Vue + xterm instance overhead beyond the scrollback typed array. */
export const XTERM_INSTANCE_OVERHEAD_BYTES = 2 * 1024 * 1024
/** Open SFTP sidebar instance besides listing objects. */
export const SFTP_INSTANCE_OVERHEAD_BYTES = 512 * 1024
export const SFTP_BYTES_PER_ENTRY = 256
/** AI sidebar session state besides message text. */
export const AI_SESSION_OVERHEAD_BYTES = 64 * 1024

export type AppProcessKind = 'main' | 'renderer' | 'gpu' | 'utility' | 'other'
export type AppWindowRole = 'main' | 'database' | 'detached'
export type AppUtilityKind = 'network' | 'audio' | 'other'

export type AppProcessMemory = {
  pid: number
  kind: AppProcessKind
  role?: AppWindowRole
  utilityKind?: AppUtilityKind
  cpuPercent: number
  workingSetBytes: number
  peakWorkingSetBytes: number
}

export type AppFeatureId = 'ssh' | 'sftp' | 'database' | 'ai' | 'electron'

export type AppFeatureMemory = {
  id: AppFeatureId
  count: number
  /** Best-effort attributed bytes; null when we only have a count. */
  estimatedBytes: number | null
}

export type AppResourceStats = {
  collectedAt: number
  processes: AppProcessMemory[]
  totalWorkingSetBytes: number
  features: AppFeatureMemory[]
  sshSessionCount: number
  sftpChannelCount: number
  dbSessionCount: number
  windows: {
    main: boolean
    database: boolean
    detached: number
  }
}

export type ProcessMetricInput = {
  pid: number
  type: string
  name?: string
  serviceName?: string
  cpuPercent?: number
  workingSetKb: number
  peakWorkingSetKb?: number
}

export type WindowPidRole = {
  pid: number
  role: AppWindowRole
}

export type RendererResourceSnapshot = {
  terminals: Array<{ sessionId: string; cols: number; bufferLines: number }>
  sftp: Array<{ sessionId: string; entryCount: number }>
  ai: { sessionCount: number; estimatedBytes: number }
}

export function classifyProcessKind(type: string): AppProcessKind {
  const value = String(type || '').toLowerCase()
  if (value === 'browser') return 'main'
  if (value === 'tab' || value === 'renderer') return 'renderer'
  if (value === 'gpu') return 'gpu'
  if (value === 'utility') return 'utility'
  return 'other'
}

export function classifyUtilityKind(name?: string, serviceName?: string): AppUtilityKind {
  const text = `${name || ''} ${serviceName || ''}`.toLowerCase()
  if (text.includes('network')) return 'network'
  if (text.includes('audio')) return 'audio'
  return 'other'
}

export function estimateXtermBufferBytes(cols: number, bufferLines: number): number {
  const c = Math.max(0, Math.round(Number(cols) || 0))
  const n = Math.max(0, Math.round(Number(bufferLines) || 0))
  return n * c * XTERM_BYTES_PER_CELL
}

export function estimateXtermBytes(cols: number, bufferLines: number): number {
  return XTERM_INSTANCE_OVERHEAD_BYTES + estimateXtermBufferBytes(cols, bufferLines)
}

export function estimateSftpBytes(entryCount: number): number {
  const n = Math.max(0, Math.round(Number(entryCount) || 0))
  return SFTP_INSTANCE_OVERHEAD_BYTES + n * SFTP_BYTES_PER_ENTRY
}

export function estimateAiTextBytes(charCount: number): number {
  const n = Math.max(0, Math.round(Number(charCount) || 0))
  return n * 2
}

export function formatBytes(bytes: number): string {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) {
    const kb = n / 1024
    return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`
  }
  const mb = n / (1024 * 1024)
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`
}

/**
 * 12, 20, 28… — the highest crossed warning rung for this count.
 * Null when below the first warning.
 */
export function sshSessionWarnLevel(count: number): number | null {
  const n = Math.max(0, Math.round(Number(count) || 0))
  if (n < SSH_SESSION_WARN_AT) return null
  const steps = Math.floor((n - SSH_SESSION_WARN_AT) / SSH_SESSION_WARN_STEP)
  return SSH_SESSION_WARN_AT + steps * SSH_SESSION_WARN_STEP
}

export function collectAppResourceStats(input: {
  processes: ProcessMetricInput[]
  windows: WindowPidRole[]
  ssh: { sessionCount: number; sftpCount: number }
  dbSessionCount: number
  now?: number
}): AppResourceStats {
  const roleByPid = new Map<number, AppWindowRole>()
  for (const win of input.windows) {
    if (!roleByPid.has(win.pid)) roleByPid.set(win.pid, win.role)
  }

  const processes: AppProcessMemory[] = input.processes.map((proc) => {
    const kind = classifyProcessKind(proc.type)
    const workingSetBytes = Math.max(0, Math.round(proc.workingSetKb || 0) * 1024)
    const peakWorkingSetBytes = Math.max(0, Math.round(proc.peakWorkingSetKb || proc.workingSetKb || 0) * 1024)
    return {
      pid: proc.pid,
      kind,
      role: kind === 'renderer' ? roleByPid.get(proc.pid) : undefined,
      utilityKind: kind === 'utility' ? classifyUtilityKind(proc.name, proc.serviceName) : undefined,
      cpuPercent: Number.isFinite(proc.cpuPercent) ? Number(proc.cpuPercent) : 0,
      workingSetBytes,
      peakWorkingSetBytes,
    }
  })

  const totalWorkingSetBytes = processes.reduce((sum, proc) => sum + proc.workingSetBytes, 0)
  const dbRenderer = processes.find((proc) => proc.kind === 'renderer' && proc.role === 'database')
  const sshSessionCount = Math.max(0, Math.round(input.ssh.sessionCount || 0))
  const sftpChannelCount = Math.max(0, Math.round(input.ssh.sftpCount || 0))
  const dbSessionCount = Math.max(0, Math.round(input.dbSessionCount || 0))

  return {
    collectedAt: input.now ?? Date.now(),
    processes,
    totalWorkingSetBytes,
    sshSessionCount,
    sftpChannelCount,
    dbSessionCount,
    windows: {
      main: input.windows.some((win) => win.role === 'main'),
      database: input.windows.some((win) => win.role === 'database'),
      detached: input.windows.filter((win) => win.role === 'detached').length,
    },
    features: [
      { id: 'electron', count: processes.length, estimatedBytes: totalWorkingSetBytes },
      { id: 'ssh', count: sshSessionCount, estimatedBytes: null },
      { id: 'sftp', count: sftpChannelCount, estimatedBytes: null },
      {
        id: 'database',
        count: dbSessionCount,
        estimatedBytes: dbRenderer ? dbRenderer.workingSetBytes : null,
      },
      { id: 'ai', count: 0, estimatedBytes: null },
    ],
  }
}

export function attachRendererEstimates(
  stats: AppResourceStats,
  renderer: RendererResourceSnapshot,
): AppResourceStats {
  const sshBytes = renderer.terminals.reduce(
    (sum, term) => sum + estimateXtermBytes(term.cols, term.bufferLines),
    0,
  )
  const sftpBytes = renderer.sftp.reduce(
    (sum, item) => sum + estimateSftpBytes(item.entryCount),
    0,
  )
  const sshCount = Math.max(stats.sshSessionCount, renderer.terminals.length)
  const sftpCount = Math.max(stats.sftpChannelCount, renderer.sftp.length)

  return {
    ...stats,
    sshSessionCount: sshCount,
    sftpChannelCount: sftpCount,
    features: stats.features.map((feature) => {
      if (feature.id === 'ssh') {
        return {
          ...feature,
          count: sshCount,
          estimatedBytes: renderer.terminals.length > 0 ? sshBytes : feature.estimatedBytes,
        }
      }
      if (feature.id === 'sftp') {
        return {
          ...feature,
          count: sftpCount,
          estimatedBytes: renderer.sftp.length > 0 ? sftpBytes : feature.estimatedBytes,
        }
      }
      if (feature.id === 'ai') {
        return {
          ...feature,
          count: renderer.ai.sessionCount,
          estimatedBytes: renderer.ai.sessionCount > 0 ? renderer.ai.estimatedBytes : 0,
        }
      }
      return feature
    }),
  }
}
