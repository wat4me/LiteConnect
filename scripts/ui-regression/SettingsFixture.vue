<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import SettingsView from '../../src/views/SettingsView.vue'
import LeftToolbar from '../../src/components/workspace/LeftToolbar.vue'
import { createEmptyDraft } from '../../src/composables/settings/useSettingsDraft'
import { useSidebarState } from '../../src/composables/workspace/useSidebarState'
import { useTheme } from '../../src/composables/app/useTheme'
import { setAppLocale } from '../../src/i18n'
import { applyAppSettings } from '../../src/composables/settings/applyAppSettings'
import type { AppRuntimeSettings, AppSettingsChange, AppSettingsAll } from '../../shared/types/settings'

const defaults = createEmptyDraft()
const saved = { ...defaults, dbOpenMode: 'newWindow', latencyIntervalMs: 10_000, monitorIntervalMs: 5000,
  defaultDownloadPath: 'Downloads', downloadPath: 'Downloads', configuredDownloadPath: '', recentDownloadPaths: [],
  localeConfigured: true, customColors: null, locale: 'zh-CN' }
const { monitorEnabled, monitorVisible, handleMonitorSettingsChange } = useSidebarState({
  groups: ref([]), activeGroupId: ref('home'), activeSessionId: computed(() => null), HOME_ID: 'home',
  getGroupByConnectionId: () => null, getLastSessionId: () => null,
})
const listeners = new Set<(value: AppRuntimeSettings) => void>()
const settingsListeners = new Set<(change: AppSettingsChange) => void>()
let failRead = new URLSearchParams(location.search).has('failSettings')
const patches: object[] = []
const settingsRef = ref<InstanceType<typeof SettingsView> | null>(null)
const closes = ref(0)
let saveGate: Promise<void> | null = null
let releaseSave: (() => void) | null = null
function notify(value: AppRuntimeSettings) {
  handleMonitorSettingsChange(new CustomEvent('monitor-settings-change', { detail: { enabled: value.monitorEnabled } }))
  for (const listener of listeners) listener(value)
}
;(window as any).LiteConnect = {
  getAllSettings: async () => { if (failRead) { failRead = false; throw new Error('Test: settings storage unavailable') }; return structuredClone(saved) },
  onSettingsChanged: (listener: (change: AppSettingsChange) => void) => { settingsListeners.add(listener); return () => settingsListeners.delete(listener) },
  setManySettings: async (patch: object) => { patches.push(structuredClone(patch)); await saveGate; Object.assign(saved, patch); notify(saved as AppRuntimeSettings); return structuredClone(saved) },
  onRuntimeSettingsChanged: (listener: (value: AppRuntimeSettings) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  updateTitleBar: async () => {},
  getConnections: async () => [], getAppInfo: async () => ({ version: 'test', platform: 'win32-x64' }),
  getX11ServerStatus: async () => ({ platform: 'win32', ready: true, bundled: true, resolvedExecutablePath: 'VcXsrv.exe' }),
  onGlobalHotkeyFailed: () => () => {},
}
const theme = useTheme()
onMounted(() => {
  settingsListeners.add(({ settings, changed }) => applyAppSettings(settings, changed))
  ;(window as any).__settings = {
    saved: () => structuredClone(saved),
    patches: () => structuredClone(patches),
    mutateStored: (patch: object) => Object.assign(saved, patch),
    remoteSnapshot: (patch: object, changed: AppSettingsChange['changed']) => {
      Object.assign(saved, patch)
      for (const listener of settingsListeners) listener({ settings: structuredClone(saved) as unknown as AppSettingsAll, changed })
    },
    resetCloses: () => { closes.value = 0 },
    holdSave: () => { saveGate = new Promise(resolve => { releaseSave = resolve }) },
    releaseSave: () => { releaseSave?.(); saveGate = null },
    tryClose: async () => { await settingsRef.value?.requestClose(); return closes.value },
    openMonitor: () => { monitorVisible.value = true },
    state: () => ({ enabled: monitorEnabled.value, open: monitorVisible.value }),
    remote: (enabled: boolean) => notify({ monitorEnabled: enabled, autoReconnectEnabled: true, autoReconnectMaxRetries: 5 }),
    async theme(value: 'light' | 'dark' | 'eyecare', locale: 'zh-CN' | 'en-US') { theme.setTheme(value); setAppLocale(locale); await nextTick() },
  }
})
</script>

<template>
  <div class="settings-harness">
    <LeftToolbar :ai-active="false" :files-active="false" :monitor-active="monitorVisible" :monitor-enabled="monitorEnabled"
      :batch-active="false" :snippets-active="false" :show-ai-unread="false" @toggle-monitor="monitorVisible = !monitorVisible" />
    <SettingsView ref="settingsRef" initial-tab="database" @close="closes++" />
  </div>
</template>

<style scoped>
.settings-harness { display: flex; height: 100%; min-width: 0; overflow: hidden; background: var(--bg-primary); }
</style>
