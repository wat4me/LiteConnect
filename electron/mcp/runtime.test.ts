import { describe, expect, it, vi } from 'vitest'
import { SSH_MCP_TOOLS } from '../../shared/mcp/tools'
import { createSshMcpRuntime } from './runtime'
import type { SshMcpSessionPort } from './ports'
import type { SessionSnapshot } from '../ssh/types'
import type { SessionExecResult } from '../ssh/sessionExec'

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000'
const CONNECTION_ID = '660e8400-e29b-41d4-a716-446655440000'

function snapshot(over: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: SESSION_ID,
    connectionId: CONNECTION_ID,
    connectionName: 'web-1',
    generation: 1,
    hasSftp: false,
    ...over,
  }
}

function fakeSsh(over: Partial<SshMcpSessionPort> = {}): SshMcpSessionPort {
  let snap: SessionSnapshot | undefined = snapshot()
  return {
    listSessionSnapshots: () => (snap ? [snap] : []),
    getSessionSnapshot: (id) => (snap && snap.sessionId === id ? snap : undefined),
    getSessionGeneration: () => snap?.generation ?? 0,
    executeSessionExec: vi.fn(async () => ({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      truncated: false,
    } satisfies SessionExecResult)),
    initSftp: vi.fn(async () => {
      if (snap) snap = { ...snap, hasSftp: true }
    }),
    sftpReaddir: vi.fn(async () => [
      {
        name: 'a.txt',
        path: '/var/a.txt',
        isDirectory: false,
        isSymlink: false,
        size: 3,
        modifyTime: 1,
        permissions: '-rw-r--r--',
      },
    ]),
    sftpReadFile: vi.fn(async () => 'file-body'),
    sftpReadFileRange: vi.fn(async () => ({
      buffer: Buffer.from('file-body'),
      size: 9,
      eof: true,
    })),
    sftpWriteFile: vi.fn(async () => {}),
    sftpWriteBuffer: vi.fn(async () => {}),
    sftpDownload: vi.fn(async () => {}),
    sftpUpload: vi.fn(async () => {}),
    sftpStat: vi.fn(async () => ({
      mode: '644',
      size: 9,
      uid: 0,
      gid: 0,
      atime: 1,
      mtime: 2,
    })),
    connectSaved: vi.fn(async () => ({ sessionId: SESSION_ID, reused: true })),
    disconnectSession: vi.fn(),
    openShellChannel: vi.fn(async () => {
      const { PassThrough } = await import('stream')
      const ch = new PassThrough() as PassThrough & { setWindow: (rows: number, cols: number) => void }
      ch.setWindow = vi.fn()
      return ch
    }),
    beginSessionExec: vi.fn(async () => {
      let cancel = () => {}
      const promise = Promise.resolve({
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
        truncated: false,
      } satisfies SessionExecResult)
      return { promise, cancel }
    }),
    ...over,
  }
}

function makeRuntime(over: Partial<SshMcpSessionPort> = {}, extras?: { approvalMode?: 'auto' | 'ask-destructive' | 'deny-destructive'; requestApproval?: (req: any) => Promise<boolean> }) {
  const ssh = fakeSsh(over)
  const runtime = createSshMcpRuntime({
    ssh,
    connections: {
      listPublicConnections: () => [
        {
          id: CONNECTION_ID,
          name: 'web-1',
          host: '10.0.0.8',
          port: 22,
          username: 'deploy',
          group: 'grp-1',
        },
      ],
      listGroups: () => [{ id: 'grp-1', name: 'prod' }],
    },
    metrics: {
      getCached: (id) => (id === SESSION_ID ? { hostname: 'web-1', cpu: { usage: 10 } } : undefined),
    },
    approvalMode: extras?.approvalMode,
    requestApproval: extras?.requestApproval,
  })
  return { runtime, ssh }
}

describe('SshMcpRuntime', () => {
  it('lists the P0 tool catalog', () => {
    const { runtime } = makeRuntime()
    expect(runtime.listTools().map((t) => t.name)).toEqual(SSH_MCP_TOOLS.map((t) => t.name))
  })

  it('lists connections and marks open sessions', async () => {
    const { runtime } = makeRuntime()
    const result = await runtime.call('list_connections', {})
    expect(result.isError).toBe(false)
    const payload = result.structuredContent as { connections: Array<{ id: string; hasOpenSession: boolean; host: string }> }
    expect(payload.connections[0]).toMatchObject({
      id: CONNECTION_ID,
      host: '10.0.0.8',
      hasOpenSession: true,
    })
  })

  it('joins session snapshots with public connection fields', async () => {
    const { runtime } = makeRuntime()
    const result = await runtime.call('list_sessions', {})
    expect(result.isError).toBe(false)
    const payload = result.structuredContent as { sessions: Array<{ sessionId: string; host: string; username: string; healthy: boolean }> }
    expect(payload.sessions[0]).toMatchObject({
      sessionId: SESSION_ID,
      host: '10.0.0.8',
      username: 'deploy',
      healthy: true,
    })
  })

  it('rejects unknown tools and missing sessions', async () => {
    const { runtime } = makeRuntime()
    const unknown = await runtime.call('rm_rf', {})
    expect(unknown.isError).toBe(true)
    expect((unknown.structuredContent as { code: string }).code).toBe('UNKNOWN_TOOL')

    const missing = await runtime.call('exec', {
      sessionId: '770e8400-e29b-41d4-a716-446655440000',
      command: 'ls',
    })
    expect(missing.isError).toBe(true)
    expect((missing.structuredContent as { code: string }).code).toBe('SESSION_NOT_FOUND')
  })

  it('runs a read-only exec and returns exit code', async () => {
    const { runtime, ssh } = makeRuntime({
      executeSessionExec: vi.fn(async () => ({
        stdout: 'Linux',
        stderr: '',
        exitCode: 0,
        truncated: false,
      })),
    })
    const result = await runtime.call('exec', { sessionId: SESSION_ID, command: 'uname -a' })
    expect(result.isError).toBe(false)
    expect(result.structuredContent).toMatchObject({
      exitCode: 0,
      stdout: 'Linux',
      class: 'read-only',
    })
    expect(ssh.executeSessionExec).toHaveBeenCalled()
  })

  it('does not treat a non-zero exit as a tool error', async () => {
    const { runtime } = makeRuntime({
      executeSessionExec: vi.fn(async () => ({
        stdout: '',
        stderr: 'not found',
        exitCode: 2,
        truncated: false,
      })),
    })
    const result = await runtime.call('exec', { sessionId: SESSION_ID, command: 'ls /nope' })
    expect(result.isError).toBe(false)
    expect((result.structuredContent as { exitCode: number }).exitCode).toBe(2)
  })

  it('denies destructive and forbidden exec by default', async () => {
    const { runtime, ssh } = makeRuntime()
    const dest = await runtime.call('exec', { sessionId: SESSION_ID, command: 'rm -rf /tmp/x' })
    expect(dest.isError).toBe(true)
    expect((dest.structuredContent as { code: string }).code).toBe('DESTRUCTIVE_DENIED')

    const forbidden = await runtime.call('exec', { sessionId: SESSION_ID, command: 'rm -rf /' })
    expect(forbidden.isError).toBe(true)
    expect((forbidden.structuredContent as { code: string }).code).toBe('FORBIDDEN')
    expect(ssh.executeSessionExec).not.toHaveBeenCalled()
  })

  it('fails closed when approval is required but no approver is bound', async () => {
    const { runtime, ssh } = makeRuntime({}, { approvalMode: 'ask-destructive' })
    const dest = await runtime.call('exec', { sessionId: SESSION_ID, command: 'rm -rf /tmp/x' })
    expect(dest.isError).toBe(true)
    expect((dest.structuredContent as { code: string }).code).toBe('DESTRUCTIVE_DENIED')
    expect(ssh.executeSessionExec).not.toHaveBeenCalled()
  })

  it('runs a destructive command after approval', async () => {
    const { runtime, ssh } = makeRuntime(
      {
        executeSessionExec: vi.fn(async () => ({
          stdout: '',
          stderr: '',
          exitCode: 0,
          truncated: false,
        })),
      },
      { approvalMode: 'ask-destructive', requestApproval: async () => true },
    )
    const dest = await runtime.call('exec', { sessionId: SESSION_ID, command: 'rm -rf /tmp/x' })
    expect(dest.isError).toBe(false)
    expect(ssh.executeSessionExec).toHaveBeenCalled()
  })

  it('maps generation changes to SESSION_STALE', async () => {
    const { runtime } = makeRuntime({
      executeSessionExec: vi.fn(async () => {
        throw new Error('SSH session generation changed')
      }),
    })
    const result = await runtime.call('exec', { sessionId: SESSION_ID, command: 'ls' })
    expect(result.isError).toBe(true)
    expect((result.structuredContent as { code: string }).code).toBe('SESSION_STALE')
  })

  it('reads / lists / stats over SFTP after init', async () => {
    const { runtime, ssh } = makeRuntime()
    const file = await runtime.call('read_file', { sessionId: SESSION_ID, path: '/etc/os-release' })
    expect(file.isError).toBe(false)
    expect(file.structuredContent).toMatchObject({
      path: '/etc/os-release',
      content: 'file-body',
      eof: true,
      size: 9,
    })

    const dir = await runtime.call('list_dir', { sessionId: SESSION_ID, path: '/var' })
    expect(dir.isError).toBe(false)
    expect((dir.structuredContent as { total: number }).total).toBe(1)

    const stat = await runtime.call('stat_path', { sessionId: SESSION_ID, path: '/etc/os-release' })
    expect(stat.isError).toBe(false)
    expect((stat.structuredContent as { mode: string }).mode).toBe('644')
    expect(ssh.initSftp).toHaveBeenCalled()
  })

  it('rejects parent-directory paths', async () => {
    const { runtime } = makeRuntime()
    const result = await runtime.call('read_file', { sessionId: SESSION_ID, path: '/var/../etc/shadow' })
    expect(result.isError).toBe(true)
    expect((result.structuredContent as { code: string }).code).toBe('INVALID_PATH')
  })

  it('returns cached metrics or MONITOR_NOT_STARTED', async () => {
    const { runtime } = makeRuntime()
    const hit = await runtime.call('get_metrics', { sessionId: SESSION_ID })
    expect(hit.isError).toBe(false)
    expect(hit.structuredContent).toMatchObject({
      sessionId: SESSION_ID,
      metrics: { hostname: 'web-1' },
    })

    const empty = createSshMcpRuntime({
      ssh: fakeSsh(),
      connections: { listPublicConnections: () => [], listGroups: () => [] },
    })
    const miss = await empty.call('get_metrics', { sessionId: SESSION_ID })
    expect(miss.isError).toBe(true)
    expect((miss.structuredContent as { code: string }).code).toBe('MONITOR_NOT_STARTED')
  })

  it('connects a saved host by id or exact name', async () => {
    const { runtime, ssh } = makeRuntime()
    const byId = await runtime.call('connect', { connectionId: CONNECTION_ID })
    expect(byId.isError).toBe(false)
    expect(byId.structuredContent).toMatchObject({
      sessionId: SESSION_ID,
      connectionId: CONNECTION_ID,
      reused: true,
      host: '10.0.0.8',
    })

    const byName = await runtime.call('connect', { name: 'web-1' })
    expect(byName.isError).toBe(false)
    expect(ssh.connectSaved).toHaveBeenCalled()
  })

  it('rejects unknown or missing connect targets', async () => {
    const { runtime } = makeRuntime()
    const missing = await runtime.call('connect', { name: 'no-such-host' })
    expect(missing.isError).toBe(true)
    expect((missing.structuredContent as { code: string }).code).toBe('CONNECTION_NOT_FOUND')

    const empty = await runtime.call('connect', {})
    expect(empty.isError).toBe(true)
    expect((empty.structuredContent as { code: string }).code).toBe('CONNECTION_NOT_FOUND')
  })

  it('disconnects a session and reports missing ids', async () => {
    const { runtime, ssh } = makeRuntime()
    const closed = await runtime.call('disconnect', { sessionId: SESSION_ID })
    expect(closed.isError).toBe(false)
    expect(closed.structuredContent).toMatchObject({ closed: [SESSION_ID], count: 1 })
    expect(ssh.disconnectSession).toHaveBeenCalledWith(SESSION_ID)

    const missing = await runtime.call('disconnect', {
      sessionId: '770e8400-e29b-41d4-a716-446655440000',
    })
    expect(missing.isError).toBe(false)
    expect((missing.structuredContent as { missing: string[] }).missing).toHaveLength(1)
  })

  it('writes a remote file over SFTP', async () => {
    const { runtime, ssh } = makeRuntime()
    const result = await runtime.call('write_file', {
      sessionId: SESSION_ID,
      path: '/tmp/app.conf',
      content: 'listen 80',
    })
    expect(result.isError).toBe(false)
    expect(ssh.sftpWriteBuffer).toHaveBeenCalled()
    expect(result.structuredContent).toMatchObject({ path: '/tmp/app.conf', bytes: 9 })
  })

  it('pages a large file with offset/length instead of rejecting it', async () => {
    const { runtime, ssh } = makeRuntime({
      sftpReadFileRange: vi.fn(async (_id, _path, offset, length) => ({
        buffer: Buffer.from('ABCD'.slice(offset, offset + length)),
        size: 4,
        eof: offset + length >= 4,
      })),
    })
    const first = await runtime.call('read_file', { sessionId: SESSION_ID, path: '/var/log/app.log', offset: 0, length: 2 })
    expect(first.isError).toBe(false)
    expect(first.structuredContent).toMatchObject({ content: 'AB', eof: false, nextOffset: 2, size: 4 })
    const rest = await runtime.call('read_file', { sessionId: SESSION_ID, path: '/var/log/app.log', offset: 2, length: 2 })
    expect(rest.structuredContent).toMatchObject({ content: 'CD', eof: true })
    expect(ssh.sftpReadFileRange).toHaveBeenCalled()
  })

  it('starts a background job and returns it from get_job', async () => {
    let resolveExec: (value: SessionExecResult) => void = () => {}
    const { runtime } = makeRuntime({
      beginSessionExec: vi.fn(async () => ({
        promise: new Promise<SessionExecResult>((resolve) => {
          resolveExec = resolve
        }),
        cancel: vi.fn(),
      })),
    })
    const started = await runtime.call('exec', {
      sessionId: SESSION_ID,
      command: 'uname -a',
      background: true,
    })
    expect(started.isError).toBe(false)
    const jobId = (started.structuredContent as { jobId: string }).jobId
    expect(jobId).toBeTruthy()

    const listed = await runtime.call('list_jobs', {})
    expect((listed.structuredContent as { jobs: Array<{ status: string }> }).jobs[0].status).toBe('running')

    resolveExec({ stdout: 'Linux', stderr: '', exitCode: 0, truncated: false })
    let got = await runtime.call('get_job', { jobId })
    for (let i = 0; i < 20 && (got.structuredContent as { status: string }).status === 'running'; i++) {
      await new Promise((r) => setImmediate(r))
      got = await runtime.call('get_job', { jobId })
    }
    expect(got.structuredContent).toMatchObject({ status: 'completed', stdout: 'Linux' })
  })

  it('fans out exec across a group of open sessions', async () => {
    const { runtime, ssh } = makeRuntime()
    const result = await runtime.call('exec', { group: 'prod', command: 'uname' })
    expect(result.isError).toBe(false)
    expect(ssh.executeSessionExec).toHaveBeenCalled()
    expect(result.structuredContent).toMatchObject({ stdout: 'ok', class: 'read-only' })
  })

  it('tails a remote file from the end', async () => {
    const { runtime } = makeRuntime({
      sftpStat: vi.fn(async () => ({ mode: '644', size: 11, uid: 0, gid: 0, atime: 1, mtime: 2 })),
      sftpReadFileRange: vi.fn(async () => ({
        buffer: Buffer.from('a\nb\nc\n'),
        size: 11,
        eof: true,
      })),
    })
    const result = await runtime.call('tail_file', { sessionId: SESSION_ID, path: '/var/log/app.log', lines: 2 })
    expect(result.isError).toBe(false)
    expect(result.structuredContent).toMatchObject({ lines: ['b', 'c'], lineCount: 2 })
  })

  it('allows service status and denies restart by default', async () => {
    const { runtime, ssh } = makeRuntime()
    const status = await runtime.call('service_control', {
      sessionId: SESSION_ID,
      unit: 'nginx.service',
      action: 'status',
    })
    expect(status.isError).toBe(false)
    expect(ssh.executeSessionExec).toHaveBeenCalled()

    const restart = await runtime.call('service_control', {
      sessionId: SESSION_ID,
      unit: 'nginx.service',
      action: 'restart',
    })
    expect(restart.isError).toBe(true)
    expect((restart.structuredContent as { code: string }).code).toBe('DESTRUCTIVE_DENIED')
  })

  it('opens an agent PTY, reads the screen, and closes it', async () => {
    let channel: { write: (d: string) => boolean; setWindow?: unknown } | null = null
    const { runtime } = makeRuntime({
      openShellChannel: vi.fn(async () => {
        const { PassThrough } = await import('stream')
        const ch = new PassThrough() as PassThrough & { setWindow: () => void }
        ch.setWindow = vi.fn()
        channel = ch
        return ch
      }),
    })
    const opened = await runtime.call('pty_open', { sessionId: SESSION_ID, cols: 80, rows: 24 })
    expect(opened.isError).toBe(false)
    const ptyId = (opened.structuredContent as { ptyId: string }).ptyId
    channel!.write('Install now? [Y/n]\r\n')
    await new Promise((r) => setTimeout(r, 40))
    const screen = await runtime.call('pty_read', { ptyId, mode: 'screen' })
    expect(screen.isError).toBe(false)
    expect((screen.structuredContent as { output: string }).output).toMatch(/Install now/i)
    const closed = await runtime.call('pty_close', { ptyId })
    expect(closed.isError).toBe(false)
  })
})
