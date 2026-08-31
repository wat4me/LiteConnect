<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from '../components/icons/AppIcon.vue'
import DbNavTree from '../components/database/DbNavTree.vue'
import DbQueryTab from '../components/database/DbQueryTab.vue'
import DbTableWorkspace from '../components/database/DbTableWorkspace.vue'
import DbNavContextMenu from '../components/database/DbNavContextMenu.vue'
import DbConnectionDialog from '../components/database/DbConnectionDialog.vue'
import DbCreateDatabaseDialog from '../components/database/DbCreateDatabaseDialog.vue'
import { useI18n } from 'vue-i18n'
import { useDbWorkspace } from '../composables/database/useDbWorkspace'

const { t } = useI18n()

const {
  dbRootRef,
  session,
  engineLabel,
  openQueryTab,
  disconnectSession,
  connections,
  loading,
  connectingId,
  isConnecting,
  selectedTableKey,
  isTreeLoading,
  isConnActive,
  isConnFocused,
  isConnExpanded,
  isDbExpanded,
  databasesOf,
  tablesFor,
  treeDbKey,
  openCreate,
  toggleConnection,
  connect,
  openEdit,
  removeConnection,
  expandDatabase,
  reloadTables,
  onTableClick,
  onConnContext,
  onDbContext,
  onTableContext,
  tabs,
  activeTabId,
  tabBarTooltip,
  activateTab,
  connectionMetaOf,
  connectionNameOf,
  tabBarTitle,
  closeTab,
  activeTab,
  activeQueryTab,
  onQuerySqlChanged,
  isQueryDirty,
  renameQueryTab,
  setQueryReadOnly,
  setQueryExecOptions,
  displayedHistory,
  historyOnlyCurrent,
  historyStatusFilter,
  savedQueries,
  saveQuery,
  deleteSavedQuery,
  renameSavedQuery,
  applySavedQuery,
  getLiveSession,
  dialectOf,
  queryGetTables,
  queryEnsureTables,
  queryEnsureColumns,
  runQuerySql,
  explainQuerySql,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  cancelActiveQuery,
  onQueryChangeDatabase,
  clearQueryHistory,
  applyHistoryItem,
  copyActiveResult,
  exportActiveResultCsv,
  exportActiveResultJson,
  exportTableAllCsv,
  copyResultCell,
  toggleDataSort,
  applyWhereFilter,
  changeDataPage,
  jumpDataPage,
  changeDataPageSize,
  loadDataPage,
  setTablePanel,
  startInsertRow,
  saveDirtyRows,
  discardDirty,
  deleteSelectedRows,
  toggleSelectRow,
  startEditCell,
  onEditCellKeydown,
  onEditCellBlur,
  setInsertCell,
  saveInsertRow,
  cancelInsertRow,
  loadStructure,
  footerStatus,
  navMenu,
  closeContextMenu,
  menuConnConnect,
  menuConnDisconnect,
  menuConnRefresh,
  menuConnCopyHost,
  menuConnEdit,
  menuConnDelete,
  menuConnCreateDatabase,
  createDbTarget,
  createDbCreating,
  executeCreateDatabase,
  closeCreateDatabaseDialog,
  menuDbNewQuery,
  menuDbRefresh,
  menuDbCopyName,
  menuTableViewData,
  menuTableStructure,
  menuTableSelect,
  menuTableCount,
  menuTableDescribe,
  menuTableCopyName,
  menuTableCopyQualified,
  menuTableCopySelect,
  showForm,
  form,
  editingId,
  saving,
  testing,
  testHint,
  closeForm,
  saveForm,
  testForm,
  sshConnections,
  groups,
  exportConnections,
  importConnections,
} = useDbWorkspace()

/** Query tab rename UI state (keyboard-accessible) */
const renamingTabId = ref<string | null>(null)
const renameDraft = ref('')
const scriptJobId = ref<string | null>(null)
const scriptStatus = ref('')
let stopScriptProgress: (() => void) | null = null

function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function importSqlScript() {
  const live = session.value
  if (!live || scriptJobId.value) return
  try {
    const file = await window.LiteConnect.dbSelectSqlScript()
    if (!file) return
    const accepted = window.confirm(
      `将执行 SQL 文件：${file.name}（${formatFileSize(file.size)}）。\n` +
      '脚本会直接写入当前数据库连接，执行后无法自动撤销。是否继续？',
    )
    if (!accepted) return
    const result = await window.LiteConnect.dbRunSqlScript(
      live.sessionId,
      file.token,
      activeQueryTab.value?.database || undefined,
    )
    scriptJobId.value = result.jobId
    scriptStatus.value = `正在导入 ${file.name}…`
  } catch (err: any) {
    window.alert(`导入 SQL 失败：${err?.message || err}`)
  }
}

async function cancelSqlScript() {
  if (scriptJobId.value) await window.LiteConnect.dbCancelSqlScript(scriptJobId.value)
}

onMounted(() => {
  stopScriptProgress = window.LiteConnect.onDbScriptProgress((progress) => {
    if (progress.jobId !== scriptJobId.value) return
    const pct = progress.size ? Math.min(100, Math.round((progress.bytesRead / progress.size) * 100)) : 0
    scriptStatus.value = `${progress.name} · ${pct}% · 已执行 ${progress.statements} 条`
    if (progress.state === 'failed') {
      scriptStatus.value += ` · 失败：${progress.error || '未知错误'}`
      scriptJobId.value = null
    } else if (progress.state === 'completed' || progress.state === 'cancelled') {
      scriptStatus.value += progress.state === 'completed' ? ' · 完成' : ' · 已取消'
      scriptJobId.value = null
    }
  })
})

onBeforeUnmount(() => stopScriptProgress?.())

function beginRenameQueryTab(tabId: string, currentTitle: string) {
  renamingTabId.value = tabId
  renameDraft.value = currentTitle
  void nextTick(() => {
    const el = document.querySelector('.bk-tab-rename-input') as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}

function commitRenameQueryTab() {
  const id = renamingTabId.value
  if (!id) return
  renameQueryTab(id, renameDraft.value)
  renamingTabId.value = null
  renameDraft.value = ''
}

function cancelRenameQueryTab() {
  renamingTabId.value = null
  renameDraft.value = ''
}

function onQueryTabTitleKeydown(e: KeyboardEvent, tabId: string, title: string) {
  if (e.key === 'F2') {
    e.preventDefault()
    beginRenameQueryTab(tabId, title)
  }
}
</script>

<template>
  <div ref="dbRootRef" class="bk-root">
    <div class="bk-workspace">
      <header class="bk-topbar">
        <div class="bk-topbar-left">
          <span
            class="bk-engine-badge sm"
            :class="
              session?.engine === 'postgres'
                ? 'postgres'
                : session?.engine === 'oracle'
                  ? 'oracle'
                  : 'mysql'
            "
          >
            {{ session ? engineLabel(session.engine || 'mysql') : t('database.title') }}
          </span>
          <template v-if="session">
            <strong class="bk-conn-name">{{ session.connectionName }}</strong>
            <span class="bk-top-meta">{{ session.username }}@{{ session.host }}:{{ session.port }}</span>
          </template>
          <span v-else class="bk-top-meta">{{ t('database.navTitle') }}</span>
        </div>
        <div class="bk-topbar-right">
          <button
            type="button"
            class="ui-btn ui-btn-sm"
            :disabled="!session"
            :title="t('database.newQuery')"
            @click="openQueryTab()"
          >
            <AppIcon name="sql" size="sm" />
            <span class="btn-text">{{ t('database.newQuery') }}</span>
          </button>
          <button
            type="button"
            class="ui-btn ui-btn-sm"
            :disabled="!session || !!scriptJobId"
            :title="t('database.importSql')"
            @click="importSqlScript"
          >
            <AppIcon name="upload" size="sm" />
            <span class="btn-text">{{ t('database.importSql') }}</span>
          </button>
          <button
            v-if="scriptJobId"
            type="button"
            class="ui-btn ui-btn-sm ui-btn-danger"
            :title="t('database.cancelImport')"
            @click="cancelSqlScript"
          >
            {{ t('database.cancelImport') }}
          </button>
          <button
            v-if="session"
            type="button"
            class="ui-btn ui-btn-sm ui-btn-danger"
            :title="t('database.disconnectCurrentTitle', { name: session.connectionName })"
            @click="disconnectSession()"
          >
            <span class="btn-text">{{ t('database.disconnectCurrent') }}</span>
            <span class="btn-text-short" aria-hidden="true">{{ t('database.disconnectShort') }}</span>
          </button>
        </div>
      </header>
      <div v-if="scriptStatus" class="bk-script-status" role="status">{{ scriptStatus }}</div>

      <div class="bk-main">
        <DbNavTree
          :connections="connections"
          :loading="loading"
          :connecting-id="connectingId"
          :is-connecting="isConnecting"
          :selected-table-key="selectedTableKey"
          :is-tree-loading="isTreeLoading"
          :is-conn-active="isConnActive"
          :is-conn-focused="isConnFocused"
          :is-conn-expanded="isConnExpanded"
          :is-db-expanded="isDbExpanded"
          :databases-of="databasesOf"
          :tables-for="tablesFor"
          :tree-db-key="treeDbKey"
          @create="openCreate"
          @toggle-connection="toggleConnection"
          @connect="connect"
          @edit="openEdit"
          @remove="removeConnection"
          @export="exportConnections(false)"
          @import="importConnections"
          @expand-database="(id, db) => expandDatabase(id, db)"
          @reload-tables="reloadTables"
          @table-click="onTableClick"
          @conn-context="onConnContext"
          @db-context="onDbContext"
          @table-context="onTableContext"
        />

        <div class="bk-editor">
          <template v-if="!session">
            <div class="bk-tab-empty welcome">
              <AppIcon name="database" size="hero" />
              <p class="welcome-title">{{ t('database.welcomeTitle') }}</p>
              <p class="welcome-desc">{{ t('database.welcomeDesc') }}</p>
              <button type="button" class="ui-btn ui-btn-primary" @click="openCreate">{{ t('database.newConnection') }}</button>
            </div>
          </template>
          <template v-else>
            <div class="bk-tabs" role="tablist">
              <div
                v-for="tab in tabs"
                :key="tab.id"
                class="bk-tab"
                :class="{ active: tab.id === activeTabId, renaming: renamingTabId === tab.id }"
                role="tab"
                :aria-selected="tab.id === activeTabId"
                :tabindex="tab.id === activeTabId ? 0 : -1"
                :title="
                  tab.kind === 'query'
                    ? `${tabBarTooltip(tab)} · ${t('database.query.renameHint')}`
                    : tabBarTooltip(tab)
                "
                @click="activateTab(tab.id)"
                @keydown="tab.kind === 'query' ? onQueryTabTitleKeydown($event, tab.id, tab.title) : undefined"
              >
                <span class="bk-tab-kind" :class="tab.kind">
                  {{ tab.kind === 'query' ? t('database.tabQuery') : t('database.tabTable') }}
                </span>
                <span class="bk-tab-conn" :title="connectionMetaOf(tab.connectionId)">
                  {{ connectionNameOf(tab.connectionId) }}
                </span>
                <template v-if="tab.kind === 'query' && renamingTabId === tab.id">
                  <input
                    v-model="renameDraft"
                    class="bk-tab-rename-input"
                    type="text"
                    :aria-label="t('database.query.renameTitle')"
                    :placeholder="t('database.query.renamePlaceholder')"
                    maxlength="120"
                    @click.stop
                    @keydown.enter.prevent="commitRenameQueryTab"
                    @keydown.escape.prevent="cancelRenameQueryTab"
                    @blur="commitRenameQueryTab"
                  />
                </template>
                <span
                  v-else
                  class="bk-tab-title"
                  @dblclick.stop="
                    tab.kind === 'query' ? beginRenameQueryTab(tab.id, tab.title) : undefined
                  "
                >{{ tabBarTitle(tab) }}</span>
                <span
                  v-if="tab.kind === 'query' && tab.inTransaction"
                  class="bk-tab-tx"
                  :title="t('database.tx.inTransaction')"
                >TX</span>
                <span
                  v-else-if="tab.kind === 'query' && isQueryDirty(tab)"
                  class="bk-tab-dirty"
                  :title="t('database.query.unsaved')"
                  aria-hidden="true"
                >•</span>
                <button
                  type="button"
                  class="bk-tab-x"
                  :aria-label="t('common.close')"
                  @click.stop="closeTab(tab.id)"
                ><AppIcon name="close" size="xs" /></button>
              </div>
              <button type="button" class="bk-tab add" :title="t('database.newQuery')" @click="openQueryTab()">
                <AppIcon name="plus" size="sm" />
              </button>
            </div>

            <div v-if="!activeTab" class="bk-tab-empty">
              {{ t('database.emptyTabs') }}
            </div>

            <DbQueryTab
              v-else-if="activeQueryTab"
              :tab="activeQueryTab"
              :connection-name="connectionNameOf(activeQueryTab.connectionId)"
              :connection-name-of="connectionNameOf"
              :connection-meta="connectionMetaOf(activeQueryTab.connectionId)"
              :databases="databasesOf(activeQueryTab.connectionId)"
              :saved-queries="savedQueries"
              :history="displayedHistory"
              :history-only-current="historyOnlyCurrent"
              :history-status-filter="historyStatusFilter"
              :session-alive="!!getLiveSession(activeQueryTab.connectionId)"
              :dialect="dialectOf(activeQueryTab.connectionId)"
              :get-tables="queryGetTables"
              :ensure-tables="queryEnsureTables"
              :ensure-columns="queryEnsureColumns"
              @run="(sql, scope) => runQuerySql(sql, scope)"
              @explain="explainQuerySql"
              @cancel="cancelActiveQuery"
              @begin-tx="beginTransaction"
              @commit-tx="commitTransaction"
              @rollback-tx="rollbackTransaction"
              @retry="runQuerySql(activeQueryTab.sql, 'all')"
              @change-database="onQueryChangeDatabase"
              @copy-result="copyActiveResult"
              @export-csv="exportActiveResultCsv"
              @export-json="exportActiveResultJson"
              @copy-cell="copyResultCell"
              @sql-changed="onQuerySqlChanged(activeQueryTab.id)"
              @update:read-only="setQueryReadOnly(activeQueryTab.id, $event)"
              @update:exec-options="setQueryExecOptions(activeQueryTab.id, $event)"
              @update:history-only-current="historyOnlyCurrent = $event"
              @update:history-status-filter="historyStatusFilter = $event"
              @clear-history="clearQueryHistory"
              @apply-history="applyHistoryItem"
              @save-query="saveQuery"
              @delete-saved-query="deleteSavedQuery"
              @rename-saved-query="renameSavedQuery"
              @apply-saved-query="applySavedQuery"
            />

            <DbTableWorkspace
              v-else-if="activeTab.kind === 'data'"
              :tab="activeTab"
              :connection-name="connectionNameOf(activeTab.connectionId)"
              :connection-meta="connectionMetaOf(activeTab.connectionId)"
              :dialect="dialectOf(activeTab.connectionId)"
              @set-panel="setTablePanel"
              @sort="toggleDataSort"
              @page-delta="changeDataPage"
              @jump-page="jumpDataPage"
              @page-size="changeDataPageSize"
              @refresh="loadDataPage(activeTab.id)"
              @refresh-structure="loadStructure(activeTab.id)"
              @start-insert="startInsertRow"
              @save-dirty="saveDirtyRows"
              @discard-dirty="discardDirty"
              @delete-selected="deleteSelectedRows"
              @copy-result="copyActiveResult"
              @export-csv="exportActiveResultCsv"
              @export-json="exportActiveResultJson"
              @export-all="exportTableAllCsv"
              @where-filter="applyWhereFilter"
              @toggle-select="toggleSelectRow"
              @start-edit="startEditCell"
              @edit-keydown="onEditCellKeydown"
              @edit-blur="onEditCellBlur"
              @set-insert-cell="setInsertCell"
              @save-insert="saveInsertRow"
              @cancel-insert="cancelInsertRow"
            />
          </template>
        </div>
      </div>

      <footer class="bk-statusbar">{{ footerStatus }}</footer>
    </div>

    <DbNavContextMenu
      v-if="navMenu"
      :menu="navMenu"
      :is-conn-active="isConnActive"
      @dismiss="closeContextMenu"
      @conn-connect="menuConnConnect"
      @conn-disconnect="menuConnDisconnect"
      @conn-refresh="menuConnRefresh"
      @conn-copy-host="menuConnCopyHost"
      @conn-edit="menuConnEdit"
      @conn-delete="menuConnDelete"
      @conn-create-database="menuConnCreateDatabase"
      @db-new-query="menuDbNewQuery"
      @db-refresh="menuDbRefresh"
      @db-copy-name="menuDbCopyName"
      @table-view-data="menuTableViewData"
      @table-structure="menuTableStructure"
      @table-select="menuTableSelect"
      @table-count="menuTableCount"
      @table-describe="menuTableDescribe"
      @table-copy-name="menuTableCopyName"
      @table-copy-qualified="menuTableCopyQualified"
      @table-copy-select="menuTableCopySelect"
    />

    <DbConnectionDialog
      v-if="showForm"
      v-model="form"
      :editing="!!editingId"
      :saving="saving"
      :testing="testing"
      :test-hint="testHint"
      :ssh-connections="sshConnections"
      :groups="groups"
      @close="closeForm"
      @save="saveForm"
      @test="testForm"
    />

    <DbCreateDatabaseDialog
      :visible="!!createDbTarget"
      :creating="createDbCreating"
      :engine="createDbTarget?.engine || 'mysql'"
      :connection-name="createDbTarget?.connectionName || ''"
      @close="closeCreateDatabaseDialog"
      @create="executeCreateDatabase"
    />
  </div>
</template>

<style scoped>
.bk-root {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  color: var(--text-primary);
  /* Chrome stays on the UI stack (12px tabs / 11px compact controls).
   * Editor, grids, DDL and SQL errors opt into --db-font-size / --db-font-family. */
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --font-mono: var(--db-font-family, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  container-type: inline-size;
  container-name: db-shell;
}

.bk-tab-empty.welcome {
  flex-direction: column;
  gap: 10px;
  color: var(--text-secondary);
}

.welcome-title {
  margin: 8px 0 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.welcome-desc {
  margin: 0 0 8px;
  font-size: 12px;
  max-width: 280px;
  text-align: center;
  line-height: 1.45;
}

.bk-engine-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: 4px;
  background: #f6ad551a;
  color: #ed8936;
}

.bk-engine-badge.mysql {
  background: #f6ad551a;
  color: #ed8936;
}

.bk-engine-badge.postgres {
  background: #63b3ed1a;
  color: #3182ce;
}

.bk-engine-badge.oracle {
  background: #fc81811a;
  color: #c53030;
}

.bk-engine-badge.sm {
  font-size: 9px;
}

.bk-workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.bk-topbar {
  height: 40px;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-wrap: nowrap;
  min-width: 0;
}

.bk-topbar-left,
.bk-topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: nowrap;
}

.bk-topbar-right {
  flex-shrink: 0;
}

.bk-topbar-right .ui-btn-sm {
  flex-shrink: 0;
}

.bk-topbar-right .btn-text-short {
  display: none;
}

@container db-shell (max-width: 860px) {
  .bk-top-meta {
    display: none;
  }
}

@container db-shell (max-width: 720px) {
  .bk-conn-name {
    display: none;
  }
  .bk-topbar-right .btn-text {
    display: none;
  }
  .bk-topbar-right .btn-text-short {
    display: inline;
  }
  .bk-topbar-right .ui-btn-sm {
    padding: 0 8px;
  }
}

.bk-script-status {
  height: 24px;
  min-height: 24px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid var(--border-color);
  background: var(--accent-bg);
  color: var(--text-secondary);
  font-size: 11px;
}

.bk-conn-name {
  font-size: 13px;
  font-weight: 600;
}

.bk-top-meta {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plus {
  font-weight: 700;
}

.bk-main {
  flex: 1;
  min-height: 0;
  display: flex;
}

.bk-editor {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
}

.bk-tabs {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  padding: 4px 6px 0;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  overflow-x: auto;
  flex-shrink: 0;
}

.bk-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.bk-tab:hover {
  color: var(--text-primary);
  background: var(--hover-bg);
}

.bk-tab.active {
  background: var(--bg-primary);
  color: var(--text-primary);
  border-color: var(--border-color);
}

.bk-tab.add {
  max-width: none;
  font-weight: 700;
  padding: 0 12px;
}

.bk-tab-kind {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 800;
  flex-shrink: 0;
}

.bk-tab-kind.query {
  background: #68d39133;
  color: #68d391;
}

.bk-tab-kind.data {
  background: #63b3ed33;
  color: #63b3ed;
}

.bk-tab-kind.structure {
  background: #f6ad5533;
  color: #f6ad55;
}

.bk-tab-conn {
  flex-shrink: 0;
  max-width: 88px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 0 2px;
}

.bk-tab.active .bk-tab-conn {
  color: var(--accent);
}

.bk-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.bk-tab-rename-input {
  min-width: 72px;
  max-width: 160px;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-bg);
}

.bk-tab.renaming {
  cursor: default;
}

.bk-tab-tx {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--warning, #d29922);
  color: var(--warning, #d29922);
  background: color-mix(in srgb, var(--warning, #d29922) 14%, transparent);
}

.bk-tab-dirty {
  flex-shrink: 0;
  color: var(--warning, #d29922);
  font-weight: 800;
  font-size: 14px;
  line-height: 1;
  opacity: 0.9;
}

.bk-tab-x {
  display: inline-flex;
  opacity: 0.5;
}

.bk-tab-x:hover {
  opacity: 1;
  color: var(--danger);
}

.bk-tab-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}

.bk-statusbar {
  height: 24px;
  min-height: 24px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
  font-size: 11px;
  color: var(--text-secondary);
  font-family: var(--font-mono, 'Cascadia Code', Consolas, monospace);
}
</style>
