<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { StructureTab } from './types'
import { keyBadge } from './dbFormat'

const { t } = useI18n()

withDefaults(
  defineProps<{
    tab: StructureTab
    connectionName: string
    connectionMeta: string
    hideBreadcrumb?: boolean
  }>(),
  { hideBreadcrumb: false },
)

const emit = defineEmits<{
  refresh: []
}>()
</script>

<template>
  <div class="struct-view">
    <div class="table-view-bar">
      <div v-if="!hideBreadcrumb" class="breadcrumb">
        <span class="bc-conn" :title="connectionMeta">{{ connectionName }}</span>
        <span class="sep">/</span>
        <span>{{ tab.database }}</span>
        <span class="sep">/</span>
        <strong>{{ tab.table }}</strong>
        <span class="tag">{{ t('database.structure.tag') }}</span>
      </div>
      <div v-else class="breadcrumb">
        <span class="tag">{{ t('database.structure.tagDetail') }}</span>
      </div>
      <button type="button" class="ui-btn ui-btn-sm" :disabled="tab.loading" @click="emit('refresh')">{{ t('database.structure.refresh') }}</button>
    </div>
    <div v-if="tab.loading" class="grid-empty">{{ t('database.structure.loading') }}</div>
    <div v-else-if="tab.error" class="err-panel">{{ tab.error }}</div>
    <template v-else>
      <div class="struct-block">
        <h4>{{ t('database.structure.columns') }}</h4>
        <div class="grid-scroll struct-scroll">
          <table class="sheet">
            <thead>
              <tr>
                <th>{{ t('database.structure.colName') }}</th>
                <th>{{ t('database.structure.colType') }}</th>
                <th>{{ t('database.structure.colNullable') }}</th>
                <th>{{ t('database.structure.colKey') }}</th>
                <th>{{ t('database.structure.colDefault') }}</th>
                <th>{{ t('database.structure.colExtra') }}</th>
                <th>{{ t('database.structure.colComment') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="col in tab.columns" :key="col.name">
                <td class="col-name">
                  {{ col.name }}
                  <span v-if="keyBadge(col.key)" class="pk">{{ keyBadge(col.key) }}</span>
                </td>
                <td>{{ col.type }}</td>
                <td>{{ col.nullable ? 'YES' : 'NO' }}</td>
                <td>{{ col.key }}</td>
                <td :class="{ nul: col.defaultValue === null }">
                  {{ col.defaultValue === null ? 'NULL' : col.defaultValue }}
                </td>
                <td>{{ col.extra }}</td>
                <td>{{ col.comment }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="struct-block">
        <h4>{{ t('database.structure.indexes') }}</h4>
        <div v-if="!tab.indexes?.length" class="grid-empty small">{{ t('database.structure.noIndexes') }}</div>
        <div v-else class="grid-scroll struct-scroll">
          <table class="sheet">
            <thead>
              <tr>
                <th>{{ t('database.structure.idxName') }}</th>
                <th>{{ t('database.structure.idxColumns') }}</th>
                <th>{{ t('database.structure.idxType') }}</th>
                <th>{{ t('database.structure.idxUnique') }}</th>
                <th>{{ t('database.structure.idxPrimary') }}</th>
                <th>{{ t('database.structure.idxComment') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="idx in tab.indexes" :key="idx.name">
                <td class="col-name">{{ idx.name }}</td>
                <td>{{ idx.columns.join(', ') }}</td>
                <td>{{ idx.type }}</td>
                <td>{{ idx.unique ? 'YES' : '' }}</td>
                <td>{{ idx.primary ? 'YES' : '' }}</td>
                <td>{{ idx.comment }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="struct-block">
        <h4>{{ t('database.structure.createSql') }}</h4>
        <pre class="ddl">{{ tab.createSql || '—' }}</pre>
      </div>
    </template>
  </div>
</template>

<style scoped>
.struct-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  overflow: auto;
}

.table-view-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  min-width: 0;
  flex-wrap: wrap;
}

.breadcrumb .bc-conn {
  font-weight: 600;
  color: var(--accent);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.breadcrumb strong {
  color: var(--text-primary);
}

.breadcrumb .sep {
  opacity: 0.5;
}

.breadcrumb .tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-bg);
  color: var(--accent);
}

.struct-block {
  padding: 12px;
}

.struct-block h4 {
  margin: 0 0 8px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.grid-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.struct-scroll {
  max-height: 280px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.sheet {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-family: var(--font-mono, Consolas, monospace);
}

.sheet th,
.sheet td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--border-color);
  text-align: left;
  white-space: nowrap;
}

.sheet th {
  background: var(--bg-secondary);
  position: sticky;
  top: 0;
  z-index: 1;
  font-weight: 600;
}

.col-name {
  font-weight: 600;
  color: var(--text-primary);
}

.pk {
  margin-left: 4px;
  font-size: 10px;
  color: var(--accent);
}

.nul {
  opacity: 0.5;
  font-style: italic;
}

.ddl {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  font-size: 12px;
  line-height: 1.45;
  overflow: auto;
  white-space: pre-wrap;
  font-family: var(--font-mono, Consolas, monospace);
}

.grid-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary);
}

.grid-empty.small {
  padding: 12px;
  font-size: 12px;
}

.err-panel {
  padding: 12px 16px;
  color: var(--danger);
  white-space: pre-wrap;
}
</style>
