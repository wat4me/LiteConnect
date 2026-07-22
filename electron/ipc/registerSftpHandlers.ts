import { ipcMain, nativeImage } from 'electron'
import {
  isValidUUID,
  isValidPath,
  isStrictPath,
  isSafeLocalPath,
} from '../utils/validation'
import { SSHManager } from '../ssh/manager'
import { SFTP_EDITOR_MAX_BYTES } from '../utils/constants'

export function registerSftpHandlers(sshManager: SSHManager): void {
  ipcMain.handle('sftp:init', async (_event, sessionId: string) => {
    if (!isValidUUID(sessionId)) {
      throw new Error('Invalid session id')
    }
    await sshManager.initSftp(sessionId)
  })

  ipcMain.handle('sftp:readdir', async (_event, sessionId: string, remotePath: string) => {
    if (!isValidUUID(sessionId)) {
      throw new Error('Invalid session id')
    }
    if (!isValidPath(remotePath)) {
      throw new Error('Invalid remote path')
    }
    const cleanPath = remotePath.replace(/\/+$/, '') || '/'
    return await sshManager.sftpReaddir(sessionId, cleanPath)
  })

  ipcMain.handle('sftp:realpath', async (_event, sessionId: string, remotePath: string) => {
    if (!isValidUUID(sessionId)) {
      throw new Error('Invalid session id')
    }
    if (!isValidPath(remotePath)) {
      throw new Error('Invalid remote path')
    }
    const cleanPath = remotePath.replace(/\/+$/, '') || '/'
    return await sshManager.sftpRealpath(sessionId, cleanPath)
  })

  ipcMain.handle('sftp:execHome', async (_event, sessionId: string) => {
    if (!isValidUUID(sessionId)) {
      throw new Error('Invalid session id')
    }
    return await sshManager.sftpExec(sessionId, 'printf "%s" "$HOME"')
  })

  ipcMain.handle('sftp:extractArchive', async (_event, sessionId: string, remotePath: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (!isStrictPath(remotePath)) throw new Error('Invalid path')
    const out = await sshManager.sftpExtractArchive(sessionId, remotePath)
    return { ok: true, output: out }
  })

  ipcMain.handle('sftp:exists', async (_event, sessionId: string, remotePath: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (!isStrictPath(remotePath)) throw new Error('Invalid path')
    return await sshManager.sftpExists(sessionId, remotePath)
  })

  /** Native drag of a local file into the OS file manager (file must already exist). */
  ipcMain.on('sftp:startDrag', (event, filePath: string) => {
    if (!isSafeLocalPath(filePath)) return
    try {
      const icon = nativeImage.createEmpty()
      event.sender.startDrag({
        file: filePath,
        icon,
      })
    } catch (err) {
      console.error('[sftp:startDrag]', err)
    }
  })

  ipcMain.handle('sftp:readFile', async (_event, sessionId: string, remotePath: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (!isStrictPath(remotePath)) throw new Error('Invalid path')
    return await sshManager.sftpReadFile(sessionId, remotePath, SFTP_EDITOR_MAX_BYTES)
  })

  ipcMain.handle('sftp:writeFile', async (_event, sessionId: string, remotePath: string, content: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (!isStrictPath(remotePath)) throw new Error('Invalid path')
    if (typeof content !== 'string') throw new Error('Invalid content')
    await sshManager.sftpWriteFile(sessionId, remotePath, content, SFTP_EDITOR_MAX_BYTES)
  })

  ipcMain.handle('sftp:chmod', async (_event, sessionId: string, remotePath: string, mode: string, recursive?: boolean) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (!isStrictPath(remotePath)) throw new Error('Invalid path')
    if (!/^[0-7]{3,4}$/.test(mode)) throw new Error('Invalid mode')
    await sshManager.sftpChmod(sessionId, remotePath, mode, !!recursive)
  })

  ipcMain.handle('sftp:chown', async (_event, sessionId: string, remotePath: string, owner: string, group?: string, recursive?: boolean) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (!isStrictPath(remotePath)) throw new Error('Invalid path')
    if (!owner || typeof owner !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(owner)) throw new Error('Invalid owner')
    if (group !== undefined && (typeof group !== 'string' || !group || !/^[A-Za-z0-9_.-]+$/.test(group))) throw new Error('Invalid group')
    await sshManager.sftpChown(sessionId, remotePath, owner, group, !!recursive)
  })

  ipcMain.handle('sftp:rename', async (_event, sessionId: string, oldPath: string, newPath: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (!isStrictPath(oldPath)) throw new Error('Invalid old path')
    if (!isStrictPath(newPath)) throw new Error('Invalid new path')
    await sshManager.sftpRename(sessionId, oldPath, newPath)
  })

  ipcMain.handle('sftp:mkdir', async (_event, sessionId: string, remotePath: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (!isStrictPath(remotePath)) throw new Error('Invalid path')
    await sshManager.sftpMkdir(sessionId, remotePath)
  })

  ipcMain.handle('sftp:delete', async (_event, sessionId: string, remotePath: string, isDirectory?: boolean) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (!isStrictPath(remotePath)) throw new Error('Invalid path')
    await sshManager.sftpDelete(sessionId, remotePath, !!isDirectory)
  })

  ipcMain.handle('sftp:stat', async (_event, sessionId: string, remotePath: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (!isStrictPath(remotePath)) throw new Error('Invalid path')
    const stat = await sshManager.sftpStat(sessionId, remotePath)
    let ownerName = String(stat.uid)
    let groupName = String(stat.gid)
    try {
      const idResult = await sshManager.sftpExec(sessionId, `stat -c '%U:%G' "${remotePath}"`)
      const parts = idResult.trim().split(':')
      if (parts.length === 2) {
        ownerName = parts[0]
        groupName = parts[1]
      }
    } catch {}
    return { ...stat, owner: ownerName, group: groupName }
  })
}
