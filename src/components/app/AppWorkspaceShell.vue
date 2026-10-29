<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'
import type { AppMode } from '@/composables/app/useAppNavigation'

withDefaults(defineProps<{
  appMode: AppMode
  showSettingsPage: boolean
  navigationBusy?: boolean
  showModules?: boolean
}>(), { showModules: true, navigationBusy: false })
const emit = defineEmits<{ (e: 'select-module', mode: AppMode): void }>()
const { t } = useI18n()
const modules = [
  { id: 'ssh', label: 'SSH', name: 'app.modeSsh', icon: 'terminal' },
  { id: 'database', label: 'DB', name: 'app.modeDatabase', icon: 'database' },
  { id: 'ai', label: 'AI', name: 'app.modeAi', icon: 'ai-chat' },
] as const
</script>

<template>
  <div class="app-shell">
    <nav v-if="showModules" class="app-module-rail" :aria-label="t('app.modulesAria')">
      <button v-for="item in modules" :key="item.id" type="button" class="app-module-button"
        :data-module="item.id" :class="{ active: appMode === item.id && !showSettingsPage }"
        :aria-current="appMode === item.id && !showSettingsPage ? 'page' : undefined"
        :title="t(item.name)" :aria-label="t(item.name)" :disabled="navigationBusy"
        @click="emit('select-module', item.id)">
        <AppIcon :name="item.icon" size="md" />
        <span>{{ item.label }}</span>
      </button>
    </nav>
    <div class="workspace"><slot /></div>
  </div>
</template>

<style scoped>
.app-shell { display: flex; flex: 1; min-width: 0; min-height: 0; position: relative; z-index: 1; overflow: hidden; border-top: 1px solid var(--border-color); background: transparent; }
.app-module-rail { display: flex; flex-direction: column; align-items: stretch; gap: 4px; flex: 0 0 calc(48px * var(--ui-scale)); width: calc(48px * var(--ui-scale)); min-height: 0; box-sizing: border-box; padding: 8px 4px; border-right: 1px solid var(--border-color); background: var(--bg-secondary); -webkit-app-region: no-drag; }
.app-module-button { display: flex; position: relative; flex-direction: column; align-items: center; justify-content: center; gap: 3px; flex: 0 0 calc(48px * var(--ui-scale)); height: calc(48px * var(--ui-scale)); width: 100%; box-sizing: border-box; padding: 5px 2px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text-secondary); font: inherit; cursor: pointer; }
.app-module-button > span { font-size: calc(10px * var(--ui-scale)); line-height: 1.2; font-weight: 600; letter-spacing: .2px; }
.app-module-button:hover:not(:disabled):not(.active) { background: var(--hover-bg); color: var(--text-primary); }
.app-module-button.active { color: var(--accent); background: var(--accent-bg); }
.app-module-button.active::before { content: ''; position: absolute; left: -4px; top: 10px; bottom: 10px; width: 3px; border-radius: 0 3px 3px 0; background: var(--accent); }
.app-module-button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.app-module-button:disabled { cursor: wait; opacity: .6; }
.workspace { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; overflow: hidden; position: relative; background: transparent; }
</style>
