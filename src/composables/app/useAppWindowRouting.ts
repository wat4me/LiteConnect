import type { Ref } from 'vue'
import { sanitizeDbOpenMode } from '@shared/dbOpenMode'

export function readWindowLaunchParams(search: string) {
  try {
    const params = new URLSearchParams(search)
    return {
      detached: params.get('detached') === '1',
      connectionId: params.get('connectionId') || '',
      mode: params.get('mode') || '',
    }
  } catch {
    return { detached: false, connectionId: '', mode: '' }
  }
}

/** Window-specific SSH/DB entry policy around the shared App navigation state. */
export function useAppWindowRouting(deps: {
  appMode: Ref<'ssh' | 'database'>
  enterDatabase: () => void
  enterSsh: (forceHome?: boolean) => void
  search?: string
}) {
  const launchParams = readWindowLaunchParams(deps.search ?? window.location.search)
  const isDetachedWindow = launchParams.detached && !!launchParams.connectionId
  const isDbWindow = launchParams.mode === 'db'
  if (isDbWindow) deps.enterDatabase()

  async function handleEnterDatabaseModule(): Promise<void> {
    if (isDbWindow) return
    if (deps.appMode.value === 'database') {
      deps.enterDatabase()
      return
    }
    try {
      const all = await window.LiteConnect.getAllSettings()
      if (sanitizeDbOpenMode(all.dbOpenMode) === 'currentWindow') {
        deps.enterDatabase()
        return
      }
    } catch {
      // Missing setting → historical dedicated-window default.
    }
    void window.LiteConnect.openDatabaseWindow()
  }

  function handleEnterSshModule(forceHome?: boolean): void {
    if (isDbWindow) {
      void window.LiteConnect.focusMainWindow()
      return
    }
    deps.enterSsh(forceHome)
  }

  return { launchParams, isDetachedWindow, isDbWindow, handleEnterDatabaseModule, handleEnterSshModule }
}
