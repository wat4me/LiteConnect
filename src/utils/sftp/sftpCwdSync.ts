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
