/** OSC 7 carries a file URI for the remote shell's logical working directory. */
export function parseTerminalCwdReport(data: string): { host: string; path: string } | undefined {
  if (!data.startsWith('file://') || /[\\?#\0\r\n\t]/.test(data)) return
  try {
    const uri = new URL(data)
    const path = decodeURIComponent(uri.pathname)
    if (!path.startsWith('/') || /[\0\r\n]/.test(path)) return
    return { host: uri.hostname, path }
  } catch {
    return undefined
  }
}
