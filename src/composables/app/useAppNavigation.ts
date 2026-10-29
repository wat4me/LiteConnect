import { computed, ref } from 'vue'
import type { SettingsTabId } from '@/domain/settings/types'

export type { SettingsTabId }
export type AppMode = 'ssh' | 'database' | 'ai'

/**
 * Top-level module navigation: SSH / database / AI / settings.
 * Keeps App.vue free of shell routing state.
 */
export function useAppNavigation(deps: { onSelectHome: () => void }) {
  const showSettingsPage = ref(false)
  /** Tab to select when SettingsView mounts / re-opens. */
  const settingsInitialTab = ref<SettingsTabId | undefined>(undefined)
  const appMode = ref<AppMode>('ssh')
  const moduleSwitching = ref(false)
  const aiWorkspaceMounted = ref(false)
  const databaseMounted = ref(false)
  /** Lazy: mount terminal workspace only after first host session is needed. */
  const sshWorkspaceMounted = ref(false)
  const settingsViewRef = ref<{ requestClose: () => void | Promise<void> } | null>(null)

  const isSshMode = computed(() => appMode.value === 'ssh' && !showSettingsPage.value)
  const isDatabaseMode = computed(() => appMode.value === 'database' && !showSettingsPage.value)
  const isAiMode = computed(() => appMode.value === 'ai' && !showSettingsPage.value)

  function closeSettingsPage() {
    showSettingsPage.value = false
    settingsInitialTab.value = undefined
  }

  function openSettingsPage(tab?: SettingsTabId) {
    settingsInitialTab.value = tab
    showSettingsPage.value = true
  }

  function ensureSshWorkspaceMounted() {
    sshWorkspaceMounted.value = true
  }

  /** SSH entry: forceHome returns to connection list; otherwise restore last SSH view. */
  function enterSsh(forceHome = false) {
    showSettingsPage.value = false
    settingsInitialTab.value = undefined
    const wasSsh = appMode.value === 'ssh'
    appMode.value = 'ssh'
    if (forceHome || wasSsh) {
      deps.onSelectHome()
    }
  }

  function enterDatabase() {
    showSettingsPage.value = false
    settingsInitialTab.value = undefined
    appMode.value = 'database'
    databaseMounted.value = true
  }

  function enterAi() {
    showSettingsPage.value = false
    settingsInitialTab.value = undefined
    appMode.value = 'ai'
    aiWorkspaceMounted.value = true
  }

  /** Main-window quick switching keeps mounted workspaces and their drafts alive. */
  async function selectModule(mode: AppMode) {
    if (moduleSwitching.value || (appMode.value === mode && !showSettingsPage.value)) return
    moduleSwitching.value = true
    try {
      if (showSettingsPage.value) {
        await settingsViewRef.value?.requestClose()
        if (showSettingsPage.value) return
      }
      // Closing settings is sufficient when returning to the same module.
      if (appMode.value === mode) return
      if (mode === 'ssh') enterSsh()
      else if (mode === 'database') enterDatabase()
      else enterAi()
    } finally { moduleSwitching.value = false }
  }

  /** Run a navigation side effect only after the destination was actually accepted. */
  async function requestModuleAction(mode: AppMode, action: () => unknown | Promise<unknown>): Promise<boolean> {
    if (moduleSwitching.value) return false
    await selectModule(mode)
    if (showSettingsPage.value || appMode.value !== mode) return false
    await action()
    return true
  }

  function toggleSettingsPage() {
    if (showSettingsPage.value) {
      void settingsViewRef.value?.requestClose()
    } else {
      openSettingsPage()
    }
  }

  return {
    showSettingsPage,
    settingsInitialTab,
    appMode,
    moduleSwitching,
    selectModule,
    requestModuleAction,
    databaseMounted,
    aiWorkspaceMounted,
    isAiMode,
    enterAi,
    sshWorkspaceMounted,
    settingsViewRef,
    isSshMode,
    isDatabaseMode,
    closeSettingsPage,
    openSettingsPage,
    enterSsh,
    enterDatabase,
    toggleSettingsPage,
    ensureSshWorkspaceMounted,
  }
}
