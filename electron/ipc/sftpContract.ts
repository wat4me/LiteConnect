import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { SftpEventArgs, SftpInvokeContract, SftpSendContract } from '../../shared/ipc/sftp'
import { safeWebContentsSend } from '../utils/validation'

// Runtime validation stays in each handler: TypeScript cannot validate an IPC sender.
export function handleSftp<K extends keyof SftpInvokeContract>(
  channel: K,
  handler: (event: IpcMainInvokeEvent, ...args: Parameters<SftpInvokeContract[NoInfer<K>]>) => ReturnType<SftpInvokeContract[NoInfer<K>]>,
): void {
  ipcMain.handle(channel, handler)
}

export function onSftp<K extends keyof SftpSendContract>(
  channel: K,
  handler: (event: IpcMainEvent, ...args: Parameters<SftpSendContract[NoInfer<K>]>) => void | Promise<void>,
): void {
  ipcMain.on(channel, handler)
}

export function sendSftpEvent<K extends keyof SftpEventArgs>(
  sender: WebContents, channel: K, ...args: SftpEventArgs[NoInfer<K>]
): void {
  safeWebContentsSend(sender, channel, ...args)
}
