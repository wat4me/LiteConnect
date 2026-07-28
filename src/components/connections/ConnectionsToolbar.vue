<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{
  activeGroupName: string
  searchQuery: string
  batchTesting: boolean
  filteredCount: number
  importing: boolean
}>()

const emit = defineEmits<{
  (e: 'update:searchQuery', value: string): void
  (e: 'batch-test'): void
  (e: 'import'): void
  (e: 'export'): void
  (e: 'credentials'): void
  (e: 'add'): void
}>()

const { t } = useI18n()
const searchInputRef = ref<HTMLInputElement | null>(null)

defineExpose({ searchInputRef })
</script>

<template>
  <header class="page-header">
    <div class="page-title-row">
      <h2 class="page-title">{{ t('connections.title') }}</h2>
      <span class="page-group-pill">{{ props.activeGroupName }}</span>
    </div>
    <div class="page-toolbar">
      <div class="search-box">
        <AppIcon name="search" size="sm" class="search-icon" />
        <input
          ref="searchInputRef"
          :value="props.searchQuery"
          :placeholder="t('connections.searchPlaceholder')"
          class="search-input"
          :aria-label="t('connections.searchAria')"
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
        <el-tooltip :content="t('connections.batchTestTooltip')" placement="bottom">
          <button
            class="ui-btn"
            type="button"
            :disabled="props.batchTesting || props.filteredCount === 0"
            @click="emit('batch-test')"
          >
            {{ props.batchTesting ? t('connections.batchTesting') : t('connections.batchTest') }}
          </button>
        </el-tooltip>
        <el-tooltip :content="t('connections.import')" placement="bottom">
          <button
            class="ui-icon-btn ui-icon-btn-ghost"
            type="button"
            :disabled="props.importing"
            :aria-label="t('connections.import')"
            @click="emit('import')"
          >
            <AppIcon name="download" size="md" />
          </button>
        </el-tooltip>
        <el-tooltip :content="t('connections.export')" placement="bottom">
          <button
            class="ui-icon-btn ui-icon-btn-ghost"
            type="button"
            :aria-label="t('connections.export')"
            @click="emit('export')"
          >
            <AppIcon name="upload" size="md" />
          </button>
        </el-tooltip>
        <button
          class="ui-btn"
          type="button"
          :title="t('connections.credentialsTitle')"
          @click="emit('credentials')"
        >
          {{ t('connections.credentials') }}
        </button>
        <button class="ui-btn ui-btn-primary" type="button" @click="emit('add')">
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
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.page-group-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 12px;
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

.search-box {
  position: relative;
  flex: 1;
  min-width: 200px;
  max-width: 420px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-secondary);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 9px 32px 9px 36px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-bg);
}

.search-input::placeholder {
  color: var(--text-secondary);
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
