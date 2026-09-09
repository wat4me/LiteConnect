import { reactive } from 'vue'
import { cleanRemotePath } from '@/utils/sftp/sftpCwdSync'

/**
 * Last directory SFTP successfully listed per SSH session.
 * This is a real remote path (readdir succeeded), unlike optimistic `cd` tracking.
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
