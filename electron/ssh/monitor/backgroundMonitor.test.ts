import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackgroundMonitor } from './backgroundMonitor'

const validSample = {
  cpu: { usage: 12, cores: [], loadAvg: [0, 0, 0] },
  memory: { total: 1024, used: 512, free: 512, buffCache: 0, available: 512, swapTotal: 0, swapUsed: 0 },
} as Parameters<BackgroundMonitor['onSample']>[1]

function harness(connect: (connection: unknown) => Promise<string> = async () => 'background-1') {
  const sessions = new Set<string>()
  const rule = { enabled: true, backgroundEnabled: true, cpuThreshold: 90, memoryThreshold: 90, maxNotificationsPer24h: 3 }
  const alerts = {
    getBackgroundConnectionIds: () => ['host'],
    getRule: () => rule,
    hasSession: (_id: string, except?: string) => [...sessions].some(id => id !== except),
    attach: (_id: string, sessionId: string) => { sessions.add(sessionId) },
    detach: (sessionId: string) => { sessions.delete(sessionId) },
  }
  const credentials = {
    getConnection: () => ({ id: 'host' }),
    getConnectionForAuth: () => ({ id: 'host', name: 'web', host: 'example.test', port: 22, username: 'user', password: 'secret', x11Forwarding: true }),
  }
  let monitor: BackgroundMonitor
  const ssh = {
    connect: vi.fn(connect),
    hasSession: vi.fn(() => true),
    disconnect: vi.fn((sessionId: string) => {
      alerts.detach(sessionId)
      monitor.sessionTeardown(sessionId)
    }),
  }
  monitor = new BackgroundMonitor(ssh as never, credentials as never, alerts as never)
  return { monitor, ssh, rule, alerts, sessions }
}

afterEach(() => vi.useRealTimers())

describe('BackgroundMonitor', () => {
  it('starts without a terminal, yields to a foreground session, and resumes afterward', async () => {
    let count = 0
    const { monitor, ssh, alerts } = harness(async (connection: any) => {
      expect(connection.x11Forwarding).toBe(false)
      expect(connection.localForwards).toEqual([])
      return `background-${++count}`
    })
    monitor.start()
    await vi.waitFor(() => expect(monitor.getStatus('host').state).toBe('sampling'))
    monitor.onSample('host', validSample, ['cpu'])
    expect(monitor.getStatus('host').state).toBe('monitoring')
    alerts.attach('host', 'terminal')
    monitor.foregroundAttached('host')
    expect(ssh.disconnect).toHaveBeenCalledWith('background-1')
    expect(monitor.getStatus('host').state).toBe('using-terminal')
    alerts.detach('terminal')
    monitor.sessionTeardown('terminal')
    await vi.waitFor(() => expect(monitor.getStatus('host').state).toBe('sampling'))
    expect(ssh.connect).toHaveBeenCalledTimes(2)
    monitor.stop()
  })

  it('retries transient failures and pauses on authentication failures', async () => {
    vi.useFakeTimers()
    const connect = vi.fn()
      .mockRejectedValueOnce(new Error('Connection closed'))
      .mockResolvedValueOnce('background-2')
    const { monitor } = harness(connect)
    monitor.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(monitor.getStatus('host').state).toBe('retrying')
    await vi.advanceTimersByTimeAsync(5000)
    expect(monitor.getStatus('host').state).toBe('sampling')
    monitor.stop()

    const blocked = harness(async () => { throw new Error('All configured authentication methods failed') })
    blocked.monitor.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(blocked.monitor.getStatus('host').state).toBe('needs-attention')
    expect(vi.getTimerCount()).toBe(0)
    blocked.monitor.sessionTeardown('unrelated-terminal')
    expect(blocked.ssh.connect).toHaveBeenCalledTimes(1)
    blocked.monitor.stop()
  })

  it('drops a late connection after background monitoring is disabled', async () => {
    let resolve!: (sessionId: string) => void
    const { monitor, ssh, rule } = harness(() => new Promise<string>(done => { resolve = done }))
    monitor.start()
    rule.backgroundEnabled = false
    monitor.refresh('host')
    resolve('late-session')
    await vi.waitFor(() => expect(ssh.disconnect).toHaveBeenCalledWith('late-session'))
    expect(monitor.getStatus('host').state).toBe('terminal-only')
    monitor.stop()
  })

  it('does not claim to monitor a session that closed during connection setup', async () => {
    const { monitor, ssh } = harness()
    ssh.hasSession.mockReturnValue(false)
    monitor.start()
    await vi.waitFor(() => expect(monitor.getStatus('host').state).toBe('retrying'))
    monitor.stop()
  })

  it('shows unavailable when no valid sample arrives and retries the active session', async () => {
    vi.useFakeTimers()
    let count = 0
    const { monitor, ssh } = harness(async () => `background-${++count}`)
    monitor.start()
    await Promise.resolve()
    expect(monitor.getStatus('host').state).toBe('sampling')
    monitor.onSample('host', { ...validSample, cpu: { ...validSample.cpu, usage: -1 }, memory: { ...validSample.memory, total: 0 } }, ['cpu', 'memory'])
    expect(monitor.getStatus('host').state).toBe('sampling')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(monitor.getStatus('host').state).toBe('unavailable')
    monitor.connectionChanged('host')
    await Promise.resolve()
    expect(ssh.disconnect).toHaveBeenCalledWith('background-1')
    expect(ssh.connect).toHaveBeenCalledTimes(2)
    expect(monitor.getStatus('host').state).toBe('sampling')
    monitor.onSample('host', validSample, ['memory'])
    expect(monitor.getStatus('host').state).toBe('monitoring')
    monitor.stop()
  })

  it('closes a connected SSH session if collector setup fails', async () => {
    const { monitor, ssh, alerts } = harness()
    vi.spyOn(alerts, 'attach').mockImplementationOnce(() => { throw new Error('collector failed') })
    monitor.start()
    await vi.waitFor(() => expect(monitor.getStatus('host').state).toBe('retrying'))
    expect(ssh.disconnect).toHaveBeenCalledWith('background-1')
    monitor.stop()
  })
})
