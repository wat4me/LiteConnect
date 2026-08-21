import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => 'D:\\tmp\\LiteConnect-test-userdata',
  },
}))

vi.mock('../i18n', () => ({
  t: (key: string) => key,
}))

vi.mock('./x11/x11Server', () => ({
  ensureX11ServerReady: vi.fn(async () => ({ ready: false, message: 'skip' })),
}))

import { SSHManager } from './manager'

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000'

describe('SSHManager MCP session helpers', () => {
  let manager: SSHManager

  beforeEach(() => {
    manager = new SSHManager({
      init: vi.fn(async () => {}),
    } as any)
  })

  it('lists snapshots without exposing the sessions map', () => {
    const gen = (manager as any).bumpSessionEpoch(SESSION_ID)
    ;(manager as any).sessions.set(SESSION_ID, {
      id: SESSION_ID,
      client: {},
      stream: { writable: true },
      connectionId: 'conn-1',
      connectionName: 'web-1',
      sftp: {},
    })
    const listed = manager.listSessionSnapshots()
    expect(listed).toEqual([
      {
        sessionId: SESSION_ID,
        connectionId: 'conn-1',
        connectionName: 'web-1',
        generation: gen,
        hasSftp: true,
      },
    ])
    expect(manager.getSessionSnapshot(SESSION_ID)?.generation).toBe(gen)
    expect(manager.getSessionSnapshot('missing')).toBeUndefined()
  })

  it('executeSessionExec returns split streams and exit code', async () => {
    const gen = (manager as any).bumpSessionEpoch(SESSION_ID)
    const stream = new PassThrough() as PassThrough & { stderr: PassThrough }
    stream.stderr = new PassThrough()
    ;(manager as any).sessions.set(SESSION_ID, {
      id: SESSION_ID,
      client: {
        exec: (_cmd: string, _opts: unknown, cb: (err: Error | null, ch?: any) => void) => {
          cb(null, stream)
          queueMicrotask(() => {
            stream.write('out')
            stream.stderr.write('err')
            stream.emit('exit', 7)
            stream.end()
            stream.emit('close', 7)
          })
        },
      },
      stream: { writable: true },
      connectionId: 'c',
      connectionName: 'n',
    })

    const result = await manager.executeSessionExec(SESSION_ID, 'uname', gen, 1000)
    expect(result).toMatchObject({ stdout: 'out', stderr: 'err', exitCode: 7, truncated: false })
  })

  it('executeSessionExec rejects when generation changes after the command', async () => {
    const gen = (manager as any).bumpSessionEpoch(SESSION_ID)
    const stream = new PassThrough() as PassThrough & { stderr: PassThrough }
    stream.stderr = new PassThrough()
    ;(manager as any).sessions.set(SESSION_ID, {
      id: SESSION_ID,
      client: {
        exec: (_cmd: string, _opts: unknown, cb: (err: Error | null, ch?: any) => void) => {
          cb(null, stream)
          queueMicrotask(() => {
            ;(manager as any).bumpSessionEpoch(SESSION_ID)
            stream.write('late')
            stream.emit('exit', 0)
            stream.end()
            stream.emit('close', 0)
          })
        },
      },
      stream: { writable: true },
      connectionId: 'c',
      connectionName: 'n',
    })

    await expect(manager.executeSessionExec(SESSION_ID, 'uname', gen, 1000)).rejects.toThrow(
      /generation changed/,
    )
  })
})
