import { ipcMain } from 'electron'
import {
  isValidUUID,
  isValidExecCommand,
  clampExecTimeoutMs,
} from '../utils/validation'
import { SSHManager } from '../ssh/manager'
import { execFailureMessage } from '../ssh/sftp/sftpSession'

export function registerExecHandlers(sshManager: SSHManager): void {
  ipcMain.handle('ssh:exec', async (_event, sessionId: string, command: string, timeoutMs?: number) => {
    if (!isValidUUID(sessionId)) {
      throw new Error('Invalid session id')
    }
    if (!isValidExecCommand(command)) {
      throw new Error('Invalid command')
    }
    const timeout = clampExecTimeoutMs(timeoutMs)
    const out = await sshManager.execRaw(sessionId, command, timeout)
    // Batch commands show everything the remote printed, warnings included.
    const combined = [out.stdout, out.stderr].map((s) => s.trim()).filter(Boolean).join('\n')
    if (out.signal || (out.code !== null && out.code !== 0)) {
      throw new Error(combined || execFailureMessage(out))
    }
    return combined
  })
}
