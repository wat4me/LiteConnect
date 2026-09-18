import { describe, expect, it } from 'vitest'
import {
  SSH_SESSION_WARN_AT,
  attachRendererEstimates,
  classifyProcessKind,
  classifyUtilityKind,
  collectAppResourceStats,
  estimateSftpBytes,
  estimateXtermBufferBytes,
  estimateXtermBytes,
  formatBytes,
  sshSessionWarnLevel,
  XTERM_BYTES_PER_CELL,
  XTERM_INSTANCE_OVERHEAD_BYTES,
} from './appResourceStats'

describe('app resource stats', () => {
  it('classifies Electron process types', () => {
    expect(classifyProcessKind('Browser')).toBe('main')
    expect(classifyProcessKind('Tab')).toBe('renderer')
    expect(classifyProcessKind('GPU')).toBe('gpu')
    expect(classifyProcessKind('Utility')).toBe('utility')
    expect(classifyProcessKind('Zygote')).toBe('other')
  })

  it('recognizes Chromium network utility by service name', () => {
    expect(classifyUtilityKind('Network Service', 'network.mojom.NetworkService')).toBe('network')
    expect(classifyUtilityKind('Audio Service', undefined)).toBe('audio')
    expect(classifyUtilityKind(undefined, undefined)).toBe('other')
  })

  it('estimates xterm scrollback from cols × lines × 12 bytes', () => {
    expect(estimateXtermBufferBytes(120, 5000)).toBe(120 * 5000 * XTERM_BYTES_PER_CELL)
    expect(estimateXtermBytes(120, 5000)).toBe(
      XTERM_INSTANCE_OVERHEAD_BYTES + 120 * 5000 * XTERM_BYTES_PER_CELL,
    )
    expect(estimateSftpBytes(0)).toBeGreaterThan(0)
  })

  it('formats bytes for the panel', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(800)).toBe('800 B')
    expect(formatBytes(12 * 1024)).toBe('12 KB')
    expect(formatBytes(15.2 * 1024 * 1024)).toBe('15 MB')
  })

  it('warns at 12 SSH windows, then every 8 more', () => {
    expect(sshSessionWarnLevel(11)).toBeNull()
    expect(sshSessionWarnLevel(12)).toBe(SSH_SESSION_WARN_AT)
    expect(sshSessionWarnLevel(19)).toBe(12)
    expect(sshSessionWarnLevel(20)).toBe(20)
    expect(sshSessionWarnLevel(28)).toBe(28)
  })

  it('labels renderer processes by window role and sums working set', () => {
    const stats = collectAppResourceStats({
      now: 1,
      ssh: { sessionCount: 3, sftpCount: 1 },
      dbSessionCount: 2,
      windows: [
        { pid: 11, role: 'main' },
        { pid: 22, role: 'database' },
      ],
      processes: [
        { pid: 1, type: 'Browser', workingSetKb: 1000 },
        { pid: 11, type: 'Tab', workingSetKb: 2000 },
        { pid: 22, type: 'Tab', workingSetKb: 1500 },
        { pid: 3, type: 'GPU', workingSetKb: 4000 },
      ],
    })
    expect(stats.totalWorkingSetBytes).toBe((1000 + 2000 + 1500 + 4000) * 1024)
    expect(stats.processes.find((p) => p.pid === 11)?.role).toBe('main')
    expect(stats.processes.find((p) => p.pid === 22)?.role).toBe('database')
    expect(stats.features.find((f) => f.id === 'database')?.estimatedBytes).toBe(1500 * 1024)
    expect(stats.windows.database).toBe(true)
  })

  it('attaches renderer SSH/SFTP/AI estimates without changing process totals', () => {
    const base = collectAppResourceStats({
      now: 1,
      ssh: { sessionCount: 1, sftpCount: 0 },
      dbSessionCount: 0,
      windows: [{ pid: 11, role: 'main' }],
      processes: [{ pid: 11, type: 'Tab', workingSetKb: 8000 }],
    })
    const merged = attachRendererEstimates(base, {
      terminals: [{ sessionId: 'a', cols: 120, bufferLines: 100 }],
      sftp: [{ sessionId: 'a', entryCount: 10 }],
      ai: { sessionCount: 1, estimatedBytes: 80_000 },
    })
    expect(merged.totalWorkingSetBytes).toBe(base.totalWorkingSetBytes)
    expect(merged.features.find((f) => f.id === 'ssh')?.estimatedBytes).toBe(estimateXtermBytes(120, 100))
    expect(merged.features.find((f) => f.id === 'sftp')?.count).toBe(1)
    expect(merged.features.find((f) => f.id === 'ai')?.estimatedBytes).toBe(80_000)
  })
})
