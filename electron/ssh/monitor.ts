import { SSHManager } from './manager'

export interface MonitorData {
  hostname: string
  kernel: string
  arch: string
  uptime: string

  cpu: {
    usage: number
    cores: number[]
    loadAvg: [number, number, number]
  }

  memory: {
    total: number
    used: number
    free: number
    buffCache: number
    available: number
    swapTotal: number
    swapUsed: number
  }

  disk: {
    filesystem: string
    total: number
    used: number
    available: number
    mountPoint: string
  }[]

  processes: {
    pid: number
    user: string
    cpu: number
    mem: number
    command: string
  }[]

  timestamp: number
}

type CollectorFn = (session: string, sshManager: SSHManager) => Promise<Partial<MonitorData>>

async function execCommand(sshManager: SSHManager, sessionId: string, command: string, timeoutMs = 3000): Promise<string> {
  try {
    return await sshManager.sftpExec(sessionId, command, timeoutMs)
  } catch {
    return ''
  }
}

async function collectSystemInfo(sessionId: string, sshManager: SSHManager): Promise<Partial<MonitorData>> {
  const [uname, uptime] = await Promise.all([
    execCommand(sshManager, sessionId, 'uname -a'),
    execCommand(sshManager, sessionId, 'uptime -p 2>/dev/null || cat /proc/uptime 2>/dev/null || echo ""'),
  ])

  const parts = uname.split(' ')
  let uptimeStr = uptime.trim()
  if (uptimeStr.startsWith('up ')) uptimeStr = uptimeStr.slice(3)
  if (/^\d+\.\d+/.test(uptimeStr)) {
    const secs = parseFloat(uptimeStr.split(' ')[0])
    const d = Math.floor(secs / 86400)
    const h = Math.floor((secs % 86400) / 3600)
    const m = Math.floor((secs % 3600) / 60)
    uptimeStr = `${d}d ${h}h ${m}m`
  }

  return {
    hostname: parts[1] || '',
    kernel: parts[2] || '',
    arch: parts[12] || parts[parts.length - 1] || '',
    uptime: uptimeStr || '--',
  }
}

let prevCpuTimes: Map<string, { idle: number; total: number }> = new Map()
let coreCpuPrev: Map<string, { idle: number; total: number }[]> = new Map()

async function collectCpu(sessionId: string, sshManager: SSHManager): Promise<Partial<MonitorData>> {
  const [statOut, loadavgOut] = await Promise.all([
    execCommand(sshManager, sessionId, 'cat /proc/stat 2>/dev/null || echo "PROC_UNAVAILABLE"'),
    execCommand(sshManager, sessionId, 'cat /proc/loadavg 2>/dev/null || uptime 2>/dev/null || echo ""'),
  ])

  let usage = -1
  let cores: number[] = []

  if (!statOut.includes('PROC_UNAVAILABLE') && statOut.length > 0) {
    const lines = statOut.split('\n')
    const cpuLine = lines.find(l => l.startsWith('cpu '))
    if (cpuLine) {
      const vals = cpuLine.trim().split(/\s+/).slice(1).map(Number)
      const idle = vals[3] || 0
      const total = vals.reduce((a: number, b: number) => a + b, 0)
      const prev = prevCpuTimes.get(sessionId)
      if (prev && total > 0) {
        const dIdle = idle - prev.idle
        const dTotal = total - prev.total
        usage = dTotal > 0 ? Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10 : 0
      }
      prevCpuTimes.set(sessionId, { idle, total })
    }

    const coreLines = lines.filter(l => /^cpu\d+/.test(l))
    const prevCores = coreCpuPrev.get(sessionId) || []
    const curCores: { idle: number; total: number }[] = []
    for (const line of coreLines) {
      const v = line.trim().split(/\s+/).slice(1).map(Number)
      curCores.push({ idle: v[3] || 0, total: v.reduce((a: number, b: number) => a + b, 0) })
    }
    if (prevCores.length === curCores.length && prevCores.length > 0) {
      cores = curCores.map((cur, i) => {
        const prev = prevCores[i]
        const dTotal = cur.total - prev.total
        const dIdle = cur.idle - prev.idle
        return dTotal > 0 ? Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10 : 0
      })
    }
    coreCpuPrev.set(sessionId, curCores)
  }

  if (usage === -1) {
    const topOut = await execCommand(sshManager, sessionId, 'top -bn1 2>/dev/null | head -3')
    const cpuMatch = topOut.match(/(\d+\.?\d*)\s*%?\s*id/i) || topOut.match(/Cpu[^:]*:\s*[^,]*,\s*[^,]*,\s*[^,]*,\s*([^,]+)/i)
    if (cpuMatch) {
      usage = Math.round((100 - parseFloat(cpuMatch[1])) * 10) / 10
    }
  }

  let loadAvg: [number, number, number] = [0, 0, 0]
  if (loadavgOut.trim()) {
    const nums = loadavgOut.trim().split(/\s+/).map(Number)
    if (nums.length >= 3 && !isNaN(nums[0])) {
      loadAvg = [nums[0], nums[1], nums[2]]
    } else {
      const lm = loadavgOut.match(/load averages?:\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
      if (lm) loadAvg = [parseFloat(lm[1]), parseFloat(lm[2]), parseFloat(lm[3])]
    }
  }

  return {
    cpu: {
      usage: usage >= 0 ? usage : -1,
      cores,
      loadAvg,
    },
  }
}

async function collectMemory(sessionId: string, sshManager: SSHManager): Promise<Partial<MonitorData>> {
  const [meminfo, freeOut] = await Promise.all([
    execCommand(sshManager, sessionId, 'cat /proc/meminfo 2>/dev/null || echo "PROC_UNAVAILABLE"'),
    execCommand(sshManager, sessionId, 'free -b 2>/dev/null || vm_stat 2>/dev/null || echo ""'),
  ])

  let memory: MonitorData['memory'] = {
    total: 0, used: 0, free: 0, buffCache: 0, available: 0, swapTotal: 0, swapUsed: 0,
  }

  if (!meminfo.includes('PROC_UNAVAILABLE') && meminfo.length > 0) {
    const get = (key: string, fallback = 0): number => {
      const m = meminfo.match(new RegExp(`${key}:\\s*(\\d+)`))
      return m ? parseInt(m[1]) * 1024 : fallback
    }
    memory.total = get('MemTotal')
    memory.available = get('MemAvailable')
    memory.free = get('MemFree')
    memory.buffCache = get('Buffers') + get('Cached')
    memory.used = memory.total - memory.available
    memory.swapTotal = get('SwapTotal')
    memory.swapUsed = get('SwapTotal') - get('SwapFree')
  } else if (freeOut.includes(':')) {
    const lines = freeOut.trim().split('\n')
    const memLine = lines.find(l => l.startsWith('Mem:'))
    const swapLine = lines.find(l => l.startsWith('Swap:'))
    if (memLine) {
      const vals = memLine.split(/\s+/).slice(1).map(Number)
      if (vals.length >= 6) {
        memory.total = vals[0]
        memory.used = vals[1]
        memory.free = vals[2]
        memory.buffCache = vals[4]
        memory.available = vals[5]
      } else if (vals.length >= 3) {
        memory.total = vals[0]
        memory.used = vals[1]
        memory.free = vals[2]
        memory.available = vals[0] - vals[1]
      }
    }
    if (swapLine) {
      const vals = swapLine.split(/\s+/).slice(1).map(Number)
      if (vals.length >= 3) {
        memory.swapTotal = vals[0]
        memory.swapUsed = vals[1]
      }
    }
  } else if (freeOut.includes('page size')) {
    const pageSizeMatch = freeOut.match(/page size of (\d+) bytes/i) || freeOut.match(/Page size:\s*(\d+)/i)
    const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1]) : 4096
    const getNum = (key: string): number => {
      const m = freeOut.match(new RegExp(`${key}[\\s:]+(\\d+)`, 'i'))
      return m ? parseInt(m[1]) * pageSize : 0
    }
    let totalMem = getNum('PhysMem')
    if (totalMem === 0) {
      const sysctlOut = await execCommand(sshManager, sessionId, 'sysctl -n hw.memsize 2>/dev/null || echo ""')
      totalMem = parseInt(sysctlOut.trim()) || 0
    }
    memory.total = totalMem
    memory.available = getNum('free')
    memory.used = memory.total - memory.available
  }

  return { memory }
}

async function collectDisk(sessionId: string, sshManager: SSHManager): Promise<Partial<MonitorData>> {
  const dfOut = await execCommand(sshManager, sessionId, 'df -k 2>/dev/null || echo ""')
  if (!dfOut.trim()) return { disk: [] }

  const lines = dfOut.trim().split('\n').slice(1)
  const disk: MonitorData['disk'] = []

  for (const line of lines) {
    const parts = line.split(/\s+/)
    if (parts.length < 6) continue
    const filesystem = parts[0]
    const total = parseInt(parts[1]) * 1024
    const used = parseInt(parts[2]) * 1024
    const available = parseInt(parts[3]) * 1024
    const mountPoint = parts.slice(5).join(' ')
    if (mountPoint.startsWith('/dev') || mountPoint.startsWith('/sys') || mountPoint.startsWith('/proc') || mountPoint.startsWith('/run')) continue
    if (filesystem.startsWith('tmpfs') || filesystem.startsWith('devtmpfs') || filesystem.startsWith('overlay')) continue
    disk.push({ filesystem, total, used, available, mountPoint })
  }

  return { disk }
}

async function collectProcesses(sessionId: string, sshManager: SSHManager): Promise<Partial<MonitorData>> {
  const psOut = await execCommand(sshManager, sessionId, 'ps aux --sort=-%mem 2>/dev/null | head -n 11 || ps aux | sort -k4 -rn | head -n 11 || echo ""')
  if (!psOut.trim()) return { processes: [] }

  const lines = psOut.trim().split('\n').slice(1)
  const processes: MonitorData['processes'] = []

  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 11) continue
    const pid = parseInt(parts[1])
    const user = parts[0]
    const cpu = parseFloat(parts[2])
    const mem = parseFloat(parts[3])
    const command = parts.slice(10).join(' ')
    if (isNaN(pid)) continue
    processes.push({ pid, user, cpu, mem, command })
  }

  return { processes }
}

const COLLECTORS: { key: keyof MonitorData; fn: CollectorFn }[] = [
  { key: 'cpu', fn: collectCpu },
  { key: 'memory', fn: collectMemory },
  { key: 'disk', fn: collectDisk },
  { key: 'processes', fn: collectProcesses },
]

export class MonitorCollector {
  private timers: Map<string, { fast: ReturnType<typeof setInterval>; normal: ReturnType<typeof setInterval>; slow: ReturnType<typeof setInterval> }> = new Map()
  private data: Map<string, MonitorData> = new Map()
  private systemInfoDone: Set<string> = new Set()
  private collecting: Map<string, Set<keyof MonitorData>> = new Map()
  private onData: (sessionId: string, data: MonitorData) => void
  private sshManager: SSHManager

  constructor(sshManager: SSHManager, onData: (sessionId: string, data: MonitorData) => void) {
    this.sshManager = sshManager
    this.onData = onData
  }

  start(sessionId: string, intervalMs: number) {
    this.stop(sessionId)

    const fast = intervalMs
    const normal = Math.round(intervalMs * 2.5)
    const slow = Math.round(intervalMs * 6)

    const initData: MonitorData = {
      hostname: '', kernel: '', arch: '', uptime: '',
      cpu: { usage: -1, cores: [], loadAvg: [0, 0, 0] },
      memory: { total: 0, used: 0, free: 0, buffCache: 0, available: 0, swapTotal: 0, swapUsed: 0 },
      disk: [], processes: [],
      timestamp: Date.now(),
    }
    this.data.set(sessionId, initData)

    const collect = async (keys: (keyof MonitorData)[]) => {
      if (!this.sshManager.hasSession(sessionId)) {
        this.stop(sessionId)
        return
      }
      let running = this.collecting.get(sessionId)
      if (!running) {
        running = new Set()
        this.collecting.set(sessionId, running)
      }
      const keysToCollect = keys.filter(key => !running!.has(key))
      if (keysToCollect.length === 0) return
      for (const key of keysToCollect) running.add(key)

      const current = this.data.get(sessionId)
      if (!current) {
        for (const key of keysToCollect) running.delete(key)
        return
      }
      try {
        for (const collector of COLLECTORS) {
          if (!keysToCollect.includes(collector.key)) continue
          try {
            const partial = await collector.fn(sessionId, this.sshManager)
            if (!this.data.has(sessionId)) return
            Object.assign(current, partial)
          } catch {}
        }
        current.timestamp = Date.now()
        this.onData(sessionId, { ...current })
      } finally {
        for (const key of keysToCollect) running.delete(key)
        if (running.size === 0) this.collecting.delete(sessionId)
      }
    }

    const timers = {
      fast: setInterval(() => collect(['cpu']), fast),
      normal: setInterval(() => collect(['memory', 'processes']), normal),
      slow: setInterval(() => collect(['disk']), slow),
    }
    this.timers.set(sessionId, timers)

    collect(['cpu', 'memory', 'disk', 'processes'])
    if (!this.systemInfoDone.has(sessionId)) {
      this.systemInfoDone.add(sessionId)
      collectSystemInfo(sessionId, this.sshManager).then(info => {
        if (!this.data.has(sessionId)) return
        const current = this.data.get(sessionId)!
        Object.assign(current, info)
        this.onData(sessionId, { ...current })
      })
    }
  }

  stop(sessionId: string) {
    const timers = this.timers.get(sessionId)
    if (timers) {
      clearInterval(timers.fast)
      clearInterval(timers.normal)
      clearInterval(timers.slow)
      this.timers.delete(sessionId)
    }
    this.data.delete(sessionId)
    this.systemInfoDone.delete(sessionId)
    this.collecting.delete(sessionId)
    prevCpuTimes.delete(sessionId)
    coreCpuPrev.delete(sessionId)
  }

  stopAll() {
    for (const sessionId of this.timers.keys()) {
      this.stop(sessionId)
    }
  }
}
