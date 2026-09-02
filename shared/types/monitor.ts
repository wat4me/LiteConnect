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
