import { afterEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel)
    },
  },
}))

import { registerDockerHandlers, unregisterDockerHandlers } from './registerDockerHandlers'
import type { DockerService } from '../docker/service'
import type { DockerAvailability, DockerContainerSummary } from '../docker/types'
import { DockerTransportError } from '../docker/types'

const VALID_SID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

function getHandler(channel: string) {
  const h = handlers.get(channel)
  if (!h) throw new Error(`missing handler ${channel}`)
  return h
}

afterEach(() => {
  unregisterDockerHandlers()
  handlers.clear()
})

describe('registerDockerHandlers', () => {
  it('registers docker:probe and validates sessionId', async () => {
    const probe = vi.fn(async (): Promise<DockerAvailability> => ({
      status: 'available',
      engineVersion: '24.0.7',
      apiVersion: '1.43',
    }))
    const dockerService = { probe } as unknown as DockerService
    registerDockerHandlers(dockerService)

    const handler = getHandler('docker:probe')
    await expect(handler({}, 'not-a-uuid')).rejects.toThrow('Invalid session id')
    expect(probe).not.toHaveBeenCalled()

    const result = await handler({}, VALID_SID)
    expect(probe).toHaveBeenCalledWith(VALID_SID)
    expect(result).toEqual({
      status: 'available',
      engineVersion: '24.0.7',
      apiVersion: '1.43',
    })
  })

  it('does not accept extra path/socket arguments as part of API', async () => {
    const probe = vi.fn(async (): Promise<DockerAvailability> => ({ status: 'not-installed' }))
    registerDockerHandlers({ probe } as unknown as DockerService)
    const handler = getHandler('docker:probe')
    await handler({}, VALID_SID, '/var/run/docker.sock', '/v1.43/containers/json')
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith(VALID_SID)
  })

  it('list-containers validates sessionId and calls whitelist method only', async () => {
    const listContainers = vi.fn(async (): Promise<DockerContainerSummary[]> => [])
    const inspectContainer = vi.fn()
    registerDockerHandlers({
      probe: async () => ({ status: 'ssh-disconnected' }),
      listContainers,
      inspectContainer,
    } as unknown as DockerService)

    const handler = getHandler('docker:list-containers')
    await expect(handler({}, 'bad')).rejects.toThrow('Invalid session id')
    expect(listContainers).not.toHaveBeenCalled()

    await handler({}, VALID_SID, { state: 'running' }, '/evil')
    expect(listContainers).toHaveBeenCalledTimes(1)
    expect(listContainers).toHaveBeenCalledWith(VALID_SID)
    expect(inspectContainer).not.toHaveBeenCalled()
  })

  it('inspect-container validates sessionId and containerId', async () => {
    const inspectContainer = vi.fn(async () => ({
      overview: {
        id: 'x',
        name: '/x',
        displayName: 'x',
        image: 'i',
        imageId: '',
        created: '',
        path: '',
        args: [],
        state: {
          status: 'running',
          running: true,
          paused: false,
          restarting: false,
          startedAt: '',
          finishedAt: '',
          exitCode: 0,
          error: '',
        },
        ports: [],
        mounts: [],
        networks: [],
        restartPolicy: 'no',
      },
      inspectJson: '{}',
    }))
    registerDockerHandlers({
      probe: async () => ({ status: 'available', engineVersion: '1', apiVersion: '1' }),
      listContainers: async () => [],
      inspectContainer,
    } as unknown as DockerService)

    const handler = getHandler('docker:inspect-container')
    await expect(handler({}, 'bad', 'abc')).rejects.toThrow('Invalid session id')
    await expect(handler({}, VALID_SID, '../etc')).rejects.toThrow('Invalid container id')
    await expect(handler({}, VALID_SID, 'a/b')).rejects.toThrow('Invalid container id')
    await expect(handler({}, VALID_SID, '')).rejects.toThrow('Invalid container id')
    expect(inspectContainer).not.toHaveBeenCalled()

    await handler({}, VALID_SID, 'my-container')
    expect(inspectContainer).toHaveBeenCalledWith(VALID_SID, 'my-container')
  })

  it('container-action validates sessionId, containerId, action', async () => {
    const containerAction = vi.fn(async () => ({
      action: 'start' as const,
      containerId: 'c1',
      outcome: 'completed' as const,
    }))
    registerDockerHandlers({
      probe: async () => ({ status: 'ssh-disconnected' }),
      listContainers: async () => [],
      inspectContainer: async () => {
        throw new Error('no')
      },
      containerAction,
    } as unknown as DockerService)

    const handler = getHandler('docker:container-action')
    await expect(handler({}, 'bad', 'c1', 'start')).rejects.toThrow('Invalid session id')
    await expect(handler({}, VALID_SID, '../x', 'start')).rejects.toThrow('Invalid container id')
    await expect(handler({}, VALID_SID, 'c1', 'kill')).rejects.toThrow('Invalid container action')
    await expect(handler({}, VALID_SID, 'c1', 'delete')).rejects.toThrow('Invalid container action')
    expect(containerAction).not.toHaveBeenCalled()

    const ok = await handler({}, VALID_SID, 'c1', 'start')
    expect(ok).toEqual({
      ok: true,
      result: { action: 'start', containerId: 'c1', outcome: 'completed' },
    })
    expect(containerAction).toHaveBeenCalledWith(VALID_SID, 'c1', 'start')
  })

  it('container-action ignores extra path/method/timeout args', async () => {
    const containerAction = vi.fn(async () => ({
      action: 'stop' as const,
      containerId: 'c1',
      outcome: 'completed' as const,
    }))
    registerDockerHandlers({
      probe: async () => ({ status: 'ssh-disconnected' }),
      listContainers: async () => [],
      inspectContainer: async () => {
        throw new Error('no')
      },
      containerAction,
    } as unknown as DockerService)

    const handler = getHandler('docker:container-action')
    await handler(
      {},
      VALID_SID,
      'c1',
      'stop',
      { method: 'DELETE', path: '/containers/c1', timeoutMs: 1 },
      '/evil',
    )
    expect(containerAction).toHaveBeenCalledTimes(1)
    expect(containerAction).toHaveBeenCalledWith(VALID_SID, 'c1', 'stop')
  })

  it('container-action maps service errors to stable code response', async () => {
    const containerAction = vi.fn(async () => {
      throw new DockerTransportError('action-conflict', 'conflict', VALID_SID)
    })
    registerDockerHandlers({
      probe: async () => ({ status: 'ssh-disconnected' }),
      listContainers: async () => [],
      inspectContainer: async () => {
        throw new Error('no')
      },
      containerAction,
    } as unknown as DockerService)

    const handler = getHandler('docker:container-action')
    const res = await handler({}, VALID_SID, 'c1', 'restart')
    expect(res).toEqual({ ok: false, code: 'action-conflict' })
  })

  it('unregister removes all handlers including action', () => {
    registerDockerHandlers({
      probe: async () => ({ status: 'ssh-disconnected' }),
      listContainers: async () => [],
      inspectContainer: async () => {
        throw new Error('no')
      },
      containerAction: async () => ({
        action: 'start',
        containerId: 'x',
        outcome: 'completed',
      }),
    } as unknown as DockerService)
    expect(handlers.has('docker:probe')).toBe(true)
    expect(handlers.has('docker:list-containers')).toBe(true)
    expect(handlers.has('docker:inspect-container')).toBe(true)
    expect(handlers.has('docker:container-action')).toBe(true)
    expect(handlers.has('docker:start-container-logs')).toBe(true)
    expect(handlers.has('docker:stop-container-logs')).toBe(true)
    expect(handlers.has('docker:start-container-exec')).toBe(true)
    expect(handlers.has('docker:write-container-exec')).toBe(true)
    expect(handlers.has('docker:resize-container-exec')).toBe(true)
    expect(handlers.has('docker:stop-container-exec')).toBe(true)

    unregisterDockerHandlers()
    expect(handlers.has('docker:probe')).toBe(false)
    expect(handlers.has('docker:list-containers')).toBe(false)
    expect(handlers.has('docker:inspect-container')).toBe(false)
    expect(handlers.has('docker:container-action')).toBe(false)
    expect(handlers.has('docker:start-container-logs')).toBe(false)
    expect(handlers.has('docker:stop-container-logs')).toBe(false)
    expect(handlers.has('docker:start-container-exec')).toBe(false)
    expect(handlers.has('docker:write-container-exec')).toBe(false)
    expect(handlers.has('docker:resize-container-exec')).toBe(false)
    expect(handlers.has('docker:stop-container-exec')).toBe(false)
  })

  it('validates start/stop log IPC inputs', async () => {
    const startContainerLogs = vi.fn(async () => 'ab'.repeat(16))
    const stopContainerLogs = vi.fn(() => true)
    registerDockerHandlers({
      startContainerLogs,
      stopContainerLogs,
    } as unknown as DockerService)

    const start = getHandler('docker:start-container-logs')
    const sender = { id: 1 }
    const rid = 'c'.repeat(32)
    await expect(
      start({ sender }, 'bad', 'c1', { tail: 200, follow: true, requestId: rid }),
    ).rejects.toThrow('Invalid session id')
    await expect(
      start({ sender }, VALID_SID, '../x', { tail: 200, follow: true, requestId: rid }),
    ).rejects.toThrow('Invalid container id')
    await expect(
      start({ sender }, VALID_SID, 'c1', { tail: 50, follow: true, requestId: rid }),
    ).rejects.toThrow('Invalid log options')
    await expect(
      start({ sender }, VALID_SID, 'c1', { tail: 200, follow: 1, requestId: rid }),
    ).rejects.toThrow('Invalid log options')
    await expect(
      start({ sender }, VALID_SID, 'c1', { tail: 200, follow: true, requestId: 'short' }),
    ).rejects.toThrow('Invalid log options')

    const ok = await start(
      { sender },
      VALID_SID,
      'c1',
      { tail: 200, follow: true, requestId: rid },
    )
    expect(ok).toEqual({ ok: true, streamId: 'ab'.repeat(16), requestId: rid })
    expect(startContainerLogs).toHaveBeenCalled()

    const stop = getHandler('docker:stop-container-logs')
    await expect(stop({ sender }, 'short')).rejects.toThrow('Invalid stream id')
    stopContainerLogs.mockReturnValueOnce(false)
    await expect(stop({ sender }, 'a'.repeat(32))).rejects.toThrow('Invalid stream owner')
    stopContainerLogs.mockReturnValue(true)
    await expect(stop({ sender }, 'a'.repeat(32))).resolves.toEqual({ ok: true })
  })

  it('register is idempotent', () => {
    const svc = {
      probe: async () => ({ status: 'ssh-disconnected' as const }),
      listContainers: async () => [],
      inspectContainer: async () => {
        throw new Error('no')
      },
      containerAction: async () => ({
        action: 'start' as const,
        containerId: 'x',
        outcome: 'completed' as const,
      }),
    } as unknown as DockerService
    registerDockerHandlers(svc)
    registerDockerHandlers(svc)
    expect(handlers.has('docker:container-action')).toBe(true)
  })

  it('validates exec IPC: shell enum, size, requestId, write limit, owner', async () => {
    const startContainerExec = vi.fn(async () => 'ab'.repeat(16))
    const writeContainerExec = vi.fn(() => true)
    const resizeContainerExec = vi.fn(async () => true)
    const stopContainerExec = vi.fn(() => true)
    registerDockerHandlers({
      startContainerExec,
      writeContainerExec,
      resizeContainerExec,
      stopContainerExec,
    } as unknown as DockerService)

    const start = getHandler('docker:start-container-exec')
    const sender = { id: 1 }
    const rid = 'c'.repeat(32)
    await expect(
      start({ sender }, 'bad', 'c1', { shell: 'bash', requestId: rid, cols: 80, rows: 24 }),
    ).rejects.toThrow('Invalid session id')
    await expect(
      start({ sender }, VALID_SID, '../x', {
        shell: 'bash',
        requestId: rid,
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow('Invalid container id')
    await expect(
      start({ sender }, VALID_SID, 'c1', {
        shell: 'zsh',
        requestId: rid,
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow('Invalid exec options')
    await expect(
      start({ sender }, VALID_SID, 'c1', {
        shell: 'bash',
        requestId: 'short',
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow('Invalid exec options')
    await expect(
      start({ sender }, VALID_SID, 'c1', {
        shell: 'bash',
        requestId: rid,
        cols: 0,
        rows: 24,
      }),
    ).rejects.toThrow('Invalid exec options')

    const ok = await start(
      { sender },
      VALID_SID,
      'c1',
      { shell: 'bash', requestId: rid, cols: 80, rows: 24 },
    )
    expect(ok).toEqual({ ok: true, terminalId: 'ab'.repeat(16), requestId: rid })
    expect(startContainerExec).toHaveBeenCalled()

    const write = getHandler('docker:write-container-exec')
    await expect(write({ sender }, 'short', 'x')).rejects.toThrow('Invalid terminal id')
    await expect(write({ sender }, 'a'.repeat(32), 123)).rejects.toThrow('Invalid write payload')
    await expect(write({ sender }, 'a'.repeat(32), 'x'.repeat(64 * 1024 + 1))).rejects.toThrow(
      'Write payload too large',
    )
    await expect(write({ sender }, 'a'.repeat(32), 'hi')).resolves.toEqual({ ok: true })

    const resize = getHandler('docker:resize-container-exec')
    await expect(resize({ sender }, 'a'.repeat(32), 0, 24)).rejects.toThrow('Invalid exec size')
    await expect(resize({ sender }, 'a'.repeat(32), 80, 24)).resolves.toEqual({ ok: true })

    const stop = getHandler('docker:stop-container-exec')
    stopContainerExec.mockReturnValueOnce(false)
    await expect(stop({ sender }, 'a'.repeat(32))).rejects.toThrow('Invalid terminal owner')
    stopContainerExec.mockReturnValue(true)
    await expect(stop({ sender }, 'a'.repeat(32))).resolves.toEqual({ ok: true })
  })
})
