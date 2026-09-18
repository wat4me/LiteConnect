import { app } from 'electron'
import type { SSHManager } from '../ssh/manager'
import type { DatabaseManager } from '../db/manager'
import {
  collectAppResourceStats,
  type AppResourceStats,
  type ProcessMetricInput,
  type WindowPidRole,
} from '../../shared/appResourceStats'
import { getAllWindows, getWindowRole } from '../window/windowRegistry'

export type ResourceStatsDeps = {
  ssh: SSHManager
  db: DatabaseManager
}

function processMetrics(): ProcessMetricInput[] {
  return app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    name: metric.name,
    serviceName: metric.serviceName,
    cpuPercent: metric.cpu?.percentCPUUsage,
    workingSetKb: metric.memory?.workingSetSize ?? 0,
    peakWorkingSetKb: metric.memory?.peakWorkingSetSize,
  }))
}

function windowPidRoles(): WindowPidRole[] {
  const out: WindowPidRole[] = []
  const seen = new Set<number>()
  for (const win of getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    const pid = win.webContents.getOSProcessId()
    if (!pid || seen.has(pid)) continue
    seen.add(pid)
    out.push({ pid, role: getWindowRole(win) })
  }
  return out
}

export function collectLiveResourceStats(deps: ResourceStatsDeps): AppResourceStats {
  const snapshots = deps.ssh.listSessionSnapshots()
  return collectAppResourceStats({
    processes: processMetrics(),
    windows: windowPidRoles(),
    ssh: {
      sessionCount: snapshots.length,
      sftpCount: snapshots.filter((item) => item.hasSftp).length,
    },
    dbSessionCount: deps.db.listSessions().length,
  })
}
