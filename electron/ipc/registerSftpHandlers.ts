import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SftpEditorSaveOptions, SftpDirectoryDiffEntry } from '../../shared/types/sftp'
import { ipcMain } from 'electron'
import {
  isValidUUID,
  isValidPath,
  isStrictPath,
} from '../utils/validation'
import { SSHManager } from '../ssh/manager'
import { shellQuote } from '../ssh/shellQuote'
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

  ipcMain.handle('sftp:readFile', async (_event, sessionId: string, remotePath: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (!isStrictPath(remotePath)) throw new Error('Invalid path')
    return await sshManager.sftpReadFile(sessionId, remotePath, SFTP_EDITOR_MAX_BYTES)
  })

  ipcMain.handle('sftp:editorSnapshot', async (_event, sessionId: string, remotePath: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (!isStrictPath(remotePath)) throw new Error('Invalid path')
    return sshManager.sftpReadEditorSnapshot(sessionId, remotePath, SFTP_EDITOR_MAX_BYTES)
  })

  ipcMain.handle('sftp:editorSave', async (_event, sessionId: string, remotePath: string, content: string, options: SftpEditorSaveOptions) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (!isStrictPath(remotePath)) throw new Error('Invalid path')
    if (typeof content !== 'string' || !options || typeof options.revision !== 'string' || !/^[a-f0-9]{64}$/.test(options.revision)) throw new Error('Invalid editor save')
    if (options.backup !== undefined && typeof options.backup !== 'boolean') throw new Error('Invalid backup option')
    return sshManager.sftpSaveEditor(sessionId, remotePath, content, options, SFTP_EDITOR_MAX_BYTES)
  })

  ipcMain.handle('sftp:directoryPreview', async (_event, sessionId: string, localPath: string, remotePath: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (!isStrictPath(remotePath) || !isValidPath(localPath) || !path.isAbsolute(localPath)) throw new Error('Invalid path')
    const local = await fs.readdir(localPath, { withFileTypes: true })
    if (local.length > 2000) throw new Error('Directory preview supports at most 2000 entries')
    const remote = new Map((await sshManager.sftpReaddir(sessionId, remotePath)).map(entry => [entry.name, entry]))
    const entries: SftpDirectoryDiffEntry[] = []
    let skipped = 0
    for (const item of local) {
      if (!item.isFile() || item.isSymbolicLink()) { skipped++; continue }
      const localFile = path.join(localPath, item.name)
      const stat = await fs.lstat(localFile)
      if (!stat.isFile() || stat.isSymbolicLink()) { skipped++; continue }
      const target = remote.get(item.name)
      const status = !target ? 'new' : target.isDirectory || target.isSymlink ? 'blocked' : target.size !== stat.size || Math.abs(target.modifyTime - stat.mtimeMs) >= 2000 ? 'changed' : 'same'
      entries.push({ name: item.name, localPath: localFile, size: stat.size, status })
    }
    return { localPath, remotePath, entries, skipped }
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
      const idResult = await sshManager.sftpExec(
        sessionId,
        `stat -c '%U:%G' -- ${shellQuote(remotePath)}`,
      )
      const parts = idResult.trim().split(':')
      if (parts.length === 2) {
        ownerName = parts[0]
        groupName = parts[1]
      }
    } catch {}
    return { ...stat, owner: ownerName, group: groupName }
  })
}
