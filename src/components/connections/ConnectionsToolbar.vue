<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'
import ToolbarDropdown from '../common/ToolbarDropdown.vue'

const props = defineProps<{
  activeGroupName: string
  searchQuery: string
  searchScope: 'group' | 'all'
  batchTesting: boolean
  filteredCount: number
  importing: boolean
}>()

const emit = defineEmits<{
  (e: 'update:searchQuery', value: string): void
  (e: 'update:searchScope', value: 'group' | 'all'): void
  (e: 'batch-test'): void
  (e: 'import'): void
  (e: 'export'): void
  (e: 'credentials'): void
  (e: 'add'): void
}>()

const { t } = useI18n()
const searchInputRef = ref<HTMLInputElement | null>(null)
const scopeItems = computed(() => [
  { id: 'group', label: t('connections.searchCurrentGroup') },
  { id: 'all', label: t('connections.allConnections') },
])
const actionItems = computed(() => [
  { id: 'batch-test', label: t(props.batchTesting ? 'connections.batchTesting' : 'connections.batchTest'), title: t('connections.batchTestTooltip'), disabled: props.batchTesting || props.filteredCount === 0 },
  { id: 'import', label: t('connections.import'), title: t('connections.importTooltip'), disabled: props.importing },
  { id: 'export', label: t('connections.export'), title: t('connections.exportTooltip') },
])
function onAction(id: string) {
  if (id === 'batch-test') emit('batch-test')
  else if (id === 'import') emit('import')
  else if (id === 'export') emit('export')
}

defineExpose({ searchInputRef })
</script>

<template>
  <header class="page-header">
    <div class="page-title-row">
      <h2 class="page-title">{{ t('connections.title') }}</h2>
      <span v-if="props.searchScope === 'group'" class="page-group-pill" :title="props.activeGroupName">{{ props.activeGroupName }}</span>
    </div>
    <div class="page-toolbar">
      <ToolbarDropdown
        class="search-scope" :model-value="props.searchScope" :items="scopeItems"
        :label="t(props.searchScope === 'group' ? 'connections.searchCurrentGroup' : 'connections.allConnections')"
        :aria-label="t('connections.searchScope')" menu-class="scope-menu"
        @select="emit('update:searchScope', $event as 'group' | 'all')"
      />
      <div class="search-box">
        <AppIcon name="search" size="sm" class="search-icon" />
        <input
          ref="searchInputRef"
          :value="props.searchQuery"
          :placeholder="t('connections.searchPlaceholder')"
          class="ui-input search-input"
          :aria-label="t('connections.searchAria')"
          :title="t('connections.searchKeyboardHint')"
          @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
        />
        <button
          v-if="props.searchQuery"
          type="button"
          class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close search-clear"
          :title="t('connections.clearSearch')"
          @click="emit('update:searchQuery', '')"
        >
          <AppIcon name="close" size="xs" />
        </button>
      </div>
      <div class="toolbar-actions">
        <ToolbarDropdown
          class="toolbar-more" :label="t('connections.more')" :aria-label="t('connections.moreAria')"
          :items="actionItems" align="right" trigger-class="toolbar-more-button" menu-class="toolbar-menu"
          @select="onAction"
        />
        <button
          class="ui-btn"
          type="button"
          :title="t('connections.credentialsTitle')"
          @click="emit('credentials')"
        >
          {{ t('connections.credentials') }}
        </button>
        <button
          class="ui-btn ui-btn-primary"
          type="button"
          data-onboarding="add-connection"
          @click="emit('add')"
        >
          <AppIcon name="plus" size="sm" />
          <span>{{ t('connections.new') }}</span>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.page-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.page-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-shrink: 0;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text-primary);
}

.page-group-pill {
  display: block;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 20px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.search-scope {
  width: auto;
  max-width: 150px;
  flex-shrink: 0;
}

.search-box {
  position: relative;
  flex: 1;
  min-width: 200px;
  max-width: 560px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-secondary);
  pointer-events: none;
}

.search-box .search-input {
  padding-left: 36px;
  padding-right: 32px;
}

.search-clear {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px !important;
  height: 24px !important;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.toolbar-actions .ui-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}


@media (max-width: 900px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .page-toolbar {
    justify-content: stretch;
  }

  .search-box {
    max-width: none;
    flex: 1;
  }

  .toolbar-actions {
    justify-content: flex-end;
  }
}
</style>
