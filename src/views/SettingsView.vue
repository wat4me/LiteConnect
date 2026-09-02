<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { appConfirm } from '@/composables/app/useAppDialog'
import type { SettingsTabId } from '@/domain/settings/types'
import AppIcon from '../components/icons/AppIcon.vue'
import { useSettingsDraft } from '@/composables/settings/useSettingsDraft'
import { SETTINGS_SEARCH_CATALOG } from '@/composables/settings/settingsSearchCatalog'
import { matchSettingsSearch } from '@/composables/settings/matchSettingsSearch'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'
import SettingsAppearance from '../components/settings/SettingsAppearance.vue'
import SettingsTerminal from '../components/settings/SettingsTerminal.vue'
import SettingsFiles from '../components/settings/SettingsFiles.vue'
import SettingsDatabase from '../components/settings/SettingsDatabase.vue'
import SettingsNetwork from '../components/settings/SettingsNetwork.vue'
import SettingsMcp from '../components/settings/SettingsMcp.vue'
import SettingsShortcuts from '../components/settings/SettingsShortcuts.vue'
import SettingsAbout from '../components/settings/SettingsAbout.vue'

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
  { id: 'about' as const, label: t('settings.tabs.about'), desc: t('settings.tabs.aboutDesc') },
])

const searchQuery = ref('')
const searchFocused = ref(false)
const searchIndex = ref(0)
const searchInputRef = ref<HTMLInputElement | null>(null)
const searchWrapRef = ref<HTMLElement | null>(null)
let highlightTimer = 0

const searchableItems = computed(() => {
  const tabLabel = (id: SettingsTabId) => tabs.value.find((tab) => tab.id === id)?.label || id
  return SETTINGS_SEARCH_CATALOG.map((entry) => ({
    id: entry.id,
    tab: entry.tab,
    title: t(entry.titleKey),
    hint: entry.hintKey ? t(entry.hintKey) : '',
    tabLabel: tabLabel(entry.tab),
    keywords: entry.keywords,
  }))
})

const searchHits = computed(() => matchSettingsSearch(searchableItems.value, searchQuery.value))
const searchOpen = computed(() => searchFocused.value && searchQuery.value.trim().length > 0)

watch(searchQuery, () => {
  searchIndex.value = 0
})

useOutsideDismiss(
  searchOpen,
  () => {
    searchFocused.value = false
  },
  () => [searchWrapRef.value],
)

function closeSearch() {
  searchFocused.value = false
  searchQuery.value = ''
  searchIndex.value = 0
  searchInputRef.value?.blur()
}

function clearSearchQuery() {
  searchQuery.value = ''
  searchIndex.value = 0
  searchFocused.value = true
  searchInputRef.value?.focus()
}

function highlightSetting(id: string) {
  const root = document.querySelector('.settings-main')
  const el = root?.querySelector(`[data-setting="${CSS.escape(id)}"]`) as HTMLElement | null
  if (!el) return
  el.scrollIntoView({ block: id.includes('.') ? 'center' : 'start', behavior: 'smooth' })
  el.classList.add('settings-anchor-hit')
  if (highlightTimer) window.clearTimeout(highlightTimer)
  highlightTimer = window.setTimeout(() => {
    el.classList.remove('settings-anchor-hit')
    highlightTimer = 0
  }, 1600)
}

async function goToSearchHit(id: string, tab: SettingsTab) {
  closeSearch()
  activeTab.value = tab
  await nextTick()
  await nextTick()
  highlightSetting(id)
}

function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closeSearch()
    searchInputRef.value?.blur()
    return
  }
  if (!searchOpen.value || searchHits.value.length === 0) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    searchIndex.value = (searchIndex.value + 1) % searchHits.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    searchIndex.value = (searchIndex.value - 1 + searchHits.value.length) % searchHits.value.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const hit = searchHits.value[searchIndex.value]
    if (hit) void goToSearchHit(hit.id, hit.tab)
  }
}

function onSettingsPageKeydown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f') return
  e.preventDefault()
  searchInputRef.value?.focus()
  searchInputRef.value?.select()
}

onBeforeUnmount(() => {
  if (highlightTimer) window.clearTimeout(highlightTimer)
})

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
  <div class="settings-page" @keydown="onSettingsPageKeydown">
    <div class="settings-shell">
      <aside class="settings-nav">
        <div class="nav-head">
          <h2 class="nav-title">{{ t('settings.title') }}</h2>
          <p class="nav-sub">{{ t('settings.subtitle') }}</p>
        </div>
        <div ref="searchWrapRef" class="nav-search">
          <div class="nav-search-field">
            <input
              ref="searchInputRef"
              v-model="searchQuery"
              class="ui-input ui-input-sm nav-search-input"
              type="text"
              :placeholder="t('settings.searchPlaceholder')"
              :aria-label="t('settings.searchPlaceholder')"
              autocomplete="off"
              @focus="searchFocused = true"
              @input="searchFocused = true"
              @keydown="onSearchKeydown"
            />
            <button
              v-if="searchQuery"
              type="button"
              class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close nav-search-clear"
              :title="t('common.clear')"
              :aria-label="t('common.clear')"
              @mousedown.prevent
              @click="clearSearchQuery"
            >
              <AppIcon name="close" size="xs" />
            </button>
          </div>
          <div v-if="searchOpen" class="nav-search-results" role="listbox">
            <button
              v-for="(hit, index) in searchHits"
              :key="hit.id"
              type="button"
              class="nav-search-hit"
              :class="{ active: index === searchIndex }"
              role="option"
              :aria-selected="index === searchIndex"
              @mousedown.prevent="goToSearchHit(hit.id, hit.tab)"
            >
              <span class="nav-search-hit-title">{{ hit.title }}</span>
              <span class="nav-search-hit-tab">{{ hit.tabLabel }}</span>
            </button>
            <div v-if="searchHits.length === 0" class="nav-search-empty">
              {{ t('settings.searchEmpty') }}
            </div>
          </div>
        </div>
        <nav class="nav-list" :aria-label="t('settings.title')">
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
        </nav>
      </aside>

      <div class="settings-stage">
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
            <SettingsShortcuts v-else-if="activeTab === 'shortcuts'" />
            <SettingsAbout v-else />
          </template>
        </main>

        <footer class="settings-footer">
          <p class="settings-footer-hint">
            <template v-if="isDirty">{{ t('settings.dirtyHint') }}</template>
            <template v-else>{{ t('settings.cleanHint') }}</template>
          </p>
          <div class="settings-footer-actions">
            <button type="button" class="ui-btn ui-btn-sm" :disabled="saving" @click="handleClose">
              {{ t('common.cancel') }}
            </button>
            <button
              type="button"
              class="ui-btn ui-btn-sm"
              :disabled="saving || loading"
              @click="restoreSystemDefaults"
            >
              {{ t('common.restore') }}
            </button>
            <button
              type="button"
              class="ui-btn ui-btn-sm ui-btn-primary"
              :disabled="saving || loading || !isDirty"
              @click="handleSave"
            >
              {{ saving ? t('common.saving') : t('common.save') }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  flex: 1;
  width: 100%;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-primary);
  container-type: inline-size;
  container-name: settings-shell;
}

.settings-shell {
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
}

.settings-nav {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  padding: 20px 12px 16px;
  min-width: 0;
  min-height: 0;
}

.nav-head {
  padding: 0 8px 16px;
  flex-shrink: 0;
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

.nav-search {
  position: relative;
  padding: 0 4px 10px;
  flex-shrink: 0;
}

.nav-search-field {
  position: relative;
}

.nav-search-input {
  width: 100%;
  padding-right: 28px;
}

.nav-search-clear {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  width: 24px !important;
  height: 24px !important;
  border-radius: 6px;
}

.nav-search-results {
  position: absolute;
  left: 4px;
  right: 4px;
  top: calc(100% - 6px);
  z-index: 20;
  max-height: min(320px, 50vh);
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
}

.nav-search-hit {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.nav-search-hit:hover,
.nav-search-hit.active {
  background: var(--accent-bg);
}

.nav-search-hit-title {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
}

.nav-search-hit-tab {
  font-size: 11px;
  color: var(--text-secondary);
}

.nav-search-empty {
  padding: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.nav-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 8px;
}

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  flex-shrink: 0;
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
  white-space: nowrap;
}

.nav-item-desc {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.9;
  line-height: 1.35;
}

.nav-item.active .nav-item-desc {
  color: var(--accent);
  opacity: 0.8;
}

.settings-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
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

.settings-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px 40px 20px 28px;
}

.settings-loading {
  color: var(--text-secondary);
  font-size: 13px;
  padding: 24px 0;
}

.settings-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 28px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.settings-footer-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
  min-width: 0;
}

.settings-footer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}

@container settings-shell (max-width: 980px) {
  .settings-nav {
    width: 168px;
    padding: 16px 8px 12px;
  }

  .nav-sub,
  .nav-item-desc {
    display: none;
  }

  .nav-search {
    padding: 0 2px 8px;
  }

  .nav-item {
    padding: 8px 10px;
  }

  .settings-main {
    padding: 20px 40px 16px 18px;
  }

  .settings-footer {
    padding: 10px 18px;
  }
}

@container settings-shell (max-width: 720px) {
  .settings-shell {
    flex-direction: column;
  }

  .settings-nav {
    width: auto;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    border-right: none;
    border-bottom: 1px solid var(--border-color);
    padding: 8px 44px 0 10px;
  }

  .nav-head {
    display: none;
  }

  .nav-search {
    flex: 1 1 100%;
    padding: 0 0 8px;
  }

  .nav-search-results {
    left: 0;
    right: 0;
  }

  .nav-list {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 8px;
    gap: 4px;
    flex: 1 1 100%;
  }

  .nav-item {
    width: auto;
    padding: 7px 12px;
  }

  .settings-close-btn {
    top: 8px;
    right: 8px;
  }

  .settings-main {
    padding: 16px 16px 12px;
  }

  .settings-footer {
    flex-wrap: wrap;
    padding: 8px 16px 10px;
  }

  .settings-footer-hint {
    flex: 1 1 100%;
  }

  .settings-footer-actions {
    margin-left: auto;
  }
}

@container settings-shell (max-width: 480px) {
  .settings-footer-actions {
    width: 100%;
  }

  .settings-footer-actions .ui-btn {
    flex: 1;
  }
}
</style>
