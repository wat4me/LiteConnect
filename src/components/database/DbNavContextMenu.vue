<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { NavMenu } from '@/domain/database/types'
import { fitFixedElement } from '@/utils/shared/popupPosition'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'

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
      class="ui-menu"
      :style="{ left: left + 'px', top: top + 'px' }"
      @click.stop
    >
      <template v-if="menu.kind === 'conn'">
        <div class="ui-menu-title">{{ menu.conn.name }}</div>
        <button type="button" class="ui-menu-item" @click="emit('connCreateDatabase')">
          {{
            menu.conn.engine === 'oracle'
              ? t('database.menu.createSchemaOracle')
              : t('database.menu.createDatabase')
          }}
        </button>
        <button type="button" class="ui-menu-item" @click="emit('connEdit')">{{ t('database.menu.editConnection') }}</button>
        <button type="button" class="ui-menu-item" @click="emit('connConnect')">
          {{ isConnActive(menu.conn.id) ? t('database.menu.reconnect') : t('database.menu.connectExpand') }}
        </button>
        <button v-if="isConnActive(menu.conn.id)" type="button" class="ui-menu-item" @click="emit('connDisconnect')">{{ t('database.menu.disconnect') }}</button>
        <button type="button" class="ui-menu-item" @click="emit('connRefresh')">{{ t('database.menu.refreshDatabases') }}</button>
        <div class="ui-menu-sep" role="separator"></div>
        <button type="button" class="ui-menu-item" @click="emit('connCopyHost')">{{ t('database.menu.copyHost') }}</button>
        <button type="button" class="ui-menu-item danger" @click="emit('connDelete')">{{ t('database.menu.deleteConnection') }}</button>
      </template>

      <template v-else-if="menu.kind === 'db'">
        <button type="button" class="ui-menu-item primary" @click="emit('dbNewQuery')">{{ t('database.menu.newQuery') }}</button>
        <div class="ui-menu-hint">{{ t('database.menu.useDatabaseHint', { database: menu.database }) }}</div>
        <div class="ui-menu-sep" role="separator"></div>
        <button type="button" class="ui-menu-item" @click="emit('dbRefresh')">{{ t('database.menu.refreshTables') }}</button>
        <div class="ui-menu-sep" role="separator"></div>
        <button type="button" class="ui-menu-item" @click="emit('dbCopyName')">{{ t('database.menu.copyDbName') }}</button>
      </template>

      <template v-else-if="menu.kind === 'table'">
        <div class="ui-menu-title">{{ menu.database }}.{{ menu.table.name }}</div>
        <button type="button" class="ui-menu-item" @click="emit('tableViewData')">{{ t('database.menu.viewData') }}</button>
        <button type="button" class="ui-menu-item" @click="emit('tableStructure')">{{ t('database.menu.viewStructure') }}</button>
        <div class="ui-menu-sep" role="separator"></div>
        <button type="button" class="ui-menu-item" @click="emit('tableSelect')">SELECT * … LIMIT 100</button>
        <button type="button" class="ui-menu-item" @click="emit('tableCount')">SELECT COUNT(*)</button>
        <button type="button" class="ui-menu-item" @click="emit('tableDescribe')">SHOW FULL COLUMNS</button>
        <div class="ui-menu-sep" role="separator"></div>
        <button type="button" class="ui-menu-item" @click="emit('tableCopyName')">{{ t('database.menu.copyTableName') }}</button>
        <button type="button" class="ui-menu-item" @click="emit('tableCopyQualified')">{{ t('database.menu.copyQualified') }}</button>
        <button type="button" class="ui-menu-item" @click="emit('tableCopySelect')">{{ t('database.menu.copySelect') }}</button>
      </template>
    </div>
  </Teleport>
</template>
