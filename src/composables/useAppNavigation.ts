import { computed, ref } from 'vue'

/**
 * Top-level module navigation: SSH / database / settings.
 * Keeps App.vue free of shell routing state.
 */
export function useAppNavigation(deps: { onSelectHome: () => void }) {
  const showSettingsPage = ref(false)
  const appMode = ref<'ssh' | 'database'>('ssh')
  const databaseMounted = ref(false)
  /** Lazy: mount terminal workspace only after first host session is needed. */
  const sshWorkspaceMounted = ref(false)
  const settingsViewRef = ref<{ requestClose: () => void | Promise<void> } | null>(null)

  const isSshMode = computed(() => appMode.value === 'ssh' && !showSettingsPage.value)
  const isDatabaseMode = computed(() => appMode.value === 'database' && !showSettingsPage.value)

  function closeSettingsPage() {
    showSettingsPage.value = false
  }

  function ensureSshWorkspaceMounted() {
    sshWorkspaceMounted.value = true
  }

  /** SSH entry: forceHome returns to connection list; otherwise restore last SSH view. */
  function enterSsh(forceHome = false) {
    showSettingsPage.value = false
    const wasSsh = appMode.value === 'ssh'
    appMode.value = 'ssh'
    if (forceHome || wasSsh) {
      deps.onSelectHome()
    }
  }

  function enterDatabase() {
    showSettingsPage.value = false
    appMode.value = 'database'
    databaseMounted.value = true
  }

  function toggleSettingsPage() {
    if (showSettingsPage.value) {
      void settingsViewRef.value?.requestClose()
    } else {
      showSettingsPage.value = true
    }
  }

  return {
    showSettingsPage,
    appMode,
    databaseMounted,
    sshWorkspaceMounted,
    settingsViewRef,
    isSshMode,
    isDatabaseMode,
    closeSettingsPage,
    enterSsh,
    enterDatabase,
    toggleSettingsPage,
    ensureSshWorkspaceMounted,
  }
}
