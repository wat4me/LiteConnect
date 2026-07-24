import { ref } from 'vue'
import { t } from '../../i18n'
import type { FileEntry } from '../../env.d.ts'
import type { TerminalPwdTracker } from '../terminal/useTerminalPwd'

function cleanRemotePath(path: string): string {
  return path.replace(/\/+$/, '') || '/'
}

/** Friendlier empty-dir / permission / not-found copy for SFTP readdir failures */
function formatSftpError(raw: unknown, path: string): string {
  const msg = String(raw || '').trim()
  const lower = msg.toLowerCase()
  if (
    lower.includes('permission denied') ||
    lower.includes('eacces') ||
    lower.includes('access denied') ||
    msg.includes('权限') ||
    msg.includes('拒绝')
  ) {
    return t('sftp.noPermission', { path })
  }
  if (
    lower.includes('no such file') ||
    lower.includes('enoent') ||
    lower.includes('not found') ||
    msg.includes('不存在')
  ) {
    return t('sftp.pathNotFound', { path })
  }
  if (lower.includes('not a directory')) {
    return t('sftp.notADirectory', { path })
  }
  if (!msg || msg === t('sftp.cannotLoadDir')) {
    return t('sftp.cannotOpenPath', { path })
  }
  return msg
}

type TerminalPwdRequestDetail = {
  sessionId: string
  handled?: boolean
  resolve: (pwd: string) => void
  reject: (error: Error) => void
}

function requestTerminalPwd(sessionId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const detail: TerminalPwdRequestDetail = {
      sessionId,
      resolve,
      reject,
    }
    globalThis.dispatchEvent(new CustomEvent<TerminalPwdRequestDetail>('request-terminal-pwd', { detail }))
    if (!detail.handled) {
      reject(new Error('No active terminal for pwd request'))
    }
  })
}

export function useSftpNavigation(sessionId: () => string, pwdTracker?: TerminalPwdTracker) {
  const currentPath = ref('')
  const files = ref<FileEntry[]>([])
  const loading = ref(false)
  const error = ref('')
  const sftpReady = ref(false)
  const pathInput = ref('')
  const showPathInput = ref(false)
  const homePath = ref('')
  const shellHomePath = ref('')
  const terminalPath = ref('')
  const lastPathDebug = ref('')
  const followTerminalPath = ref(true)
  const previousTerminalPath = ref('')
  let pendingLoadId = 0

  async function resolvePath(path: string): Promise<string | null> {
    const clean = cleanRemotePath(path)
    try {
      return await window.LiteConnect.sftpRealpath(sessionId(), clean)
    } catch {
      try {
        const entries = await window.LiteConnect.sftpReaddir(sessionId(), clean)
        if (entries) return clean
      } catch {}
      return null
    }
  }

  async function initSftp(): Promise<boolean> {
    if (sftpReady.value) return true
    loading.value = true
    error.value = ''
    try {
      await window.LiteConnect.sftpInit(sessionId())
      sftpReady.value = true
      const [shellHomeRaw, sftpHome] = await Promise.all([
        window.LiteConnect.sftpExecHome(sessionId()).catch(() => ''),
        window.LiteConnect.sftpRealpath(sessionId(), '.').catch(() => ''),
      ])
      const home = shellHomeRaw.trim() || sftpHome
      if (!home) throw new Error(t('sftp.cannotGetHome'))
      homePath.value = home
      shellHomePath.value = shellHomeRaw.trim()
      terminalPath.value = home
      currentPath.value = home
      pathInput.value = home
      await loadDirectory(home)
      return true
    } catch (err: any) {
      error.value = err.message || t('sftp.initFailed')
      return false
    } finally {
      loading.value = false
    }
  }

  async function loadDirectory(path: string, isFallback = false): Promise<boolean> {
    const cleanPath = cleanRemotePath(path)
    const loadId = ++pendingLoadId
    loading.value = true
    error.value = ''
    try {
      // If channel died (e.g. after disconnect), try re-init once without wiping path.
      if (!sftpReady.value) {
        try {
          await window.LiteConnect.sftpInit(sessionId())
          sftpReady.value = true
        } catch (initErr: any) {
          if (loadId !== pendingLoadId) return false
          error.value = initErr?.message || t('sftp.notReady')
          return false
        }
      }
      const entries = await window.LiteConnect.sftpReaddir(sessionId(), cleanPath)
      if (loadId !== pendingLoadId) return false

      const filtered = entries.filter(entry => entry.name !== '.' && entry.name !== '..')
      // Set path + files in the same tick to avoid tree ingest with stale files.
      currentPath.value = cleanPath
      pathInput.value = cleanPath
      files.value = filtered
      return true
    } catch (err: any) {
      if (loadId !== pendingLoadId) return false
      console.warn(`[SFTP] readdir failed for "${cleanPath}":`, err.message || err)
      const msg = String(err?.message || err || '')
      // Stale SFTP after reconnect: re-init and retry once
      if (
        !isFallback &&
        (msg.includes('SFTP') || msg.includes('会话') || msg.includes('not found') || msg.includes('未初始化'))
      ) {
        try {
          sftpReady.value = false
          await window.LiteConnect.sftpInit(sessionId())
          sftpReady.value = true
          return await loadDirectory(cleanPath, true)
        } catch {
          // fall through
        }
      }
      if (!isFallback && pwdTracker) {
        const prevPwd = pwdTracker.revertCd(sessionId())
        if (prevPwd && cleanRemotePath(prevPwd) !== cleanPath) {
          terminalPath.value = prevPwd
          return await loadDirectory(prevPwd, true)
        }
      }
      if (!isFallback) {
        error.value = formatSftpError(err.message || err, cleanPath)
      }
      return false
    } finally {
      if (loadId === pendingLoadId) {
        loading.value = false
      }
    }
  }

  async function navigateTo(entry: FileEntry): Promise<boolean> {
    // Backend marks symlink→dir as isDirectory after following the link.
    // File symlinks stay isDirectory=false and are not navigable.
    if (!entry.isDirectory) return false
    if (entry.isSymlink) {
      const resolved = await resolvePath(entry.path)
      if (resolved) return await loadDirectory(resolved)
    }
    return await loadDirectory(entry.path)
  }

  async function goUp(): Promise<boolean> {
    if (currentPath.value === '/') return false
    const parts = currentPath.value.split('/').filter(Boolean)
    parts.pop()
    const parentPath = parts.length === 0 ? '/' : '/' + parts.join('/')
    return await loadDirectory(parentPath)
  }

  async function goToHome(): Promise<boolean> {
    try {
      const home = await window.LiteConnect.sftpRealpath(sessionId(), '.')
      return await loadDirectory(home)
    } catch {
      return false
    }
  }

  async function syncCwd(): Promise<boolean> {
    return syncTrackedPath(false)
  }

  async function syncCwdForce(): Promise<boolean> {
    return syncTrackedPath(true)
  }

  async function syncTrackedPath(useSftpFallback: boolean): Promise<boolean> {
    const tracked = terminalPath.value
    let livePwd = ''

    if (useSftpFallback) {
      try {
        livePwd = cleanRemotePath((await requestTerminalPwd(sessionId())).trim())
      } catch {}
    }

    if (!tracked && !livePwd) {
      error.value = t('sftp.cannotGetCwd')
      return false
    }

    const candidates = [
      livePwd,
      tracked ? cleanRemotePath(tracked) : '',
    ].filter(Boolean)

    if (useSftpFallback) candidates.push('.')

    for (const candidate of [...new Set(candidates)]) {
      try {
        const resolved = await window.LiteConnect.sftpRealpath(sessionId(), candidate)
        if (!resolved) continue

        previousTerminalPath.value = terminalPath.value
        terminalPath.value = resolved
        if (pwdTracker) pwdTracker.setPwd(sessionId(), resolved)

        if (resolved === currentPath.value) return true
        return await loadDirectory(resolved)
      } catch {}
    }

    if (useSftpFallback) {
      error.value = t('sftp.cannotGetCwd')
    }
    return false
  }

  async function toggleFollowTerminalPath(): Promise<void> {
    followTerminalPath.value = !followTerminalPath.value
    if (followTerminalPath.value) {
      await syncCwd()
    }
  }

  async function submitPathInput(): Promise<void> {
    const path = pathInput.value.trim()
    if (path && path !== currentPath.value) {
      await loadDirectory(path)
    }
    showPathInput.value = false
  }

  function togglePathInput(): void {
    showPathInput.value = !showPathInput.value
  }

  async function refresh(): Promise<boolean> {
    if (!currentPath.value) return false
    return await loadDirectory(currentPath.value)
  }

  /** After in-place SSH reconnect: re-open SFTP and reload current path. */
  async function recoverAfterReconnect(): Promise<boolean> {
    const path = currentPath.value
    sftpReady.value = false
    error.value = ''
    try {
      await window.LiteConnect.sftpInit(sessionId())
      sftpReady.value = true
      if (path) {
        return await loadDirectory(path)
      }
      return await initSftp()
    } catch (err: any) {
      error.value = err?.message || t('sftp.recoverFailed')
      return false
    }
  }

  return {
    currentPath,
    files,
    loading,
    error,
    sftpReady,
    pathInput,
    showPathInput,
    recoverAfterReconnect,
    homePath,
    shellHomePath,
    terminalPath,
    lastPathDebug,
    followTerminalPath,
    previousTerminalPath,
    initSftp,
    loadDirectory,
    navigateTo,
    goUp,
    goToHome,
    syncCwd,
    syncCwdForce,
    toggleFollowTerminalPath,
    submitPathInput,
    togglePathInput,
    refresh,
    resolvePath,
    cleanRemotePath,
  }
}
