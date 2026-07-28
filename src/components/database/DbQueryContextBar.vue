<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { createTxDurationTimer } from '../../utils/txDurationTimer'
import AppIcon from '../icons/AppIcon.vue'
import type { SavedQuery } from './types'
import { truncateHistorySql } from '../../utils/queryHistoryLog'
import { useOutsideDismiss } from '../../composables/useOutsideDismiss'

const { t } = useI18n()

const props = defineProps<{
  connectionName: string
  connectionMeta: string
  database: string
  databases: string[]
  sessionAlive: boolean
  loading: boolean
  inTransaction: boolean
  transactionStartedAt?: number | null
  readOnly: boolean
  savedQueries: SavedQuery[]
}>()

const emit = defineEmits<{
  changeDatabase: [database: string]
  beginTx: []
  commitTx: []
  rollbackTx: []
  'update:readOnly': [value: boolean]
  deleteSavedQuery: [id: string]
  renameSavedQuery: [id: string, newTitle: string]
  applySavedQuery: [item: SavedQuery]
}>()

const showDbPicker = ref(false)
const dbPickerFilter = ref('')
const dbPickerSearchRef = ref<HTMLInputElement | null>(null)
const dbPickerWrapRef = ref<HTMLElement | null>(null)
const savedPickerWrapRef = ref<HTMLElement | null>(null)
const durationText = ref('0:00')
const timer = createTxDurationTimer({
  onTick: (ms) => {
    durationText.value = timer.format(ms)
  },
})

const filteredPickerDbs = computed(() => {
  const q = dbPickerFilter.value.trim().toLowerCase()
  if (!q) return props.databases
  return props.databases.filter((d) => d.toLowerCase().includes(q))
})

const dbSwitchDisabled = computed(
  () => props.loading || !props.sessionAlive || props.inTransaction,
)

const dbSwitchTitle = computed(() => {
  if (props.inTransaction) return t('database.tx.switchDbDisabledTitle')
  return t('database.query.pickDatabaseTitle')
})

const commitModeLabel = computed(() =>
  props.inTransaction ? t('database.tx.inTransaction') : t('database.tx.autocommit'),
)

const showSavedPicker = ref(false)

useOutsideDismiss(
  showDbPicker,
  () => {
    showDbPicker.value = false
  },
  () => [dbPickerWrapRef.value],
)

useOutsideDismiss(
  showSavedPicker,
  () => {
    showSavedPicker.value = false
  },
  () => [savedPickerWrapRef.value],
)

onBeforeUnmount(() => {
  timer.stop()
})

function syncTimer() {
  if (props.inTransaction && props.transactionStartedAt != null) {
    timer.start(props.transactionStartedAt)
    durationText.value = timer.format(timer.elapsedMs())
  } else {
    timer.stop()
    durationText.value = '0:00'
  }
}

watch(
  () => [props.inTransaction, props.transactionStartedAt] as const,
  () => syncTimer(),
  { immediate: true },
)

async function openDbPicker() {
  if (dbSwitchDisabled.value) return
  showDbPicker.value = !showDbPicker.value
  if (showDbPicker.value) {
    dbPickerFilter.value = ''
    await nextTick()
    dbPickerSearchRef.value?.focus()
  }
}

function selectPickerDb(db: string) {
  emit('changeDatabase', db)
  showDbPicker.value = false
}

function clearPickerDb() {
  emit('changeDatabase', '')
  showDbPicker.value = false
}

function onDbPickerKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    showDbPicker.value = false
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const list = filteredPickerDbs.value
    if (list.length === 1) selectPickerDb(list[0])
  }
}

function toggleReadOnly() {
  if (props.inTransaction && !props.readOnly) {
    // turning on RO while in tx blocked by parent; still emit attempt
  }
  emit('update:readOnly', !props.readOnly)
}

const renamingQueryId = ref<string | null>(null)
const renameDraft = ref('')

function toggleSavedPicker() {
  showSavedPicker.value = !showSavedPicker.value
  if (showSavedPicker.value) {
    showDbPicker.value = false
  }
}

function beginRenameSavedQuery(id: string, currentTitle: string) {
  renamingQueryId.value = id
  renameDraft.value = currentTitle
  void nextTick(() => {
    const el = document.querySelector('.saved-rename-input') as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}

function commitRenameSavedQuery(id: string) {
  if (!renamingQueryId.value) return
  emit('renameSavedQuery', id, renameDraft.value)
  renamingQueryId.value = null
  renameDraft.value = ''
}

function cancelRenameSavedQuery() {
  renamingQueryId.value = null
  renameDraft.value = ''
}

function applySavedQueryItem(item: SavedQuery) {
  emit('applySavedQuery', item)
  showSavedPicker.value = false
}

defineExpose({
  closePopovers: () => {
    showDbPicker.value = false
    showSavedPicker.value = false
  },
})
</script>

<template>
  <div class="query-context-bar" :class="{ 'picker-open': showDbPicker, tx: inTransaction }">
    <span
      class="ctx-chip mode"
      :class="{ active: inTransaction }"
      :title="commitModeLabel"
    >
      {{ commitModeLabel }}
      <template v-if="inTransaction"> · {{ durationText }}</template>
    </span>

    <div class="ctx-tx-actions">
      <button
        v-if="!inTransaction"
        type="button"
        class="ui-btn ui-btn-xs"
        :disabled="loading || !sessionAlive || readOnly"
        :title="readOnly ? t('database.query.readOnlyNoTx') : t('database.tx.beginTitle')"
        @click="emit('beginTx')"
      >
        {{ t('database.tx.begin') }}
      </button>
      <template v-else>
        <button
          type="button"
          class="ui-btn ui-btn-xs"
          :disabled="loading || !sessionAlive"
          @click="emit('commitTx')"
        >
          {{ t('database.tx.commit') }}
        </button>
        <button
          type="button"
          class="ui-btn ui-btn-xs ui-btn-danger"
          :disabled="loading || !sessionAlive"
          @click="emit('rollbackTx')"
        >
          {{ t('database.tx.rollback') }}
        </button>
      </template>
    </div>

    <span
      v-if="readOnly"
      class="ctx-chip ro on"
      :title="t('database.query.readOnlyOn')"
    >
      {{ t('database.query.readOnlyBadge') }}
    </span>

    <span class="ctx-sep" aria-hidden="true">|</span>

    <div class="query-conn-chip" :title="connectionMeta">
      <span class="query-conn-label">{{ t('database.query.connection') }}</span>
      <span class="query-conn-name">{{ connectionName }}</span>
      <span
        class="session-dot"
        :class="{ alive: sessionAlive }"
        :title="sessionAlive ? t('database.query.sessionAlive') : t('database.query.sessionDead')"
      />
    </div>

    <span class="query-ctx-sep" aria-hidden="true">/</span>

    <div ref="dbPickerWrapRef" class="db-picker-wrap">
      <button
        type="button"
        class="db-picker-btn"
        :class="{ open: showDbPicker, empty: !database }"
        :disabled="dbSwitchDisabled"
        :title="dbSwitchTitle"
        @click.stop="openDbPicker"
      >
        <span class="db-picker-label">{{ t('database.query.database') }}</span>
        <span class="db-picker-value">{{ database || t('database.query.pickDatabase') }}</span>
        <span class="db-picker-caret" aria-hidden="true">▾</span>
      </button>
      <div v-if="showDbPicker" class="db-picker-panel" @click.stop>
        <div class="db-picker-conn-hint">{{ t('database.query.connectionHint', { name: connectionName }) }}</div>
        <input
          ref="dbPickerSearchRef"
          v-model="dbPickerFilter"
          class="ui-input ui-input-sm db-picker-search"
          type="search"
          :placeholder="t('database.query.searchDatabase')"
          @keydown="onDbPickerKeydown"
        />
        <div class="db-picker-list">
          <button
            type="button"
            class="db-picker-item muted"
            :class="{ active: !database }"
            @click="clearPickerDb"
          >
            {{ t('database.query.noDatabase') }}
          </button>
          <button
            v-for="db in filteredPickerDbs"
            :key="db"
            type="button"
            class="db-picker-item"
            :class="{ active: database === db }"
            @click="selectPickerDb(db)"
          >
            {{ db }}
          </button>
          <div v-if="filteredPickerDbs.length === 0" class="db-picker-empty">
            {{ dbPickerFilter ? t('database.query.noMatchDb') : t('database.query.noDatabases') }}
          </div>
        </div>
      </div>
    </div>

    <!-- Saved queries (scripts) dropdown aligned to the top-right -->
    <div ref="savedPickerWrapRef" class="saved-picker-wrap">
      <button
        type="button"
        class="saved-picker-btn"
        :class="{ open: showSavedPicker }"
        title="查看收藏的 SQL 脚本"
        @click.stop="toggleSavedPicker"
      >
        <AppIcon name="folder" :size="12" />
        <span>{{ t('database.query.savedScriptsBtn') }}</span>
        <span class="saved-badge-count" v-if="savedQueries.length > 0">{{ savedQueries.length }}</span>
        <span class="db-picker-caret" aria-hidden="true">▾</span>
      </button>

      <div v-if="showSavedPicker" class="saved-picker-panel" @click.stop>
        <div class="saved-picker-head">
          <strong>{{ t('database.query.savedTitle') }}</strong>
        </div>
        <div class="saved-picker-list">
          <div v-if="savedQueries.length === 0" class="saved-picker-empty">
            {{ t('database.query.savedEmptyInline') }}
          </div>
          <template v-else>
            <div
              v-for="row in savedQueries"
              :key="row.id"
              class="saved-picker-item"
              @click="applySavedQueryItem(row)"
            >
              <div class="saved-picker-meta" @click.stop>
                <template v-if="renamingQueryId === row.id">
                  <input
                    v-model="renameDraft"
                    class="ui-input ui-input-sm saved-rename-input"
                    type="text"
                    maxlength="120"
                    @keydown.enter.prevent="commitRenameSavedQuery(row.id)"
                    @keydown.escape.prevent="cancelRenameSavedQuery"
                    @blur="commitRenameSavedQuery(row.id)"
                  />
                </template>
                <span
                  v-else
                  class="saved-picker-title-text"
                  title="双击重命名"
                  @dblclick="beginRenameSavedQuery(row.id, row.title)"
                >
                  {{ row.title }}
                </span>

                <div class="saved-picker-actions">
                  <button
                    type="button"
                    class="saved-picker-action-btn"
                    title="重命名"
                    @click="beginRenameSavedQuery(row.id, row.title)"
                  >
                    <AppIcon name="edit" :size="11" />
                  </button>
                  <button
                    type="button"
                    class="saved-picker-action-btn danger"
                    title="删除"
                    @click="emit('deleteSavedQuery', row.id)"
                  >
                    <AppIcon name="delete" :size="11" />
                  </button>
                </div>
              </div>
              <div class="saved-picker-sql" :title="row.sql">{{ truncateHistorySql(row.sql) }}</div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.query-context-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
  flex-wrap: wrap;
  min-width: 0;
  overflow: visible;
  position: relative;
  z-index: 20;
}

.query-context-bar.tx {
  background: color-mix(in srgb, var(--warning, #d29922) 8%, var(--bg-secondary));
}

.ctx-chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  background: var(--bg-primary);
}

.ctx-chip.mode.active {
  border-color: var(--warning, #d29922);
  color: var(--warning, #d29922);
  font-weight: 700;
}

.ctx-chip.ro {
  font-weight: 600;
}

.ctx-chip.ro.on {
  border-color: var(--warning, #d29922);
  color: var(--warning, #d29922);
  background: color-mix(in srgb, var(--warning, #d29922) 12%, transparent);
}

.ctx-tx-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ctx-sep {
  color: var(--text-secondary);
  opacity: 0.4;
}

.query-conn-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: min(280px, 36vw);
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary));
  font-size: 11px;
  min-width: 0;
}

.query-conn-label {
  color: var(--text-secondary);
  font-weight: 600;
  flex-shrink: 0;
}

.query-conn-name {
  font-weight: 700;
  color: var(--accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.session-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-secondary);
  opacity: 0.55;
}

.session-dot.alive {
  background: var(--success, #3fb950);
  opacity: 1;
}

.query-ctx-sep {
  color: var(--text-secondary);
  opacity: 0.5;
  font-weight: 600;
}

.db-picker-wrap {
  position: relative;
  flex-shrink: 1;
  max-width: min(240px, 36vw);
  min-width: 0;
}

.db-picker-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  height: 24px;
  padding: 0 6px 0 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 11px;
  cursor: pointer;
}

.db-picker-btn.open {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-bg);
}

.db-picker-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.db-picker-label {
  color: var(--text-secondary);
  font-weight: 600;
  flex-shrink: 0;
}

.db-picker-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, Consolas, monospace);
  font-weight: 600;
}

.db-picker-btn.empty .db-picker-value {
  color: var(--text-secondary);
  font-family: inherit;
  font-weight: 500;
}

.db-picker-caret {
  font-size: 10px;
  color: var(--text-secondary);
}

.db-picker-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 80;
  width: min(300px, 70vw);
  max-height: 280px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.db-picker-conn-hint {
  padding: 6px 10px 4px;
  font-size: 11px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
}

.db-picker-search {
  margin: 6px 8px;
  width: calc(100% - 16px);
}

.db-picker-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 4px 6px;
}

.db-picker-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-mono, Consolas, monospace);
  text-align: left;
  cursor: pointer;
}

.db-picker-item:hover {
  background: var(--hover-bg);
}

.db-picker-item.active {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}

.db-picker-item.muted {
  font-family: inherit;
  color: var(--text-secondary);
}

.db-picker-empty {
  padding: 12px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
}

.saved-picker-wrap {
  position: relative;
  margin-left: auto;
}

.saved-picker-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 6px 0 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 11px;
  cursor: pointer;
}

.saved-picker-btn:hover {
  border-color: var(--accent);
}

.saved-picker-btn.open {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-bg);
}

.saved-badge-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: #fff;
  border-radius: 10px;
  font-size: 9px;
  padding: 0 4px;
  height: 14px;
  min-width: 14px;
  font-weight: 700;
}

.saved-picker-panel {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 90;
  width: min(340px, 85vw);
  max-height: 320px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.saved-picker-head {
  padding: 6px 10px 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
}

.saved-picker-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px;
}

.saved-picker-empty {
  padding: 20px 10px;
  font-size: 11px;
  color: var(--text-secondary);
  text-align: center;
  line-height: 1.4;
}

.saved-picker-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-color);
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
}

.saved-picker-item:last-child {
  border-bottom: none;
}

.saved-picker-item:hover {
  background: var(--hover-bg);
}

.saved-picker-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.saved-picker-title-text {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.saved-picker-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.saved-picker-action-btn {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.saved-picker-action-btn:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.saved-picker-action-btn.danger:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 8%, var(--bg-primary));
}

.saved-picker-sql {
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.8;
}
</style>
