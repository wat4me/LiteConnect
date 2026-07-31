<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DataTab, StructureTab } from '@/domain/database/types'
import type { SqlDialect } from '@/utils/database/dbSql'
import DbDataTab from './DbDataTab.vue'
import DbStructureTab from './DbStructureTab.vue'
import AppIcon from '../icons/AppIcon.vue'

const { t } = useI18n()

const props = defineProps<{
  tab: DataTab
  connectionName: string
  connectionMeta: string
  dialect?: SqlDialect
}>()

const emit = defineEmits<{
  setPanel: [panel: 'data' | 'structure']
  sort: [col: string]
  pageDelta: [delta: number]
  jumpPage: [raw: string | number]
  pageSize: [size: number]
  refresh: []
  refreshStructure: []
  startInsert: []
  saveDirty: []
  discardDirty: []
  deleteSelected: []
  copyResult: []
  exportCsv: []
  exportJson: []
  exportAll: []
  whereFilter: [value: string]
  toggleSelect: [rowIndex: number]
  startEdit: [rowIndex: number, col: string]
  editKeydown: [e: KeyboardEvent]
  editBlur: []
  setInsertCell: [col: string, value: string]
  saveInsert: []
  cancelInsert: []
}>()

const structureTab = computed((): StructureTab => ({
  id: props.tab.id,
  kind: 'structure',
  connectionId: props.tab.connectionId,
  title: props.tab.title,
  database: props.tab.database,
  table: props.tab.table,
  loading: props.tab.structureLoading,
  error: props.tab.structureError,
  columns: props.tab.columnsMeta,
  indexes: props.tab.indexes,
  createSql: props.tab.createSql,
}))
</script>

<template>
  <div class="table-workspace">
    <div class="table-panel-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="panel-tab"
        :class="{ active: tab.panel === 'data' }"
        :aria-selected="tab.panel === 'data'"
        @click="emit('setPanel', 'data')"
      >
        <AppIcon name="table" size="xs" />
        {{ t('database.data.panelData') }}
      </button>
      <button
        type="button"
        role="tab"
        class="panel-tab"
        :class="{ active: tab.panel === 'structure' }"
        :aria-selected="tab.panel === 'structure'"
        @click="emit('setPanel', 'structure')"
      >
        <AppIcon name="columns" size="xs" />
        {{ t('database.data.panelStructure') }}
      </button>
      <span class="panel-path" :title="connectionMeta">
        {{ connectionName }} / {{ tab.database }} / <strong>{{ tab.table }}</strong>
      </span>
    </div>

    <DbDataTab
      v-if="tab.panel === 'data'"
      :tab="tab"
      :connection-name="connectionName"
      :connection-meta="connectionMeta"
      :dialect="dialect"
      :hide-breadcrumb="true"
      @sort="emit('sort', $event)"
      @page-delta="emit('pageDelta', $event)"
      @jump-page="emit('jumpPage', $event)"
      @page-size="emit('pageSize', $event)"
      @refresh="emit('refresh')"
      @start-insert="emit('startInsert')"
      @save-dirty="emit('saveDirty')"
      @discard-dirty="emit('discardDirty')"
      @delete-selected="emit('deleteSelected')"
      @copy-result="emit('copyResult')"
      @export-csv="emit('exportCsv')"
      @export-json="emit('exportJson')"
      @export-all="emit('exportAll')"
      @where-filter="emit('whereFilter', $event)"
      @toggle-select="emit('toggleSelect', $event)"
      @start-edit="(r, c) => emit('startEdit', r, c)"
      @edit-keydown="emit('editKeydown', $event)"
      @edit-blur="emit('editBlur')"
      @set-insert-cell="(c, v) => emit('setInsertCell', c, v)"
      @save-insert="emit('saveInsert')"
      @cancel-insert="emit('cancelInsert')"
    />

    <DbStructureTab
      v-else
      :tab="structureTab"
      :connection-name="connectionName"
      :connection-meta="connectionMeta"
      :hide-breadcrumb="true"
      @refresh="emit('refreshStructure')"
    />
  </div>
</template>

<style scoped>
.table-workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.table-panel-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  height: 30px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.panel-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 10px;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.panel-tab:hover {
  color: var(--text-primary);
}

.panel-tab.active {
  color: var(--accent);
}

.panel-tab.active::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--accent);
}

.panel-path {
  margin-left: 10px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-secondary);
}

.panel-path strong {
  color: var(--text-primary);
  font-weight: 600;
}
</style>
