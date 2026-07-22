import { ipcMain } from 'electron'
import {
  isValidUUID,
  isValidExecCommand,
  clampExecTimeoutMs,
} from '../utils/validation'
import { SSHManager } from '../ssh/manager'

export function registerExecHandlers(sshManager: SSHManager): void {
  ipcMain.handle('ssh:exec', async (_event, sessionId: string, command: string, timeoutMs?: number) => {
    if (!isValidUUID(sessionId)) {
      throw new Error('Invalid session id')
    }
    if (!isValidExecCommand(command)) {
      throw new Error('Invalid command')
    }
    const timeout = clampExecTimeoutMs(timeoutMs)
    return await sshManager.sftpExec(sessionId, command, timeout)
  })
}
