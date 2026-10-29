<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import AppTitlebar from '../../src/components/app/AppTitlebar.vue'
import AppWorkspaceShell from '../../src/components/app/AppWorkspaceShell.vue'
import GlobalJumpPalette from '../../src/components/app/GlobalJumpPalette.vue'
import type { Connection } from '../../shared/types/connection'
import { useAppNavigation } from '../../src/composables/app/useAppNavigation'
import { useAppWindowRouting } from '../../src/composables/app/useAppWindowRouting'
import { useTheme } from '../../src/composables/app/useTheme'
import { setAppLocale } from '../../src/i18n'

const homeSelections = ref(0)
const jumpVisible = ref(false), globalActions = ref<string[]>([])
const fixtureConnections = [{ id: 'host-1', name: 'Example', host: '127.0.0.1', port: 22, username: 'root' }] as Connection[]
const { appMode, showSettingsPage, databaseMounted, aiWorkspaceMounted, moduleSwitching, selectModule,
  settingsViewRef, openSettingsPage, closeSettingsPage, requestModuleAction } = useAppNavigation({ onSelectHome: () => { homeSelections.value++ } })
function globalJump(action: string) { jumpVisible.value = false; return requestModuleAction('ssh', () => globalActions.value.push(action)) }
const { handleEnterDatabaseModule, handleEnterSshModule, handleEnterAiModule } = useAppWindowRouting({ appMode, enterDatabase: () => selectModule('database'), selectModule, search: '' })
const theme = useTheme()
const showModules = ref(true), settingsCloseAllowed = ref(true)
const sshCommand = ref('tail -f /var/log/app.log'), query = ref('SELECT * FROM users;'), aiDraft = ref('Check the deployment script')
settingsViewRef.value = { requestClose: () => { if (settingsCloseAllowed.value) closeSettingsPage() } }
onMounted(() => {
  ;(window as any).__navigation = {
    async theme(value: 'light' | 'dark' | 'eyecare', locale: 'zh-CN' | 'en-US', scale: number) { theme.setTheme(value); setAppLocale(locale); document.documentElement.style.setProperty('--ui-scale', String(scale)); await nextTick() },
    async settings(allow: boolean) { settingsCloseAllowed.value = allow; openSettingsPage(); await nextTick() },
    async dedicated(value: boolean) { showModules.value = !value; await nextTick() },
    jump: () => { jumpVisible.value = true },
    notify: () => requestModuleAction('ai', () => globalActions.value.push('notification')),
    actions: () => [...globalActions.value],
    snapshot: () => ({ mode: appMode.value, settings: showSettingsPage.value, databaseMounted: databaseMounted.value, aiMounted: aiWorkspaceMounted.value, homeSelections: homeSelections.value }),
  }
})
</script>

<template>
  <div class="navigation-fixture app-container">
    <AppTitlebar :app-mode="appMode" :show-settings-page="showSettingsPage" @enter-ssh="handleEnterSshModule" @enter-database="handleEnterDatabaseModule" @enter-ai="handleEnterAiModule" @toggle-settings="openSettingsPage()" />
    <AppWorkspaceShell :app-mode="appMode" :show-settings-page="showSettingsPage" :navigation-busy="moduleSwitching" :show-modules="showModules" @select-module="selectModule">
      <section v-if="showSettingsPage" class="navigation-settings">Settings draft</section>
      <div v-show="!showSettingsPage" class="navigation-content">
        <section v-show="appMode==='ssh'" class="navigation-pane" data-pane="ssh"><h2>SSH</h2><label>Terminal draft<input v-model="sshCommand" data-field="ssh" /></label><div class="navigation-scroll"><pre>{{ 'SSH output\n'.repeat(150) }}</pre></div></section>
        <section v-if="databaseMounted" v-show="appMode==='database'" class="navigation-pane" data-pane="database"><h2>DB</h2><label>SQL draft<textarea v-model="query" data-field="database"></textarea></label></section>
        <section v-if="aiWorkspaceMounted" v-show="appMode==='ai'" class="navigation-pane" data-pane="ai"><h2>AI</h2><label>Conversation draft<textarea v-model="aiDraft" data-field="ai"></textarea></label></section>
      </div>
    </AppWorkspaceShell>
    <GlobalJumpPalette :visible="jumpVisible" :connections="fixtureConnections" @close="jumpVisible = false"
      @connect="globalJump('connect')" @open-home="globalJump('home')" @open-docker="globalJump('docker')" />
  </div>
</template>

<style scoped>
.navigation-fixture { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg-primary); }
.navigation-content { flex: 1; display: flex; min-width: 0; min-height: 0; }
.navigation-pane { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; padding: 20px; gap: 12px; }
.navigation-pane label { display: flex; flex-direction: column; gap: 8px; }
.navigation-pane input, .navigation-pane textarea { padding: 10px; width: 100%; box-sizing: border-box; color: var(--text-primary); background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 6px; }
.navigation-pane textarea { height: 140px; }
.navigation-scroll { flex: 1; min-height: 0; overflow: auto; }
.navigation-settings { padding: 20px; }
</style>
