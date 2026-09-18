import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: any[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => unknown) => handlers.set(channel, fn),
  },
}))

import { registerExecHandlers } from './registerExecHandlers'
import type { SSHManager } from '../ssh/manager'

const SID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

function managerWith(output: { code: number | null; signal: string | null; stdout: string; stderr: string }) {
  return { execRaw: vi.fn(async () => output) } as unknown as SSHManager
}

describe('ssh:exec handler', () => {
  beforeEach(() => handlers.clear())

  it('returns stdout and stderr together so batch commands keep their warnings', async () => {
    registerExecHandlers(managerWith({ code: 0, signal: null, stdout: 'ok\n', stderr: 'WARNING: apt CLI\n' }))

    await expect(handlers.get('ssh:exec')!({}, SID, 'apt list')).resolves.toBe('ok\nWARNING: apt CLI')
  })

  it('rejects a non-zero exit with everything that was printed', async () => {
    registerExecHandlers(managerWith({ code: 2, signal: null, stdout: 'step 1 done', stderr: 'step 2 failed' }))

    await expect(handlers.get('ssh:exec')!({}, SID, './deploy.sh')).rejects.toThrow('step 1 done\nstep 2 failed')
  })

  it('falls back to the exit status when the command printed nothing', async () => {
    registerExecHandlers(managerWith({ code: 3, signal: null, stdout: '', stderr: '' }))

    await expect(handlers.get('ssh:exec')!({}, SID, 'false')).rejects.toThrow('exited with code 3')
  })

  it('still validates its arguments', async () => {
    registerExecHandlers(managerWith({ code: 0, signal: null, stdout: '', stderr: '' }))

    await expect(handlers.get('ssh:exec')!({}, 'nope', 'ls')).rejects.toThrow('Invalid session id')
    await expect(handlers.get('ssh:exec')!({}, SID, '')).rejects.toThrow('Invalid command')
  })
})
