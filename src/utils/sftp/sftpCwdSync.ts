export function cleanRemotePath(path: string): string {
  return path.replace(/\/+$/, '') || '/'
}

export function sameRemotePath(a: string, b: string): boolean {
  return cleanRemotePath(a || '') === cleanRemotePath(b || '')
}

/**
 * Toolbar "locate terminal cwd": always ask the live shell.
 * Local `cd` tracking is only a fallback if the probe fails.
 */
export function planLocateCwd(opts: {
  terminalPath: string
  trackerPwd?: string | null
}): { tracked: string; useLiveShellPwd: true } {
  const fromTracker = opts.trackerPwd?.trim() ? cleanRemotePath(opts.trackerPwd) : ''
  const fromSidebar = opts.terminalPath?.trim() ? cleanRemotePath(opts.terminalPath) : ''
  return {
    tracked: fromTracker || fromSidebar,
    useLiveShellPwd: true,
  }
}

/**
 * Shell `cd` / `pwd` are logical. SFTP `realpath` is physical.
 * Writing the physical path into the cd tracker makes the next relative
 * `cd ..` / `cd sub` diverge from the terminal (classic symlink cwd drift).
 */
export function uniqueCleanPaths(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    const t = (p || '').trim()
    if (!t || t === '.') continue
    const c = cleanRemotePath(t)
    if (seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
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
