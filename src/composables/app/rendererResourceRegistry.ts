import type { RendererResourceSnapshot } from '@shared/appResourceStats'

type TerminalProbe = () => { cols: number; bufferLines: number } | null
type SftpProbe = () => { entryCount: number } | null
type AiProbe = () => { sessionCount: number; estimatedBytes: number }

const terminals = new Map<string, TerminalProbe>()
const sftp = new Map<string, SftpProbe>()
let aiProbe: AiProbe | null = null

export function registerTerminalResource(sessionId: string, probe: TerminalProbe): void {
  if (!sessionId) return
  terminals.set(sessionId, probe)
}

export function unregisterTerminalResource(sessionId: string): void {
  terminals.delete(sessionId)
}

export function registerSftpResource(sessionId: string, probe: SftpProbe): void {
  if (!sessionId) return
  sftp.set(sessionId, probe)
}

export function unregisterSftpResource(sessionId: string): void {
  sftp.delete(sessionId)
}

export function registerAiResourceProbe(probe: AiProbe | null): void {
  aiProbe = probe
}

export function collectRendererResourceSnapshot(): RendererResourceSnapshot {
  const terminalRows: RendererResourceSnapshot['terminals'] = []
  for (const [sessionId, probe] of terminals) {
    const snap = probe()
    if (!snap) continue
    terminalRows.push({ sessionId, cols: snap.cols, bufferLines: snap.bufferLines })
  }
  const sftpRows: RendererResourceSnapshot['sftp'] = []
  for (const [sessionId, probe] of sftp) {
    const snap = probe()
    if (!snap) continue
    sftpRows.push({ sessionId, entryCount: snap.entryCount })
  }
  return {
    terminals: terminalRows,
    sftp: sftpRows,
    ai: aiProbe ? aiProbe() : { sessionCount: 0, estimatedBytes: 0 },
  }
}
