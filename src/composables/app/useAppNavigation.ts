import { computed, ref } from 'vue'

export type SettingsTabId = 'appearance' | 'terminal' | 'files' | 'database' | 'network' | 'mcp' | 'shortcuts'

/**
 * Top-level module navigation: SSH / database / settings.
 * Keeps App.vue free of shell routing state.
 */
export function useAppNavigation(deps: { onSelectHome: () => void }) {
  const showSettingsPage = ref(false)
  /** Tab to select when SettingsView mounts / re-opens. */
  const settingsInitialTab = ref<SettingsTabId | undefined>(undefined)
  const appMode = ref<'ssh' | 'database'>('ssh')
  const databaseMounted = ref(false)
  /** Lazy: mount terminal workspace only after first host session is needed. */
  const sshWorkspaceMounted = ref(false)
  const settingsViewRef = ref<{ requestClose: () => void | Promise<void> } | null>(null)

  const isSshMode = computed(() => appMode.value === 'ssh' && !showSettingsPage.value)
  const isDatabaseMode = computed(() => appMode.value === 'database' && !showSettingsPage.value)

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
    databaseMounted,
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
