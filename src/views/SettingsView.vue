<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { appConfirm } from '@/composables/app/useAppDialog'
import type { SettingsTabId } from '@/composables/app/useAppNavigation'
import AppIcon from '../components/icons/AppIcon.vue'
import { useSettingsDraft } from '@/composables/settings/useSettingsDraft'
import SettingsAppearance from '../components/settings/SettingsAppearance.vue'
import SettingsTerminal from '../components/settings/SettingsTerminal.vue'
import SettingsFiles from '../components/settings/SettingsFiles.vue'
import SettingsDatabase from '../components/settings/SettingsDatabase.vue'
import SettingsNetwork from '../components/settings/SettingsNetwork.vue'
import SettingsMcp from '../components/settings/SettingsMcp.vue'
import SettingsShortcuts from '../components/settings/SettingsShortcuts.vue'

const props = defineProps<{
  /** Open a specific tab (e.g. deep-link from X11 install prompt). */
  initialTab?: SettingsTabId
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()

type SettingsTab = SettingsTabId

const {
  draft,
  saved,
  loading,
  saving,
  recentDownloadPaths,
  systemDefaultDownloadPath,
  isDirty,
  handleSave,
  restoreSystemDefaults,
  cloneDraft,
} = useSettingsDraft()

const activeTab = ref<SettingsTab>(props.initialTab || 'appearance')

watch(
  () => props.initialTab,
  (tab) => {
    if (tab) activeTab.value = tab
  },
)

const tabs = computed(() => [
  { id: 'appearance' as const, label: t('settings.tabs.appearance'), desc: t('settings.tabs.appearanceDesc') },
  { id: 'terminal' as const, label: t('settings.tabs.terminal'), desc: t('settings.tabs.terminalDesc') },
  { id: 'files' as const, label: t('settings.tabs.files'), desc: t('settings.tabs.filesDesc') },
  { id: 'database' as const, label: t('settings.tabs.database'), desc: t('settings.tabs.databaseDesc') },
  { id: 'network' as const, label: t('settings.tabs.network'), desc: t('settings.tabs.networkDesc') },
  { id: 'mcp' as const, label: t('settings.tabs.mcp'), desc: t('settings.tabs.mcpDesc') },
  { id: 'shortcuts' as const, label: t('settings.tabs.shortcuts'), desc: t('settings.tabs.shortcutsDesc') },
])

async function handleClose() {
  if (!isDirty.value) {
    emit('close')
    return
  }
  try {
    await appConfirm({
      title: t('settings.unsavedTitle'),
      message: t('settings.unsavedMessage'),
      confirmText: t('common.discardAndClose'),
      cancelText: t('common.continueEdit'),
      tone: 'warning',
      danger: true,
    })
    draft.value = cloneDraft(saved.value)
    // Revert live previews if user discarded
    window.dispatchEvent(
      new CustomEvent('fancy-cursor-settings-change', {
        detail: {
          enabled: saved.value.fancyCursorEnabled,
          style: saved.value.fancyCursorStyle,
        },
      }),
    )
    // Re-apply saved wallpaper (import applyAppBackground lazily via event consumed in App)
    window.dispatchEvent(
      new CustomEvent('app-background-settings-change', {
        detail: {
          imageUrl: saved.value.appBackground.cleared ? '' : saved.value.appBackground.imageUrl,
          fit: saved.value.appBackground.fit,
          overlay: saved.value.appBackground.overlay,
        },
      }),
    )
    emit('close')
  } catch {
    // stay on settings
  }
}

defineExpose({ requestClose: handleClose })
</script>

<template>
  <div class="settings-page">
    <button
      type="button"
      class="settings-close-btn"
      :title="t('common.close')"
      :aria-label="t('app.closeSettings')"
      :disabled="saving"
      @click="handleClose"
    >
      <AppIcon name="close" size="sm" />
    </button>
    <aside class="settings-nav">
      <div class="nav-head">
        <h2 class="nav-title">{{ t('settings.title') }}</h2>
        <p class="nav-sub">{{ t('settings.subtitle') }}</p>
      </div>
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="nav-item"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        <span class="nav-item-label">{{ tab.label }}</span>
        <span class="nav-item-desc">{{ tab.desc }}</span>
      </button>
      <div class="nav-footer">
        <p class="nav-footer-hint">
          <template v-if="isDirty">{{ t('settings.dirtyHint') }}</template>
          <template v-else>{{ t('settings.cleanHint') }}</template>
        </p>
        <div class="nav-footer-actions">
          <button type="button" class="ui-btn" :disabled="saving" @click="handleClose">{{ t('common.cancel') }}</button>
          <button
            type="button"
            class="ui-btn"
            :disabled="saving || loading"
            @click="restoreSystemDefaults"
          >
            {{ t('common.restore') }}
          </button>
          <button
            type="button"
            class="ui-btn ui-btn-primary"
            :disabled="saving || loading || !isDirty"
            @click="handleSave"
          >
            {{ saving ? t('common.saving') : t('common.save') }}
          </button>
        </div>
      </div>
    </aside>

    <main class="settings-main">
      <div v-if="loading" class="settings-loading">{{ t('settings.loading') }}</div>

      <template v-else>
        <SettingsAppearance
          v-if="activeTab === 'appearance'"
          :draft="draft"
          :is-dirty="isDirty"
        />
        <SettingsTerminal
          v-else-if="activeTab === 'terminal'"
          :draft="draft"
          :is-dirty="isDirty"
        />
        <SettingsFiles
          v-else-if="activeTab === 'files'"
          :draft="draft"
          :recent-download-paths="recentDownloadPaths"
          :system-default-download-path="systemDefaultDownloadPath"
        />
        <SettingsDatabase
          v-else-if="activeTab === 'database'"
          :draft="draft"
          :is-dirty="isDirty"
        />
        <SettingsNetwork
          v-else-if="activeTab === 'network'"
          :draft="draft"
        />
        <SettingsMcp v-else-if="activeTab === 'mcp'" />
        <SettingsShortcuts v-else />
      </template>
    </main>
  </div>
</template>

<style scoped>
.settings-page {
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-primary);
  position: relative;
}

.settings-close-btn {
  position: absolute;
  top: 12px;
  right: 14px;
  z-index: 5;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.settings-close-btn:hover:not(:disabled) {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.settings-close-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.settings-nav {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  padding: 20px 14px;
  gap: 4px;
}

.nav-head {
  padding: 0 8px 16px;
}

.nav-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.nav-sub {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.nav-item:hover {
  background: var(--hover-bg);
}

.nav-item.active {
  background: var(--accent-bg);
  color: var(--accent);
}

.nav-item-label {
  font-size: 13px;
  font-weight: 600;
}

.nav-item-desc {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.9;
}

.nav-item.active .nav-item-desc {
  color: var(--accent);
  opacity: 0.8;
}

.nav-footer {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 16px;
}

.nav-footer-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
  padding: 0 4px;
  min-height: 2.8em;
}

.nav-footer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.nav-footer-actions .ui-btn {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  padding: 6px 8px;
}

.settings-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 28px 32px 48px;
}

.settings-loading {
  color: var(--text-secondary);
  font-size: 13px;
  padding: 24px 0;
}

@media (max-width: 900px) {
  .settings-nav {
    width: 200px;
  }
}
</style>
