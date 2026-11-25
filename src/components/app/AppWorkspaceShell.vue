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
  { id: 'mcp', label: 'MCP', name: 'settingsMcp.title', icon: 'plug' },
] as const
</script>

<template>
  <div class="app-shell" :class="{ 'with-module-rail': showModules }">
    <nav v-if="showModules" class="app-module-rail" data-onboarding="module-rail" :aria-label="t('app.modulesAria')">
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
.app-shell {
  --workspace-inset: 6px;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  z-index: 1;
  overflow: hidden;
  padding: 4px var(--workspace-inset) var(--workspace-inset);
  background: var(--app-shell-background, var(--bg-secondary));
}
.app-shell.with-module-rail { padding-inline-start: 0; }
.app-module-rail { display: flex; flex-direction: column; align-items: stretch; gap: 4px; flex: 0 0 calc(48px * var(--ui-scale)); width: calc(48px * var(--ui-scale)); min-height: 0; box-sizing: border-box; padding: 4px 5px; -webkit-app-region: no-drag; }
.app-module-button { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; flex: 0 0 calc(48px * var(--ui-scale)); height: calc(48px * var(--ui-scale)); width: 100%; box-sizing: border-box; padding: 5px 2px; border: 1px solid transparent; border-radius: var(--radius-lg); background: transparent; color: var(--icon-button-color, var(--text-secondary)); font: inherit; cursor: pointer; transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease; }
.app-module-button > span { font-size: calc(max(10px, 10px * var(--ui-font-scale)) + var(--small-text-adjustment)); line-height: 1.2; font-weight: 600; letter-spacing: .2px; }
.app-module-button:hover:not(:disabled):not(.active) { background: var(--tab-hover-surface); color: var(--text-primary); }
.app-module-button.active {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--text-primary) 16%, var(--bg-secondary));
  border-color: color-mix(in srgb, var(--text-primary) 36%, var(--bg-secondary));
}
.app-module-button.active > span { font-weight: 700; }
.app-module-button.active::before {
  content: '';
  position: absolute;
  inset-block: 18%;
  inset-inline-start: -5px;
  border-inline-start: 3px solid color-mix(in srgb, var(--accent) 60%, var(--text-primary));
  border-radius: 3px;
  pointer-events: none;
}
@media (forced-colors: active) {
  .app-module-button.active, .app-module-button.active::before { border-color: Highlight; }
}
.app-module-button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.app-module-button:disabled { cursor: wait; opacity: .6; }
.workspace {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
  border: 1px solid var(--window-edge);
  border-radius: var(--radius-window);
  box-shadow: var(--window-shadow);
}
</style>
