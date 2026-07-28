<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { NavMenu } from './types'
import { fitFixedElement } from '../../utils/popupPosition'
import { useOutsideDismiss } from '../../composables/useOutsideDismiss'

const { t } = useI18n()

const props = defineProps<{
  menu: NavMenu
  isConnActive: (id: string) => boolean
}>()

const emit = defineEmits<{
  dismiss: []
  connConnect: []
  connDisconnect: []
  connRefresh: []
  connCopyHost: []
  connEdit: []
  connDelete: []
  connCreateDatabase: []
  dbNewQuery: []
  dbRefresh: []
  dbCopyName: []
  tableViewData: []
  tableStructure: []
  tableSelect: []
  tableCount: []
  tableDescribe: []
  tableCopyName: []
  tableCopyQualified: []
  tableCopySelect: []
}>()

const menuRef = ref<HTMLElement | null>(null)
const left = ref(props.menu.x)
const top = ref(props.menu.y)

useOutsideDismiss(
  () => true,
  () => emit('dismiss'),
  () => [menuRef.value],
)

async function reposition() {
  left.value = props.menu.x
  top.value = props.menu.y
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  const el = menuRef.value
  if (!el) return
  const pos = fitFixedElement(el, { x: props.menu.x, y: props.menu.y })
  left.value = pos.left
  top.value = pos.top
}

watch(
  () => [props.menu.kind, props.menu.x, props.menu.y] as const,
  () => {
    void reposition()
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <div
      ref="menuRef"
      class="ctx"
      :style="{ left: left + 'px', top: top + 'px' }"
      @click.stop
    >
      <template v-if="menu.kind === 'conn'">
        <div class="ctx-title">{{ menu.conn.name }}</div>
        <button type="button" @click="emit('connCreateDatabase')">
          {{
            menu.conn.engine === 'oracle'
              ? t('database.menu.createSchemaOracle')
              : t('database.menu.createDatabase')
          }}
        </button>
        <button type="button" @click="emit('connEdit')">{{ t('database.menu.editConnection') }}</button>
        <button type="button" @click="emit('connConnect')">
          {{ isConnActive(menu.conn.id) ? t('database.menu.reconnect') : t('database.menu.connectExpand') }}
        </button>
        <button v-if="isConnActive(menu.conn.id)" type="button" @click="emit('connDisconnect')">{{ t('database.menu.disconnect') }}</button>
        <button type="button" @click="emit('connRefresh')">{{ t('database.menu.refreshDatabases') }}</button>
        <div class="ctx-sep" role="separator"></div>
        <button type="button" @click="emit('connCopyHost')">{{ t('database.menu.copyHost') }}</button>
        <button type="button" class="danger" @click="emit('connDelete')">{{ t('database.menu.deleteConnection') }}</button>
      </template>

      <template v-else-if="menu.kind === 'db'">
        <button type="button" class="ctx-primary" @click="emit('dbNewQuery')">{{ t('database.menu.newQuery') }}</button>
        <div class="ctx-hint">{{ t('database.menu.useDatabaseHint', { database: menu.database }) }}</div>
        <div class="ctx-sep" role="separator"></div>
        <button type="button" @click="emit('dbRefresh')">{{ t('database.menu.refreshTables') }}</button>
        <div class="ctx-sep" role="separator"></div>
        <button type="button" @click="emit('dbCopyName')">{{ t('database.menu.copyDbName') }}</button>
      </template>

      <template v-else-if="menu.kind === 'table'">
        <div class="ctx-title">{{ menu.database }}.{{ menu.table.name }}</div>
        <button type="button" @click="emit('tableViewData')">{{ t('database.menu.viewData') }}</button>
        <button type="button" @click="emit('tableStructure')">{{ t('database.menu.viewStructure') }}</button>
        <div class="ctx-sep" role="separator"></div>
        <button type="button" @click="emit('tableSelect')">SELECT * … LIMIT 100</button>
        <button type="button" @click="emit('tableCount')">SELECT COUNT(*)</button>
        <button type="button" @click="emit('tableDescribe')">SHOW FULL COLUMNS</button>
        <div class="ctx-sep" role="separator"></div>
        <button type="button" @click="emit('tableCopyName')">{{ t('database.menu.copyTableName') }}</button>
        <button type="button" @click="emit('tableCopyQualified')">{{ t('database.menu.copyQualified') }}</button>
        <button type="button" @click="emit('tableCopySelect')">{{ t('database.menu.copySelect') }}</button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx {
  position: fixed;
  z-index: 3000;
  min-width: 200px;
  max-width: 280px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 8px);
  background: var(--bg-secondary);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
}

.ctx-title {
  padding: 4px 10px 8px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 4px;
}

.ctx-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border-color);
}

.ctx button {
  border: none;
  background: none;
  text-align: left;
  padding: 7px 10px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  cursor: pointer;
}

.ctx button:hover {
  background: var(--accent-bg);
  color: var(--accent);
}

.ctx button.danger {
  color: var(--danger);
}

.ctx button.danger:hover {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.ctx button.ctx-primary {
  font-weight: 700;
  color: var(--accent);
}

.ctx button.ctx-primary:hover {
  background: var(--accent-bg);
  color: var(--accent);
}

.ctx-hint {
  padding: 0 10px 6px;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.35;
}
</style>
