export function cleanRemotePath(path: string): string {
  return path.replace(/\/+$/, '') || '/'
}

export function sameRemotePath(a: string, b: string): boolean {
  return cleanRemotePath(a || '') === cleanRemotePath(b || '')
}

/**
 * Locate always reloads the SFTP listing (user asked to snap to the shell).
 * Follow skips a readdir when already on that logical path.
 */
export function shouldReloadSftpListing(
  mode: 'locate' | 'follow',
  targetPath: string,
  currentPath: string,
): boolean {
  if (mode === 'locate') return true
  return !sameRemotePath(targetPath, currentPath)
}
