<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon, { type AppIconName } from '../icons/AppIcon.vue'
import ToolbarDropdown from '../common/ToolbarDropdown.vue'

const props = defineProps<{
  activeGroupName: string
  headingIcon?: AppIconName
  searchQuery: string
  searchScope: 'group' | 'all'
  inSmartView?: boolean
  batchTesting: boolean
  filteredCount: number
  totalCount?: number
  importing: boolean
  filtersActive?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:searchQuery', value: string): void
  (e: 'batch-test'): void
  (e: 'import'): void
  (e: 'export'): void
  (e: 'credentials'): void
  (e: 'add'): void
  (e: 'clear-filters'): void
}>()

const { t } = useI18n()
const searchInputRef = ref<HTMLInputElement | null>(null)
const resultSummary = computed(() => {
  const total = props.totalCount ?? props.filteredCount
  return props.searchQuery.trim() || props.filteredCount !== total
    ? t('connections.resultCount', { shown: props.filteredCount, total })
    : t('connections.connectionCount', { count: total })
})
const actionItems = computed(() => [
  { id: 'batch-test', label: t(props.batchTesting ? 'connections.batchTesting' : 'connections.batchTest'), icon: 'connection-test' as const, title: t('connections.batchTestTooltip'), disabled: props.batchTesting || props.filteredCount === 0 },
  { id: 'credentials', label: t('connections.credentials'), icon: 'key' as const, title: t('connections.credentialsTitle') },
  { id: 'import', label: t('connections.import'), icon: 'download' as const, title: t('connections.importTooltip'), disabled: props.importing },
  { id: 'export', label: t('connections.export'), icon: 'upload' as const, title: t('connections.exportTooltip') },
])
function onAction(id: string) {
  if (id === 'batch-test') emit('batch-test')
  else if (id === 'credentials') emit('credentials')
  else if (id === 'import') emit('import')
  else if (id === 'export') emit('export')
}

defineExpose({ searchInputRef })
</script>

<template>
  <header class="page-header">
    <div class="page-heading">
      <div class="page-title-row">
        <AppIcon :name="headingIcon || 'folder'" size="md" class="page-heading-icon" />
        <h2 class="page-title" :title="activeGroupName">{{ activeGroupName }}</h2>
        <span class="page-result-count">{{ resultSummary }}</span>
        <button v-if="filtersActive" type="button" class="clear-filters" @click="emit('clear-filters')">{{ t('connections.clearFilters') }}</button>
      </div>
      <div class="toolbar-actions">
        <ToolbarDropdown
          class="toolbar-more" :label="t('connections.tools')" :aria-label="t('connections.tools')"
          :items="actionItems" align="right" trigger-class="toolbar-more-button" menu-class="toolbar-menu" teleport
          @select="onAction"
        />
        <button class="ui-btn ui-btn-primary" type="button" data-onboarding="add-connection" @click="emit('add')">
          <AppIcon name="plus" size="sm" />
          <span>{{ t('connections.newConnection') }}</span>
        </button>
      </div>
    </div>
    <div class="page-toolbar">
      <div class="search-box">
        <AppIcon name="search" size="sm" class="search-icon" />
        <input
          ref="searchInputRef" :value="searchQuery"
          :placeholder="t(!inSmartView && searchScope === 'all' ? 'connections.searchAllPlaceholder' : 'connections.searchPlaceholder')"
          class="ui-input search-input" :aria-label="t('connections.searchAria')" :title="t('connections.searchKeyboardHint')"
          @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
        />
        <button
          v-if="searchQuery" type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close search-clear"
          :title="t('connections.clearSearch')" :aria-label="t('connections.clearSearch')" @click="emit('update:searchQuery', '')"
        ><AppIcon name="close" size="xs" /></button>
      </div>
      <slot name="filters" />
    </div>
  </header>
</template>

<style scoped>
.page-header { flex-shrink: 0; display: flex; flex-direction: column; gap: 12px; margin-bottom: 10px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color); min-width: 0; }
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
.page-title-row { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 1; }
.page-heading-icon { flex-shrink: 0; align-self: center; color: var(--text-secondary); }
.page-title { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.4; color: var(--text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-result-count { flex-shrink: 0; font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
.clear-filters { flex-shrink: 0; display: inline-flex; align-items: center; min-height: 24px; padding: 2px 4px; border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 12px; line-height: 1.4; white-space: nowrap; cursor: pointer; }
.clear-filters:hover { text-decoration: underline; }
.clear-filters:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
.page-toolbar { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.search-box { position: relative; flex: 1 1 220px; min-width: min(200px, 100%); }
.search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-secondary); pointer-events: none; }
.search-box .search-input { padding-left: 36px; padding-right: 32px; }
.search-clear { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 24px !important; height: 24px !important; }
.toolbar-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.toolbar-actions .ui-btn { display: inline-flex; align-items: center; gap: 6px; }
@media (max-width: 760px) {
  .page-heading { flex-wrap: wrap; }
  .page-title-row { flex-basis: 100%; }
  .toolbar-actions { margin-left: auto; }
}
</style>
