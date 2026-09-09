import { reactive } from 'vue'
import { cleanRemotePath } from './sftpCwdSync'

/**
 * Last directory SFTP successfully listed per SSH session.
 * Shared store (not an SFTP composable) so AI/session can read a real remote path.
 */
const listedCwd = reactive<Record<string, string>>({})

export function setSftpListedCwd(sessionId: string, path: string): void {
  if (!sessionId) return
  const clean = cleanRemotePath(path)
  if (!clean.startsWith('/')) return
  listedCwd[sessionId] = clean
}

export function getSftpListedCwd(sessionId: string): string {
  return listedCwd[sessionId] || ''
}

export function clearSftpListedCwd(sessionId: string): void {
  if (sessionId) delete listedCwd[sessionId]
}

export function sftpListedCwdState(): Record<string, string> {
  return listedCwd
}
