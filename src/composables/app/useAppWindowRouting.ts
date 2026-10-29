import type { Ref } from 'vue'
import { sanitizeDbOpenMode } from '@shared/dbOpenMode'
import type { AppMode } from './useAppNavigation'

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
  appMode: Ref<'ssh' | 'database' | 'ai'>
  enterDatabase: () => void
  selectModule: (mode: AppMode) => Promise<void>
  search?: string
}) {
  const launchParams = readWindowLaunchParams(deps.search ?? window.location.search)
  const isDetachedWindow = launchParams.detached && !!launchParams.connectionId
  const isDbWindow = launchParams.mode === 'db'
  if (isDbWindow) deps.enterDatabase()

  async function handleEnterDatabaseModule(): Promise<void> {
    if (!isDetachedWindow || isDbWindow) {
      await deps.selectModule('database')
      return
    }
    if (deps.appMode.value === 'database') {
      await deps.selectModule('database')
      return
    }
    try {
      const all = await window.LiteConnect.getAllSettings()
      if (sanitizeDbOpenMode(all.dbOpenMode) === 'currentWindow') {
        await deps.selectModule('database')
        return
      }
    } catch {
      // Missing setting → historical dedicated-window default.
    }
    void window.LiteConnect.openDatabaseWindow()
  }

  async function handleEnterSshModule(): Promise<void> {
    if (isDbWindow) {
      void window.LiteConnect.focusMainWindow()
      return
    }
    await deps.selectModule('ssh')
  }

  async function handleEnterAiModule(): Promise<void> {
    await deps.selectModule('ai')
  }

  return { launchParams, isDetachedWindow, isDbWindow, handleEnterDatabaseModule, handleEnterSshModule, handleEnterAiModule }
}
