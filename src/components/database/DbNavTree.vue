<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'
import type { DbConnection, DbTableInfo } from '../../env.d'
import { formatRows } from './dbFormat'

const { t } = useI18n()

const props = defineProps<{
  connections: DbConnection[]
  loading: boolean
  /** Prefer isConnecting; connectingId kept for single-flag callers */
  connectingId?: string | null
  isConnecting?: (id: string) => boolean
  selectedTableKey: string
  isTreeLoading: (key: string) => boolean
  isConnActive: (id: string) => boolean
  isConnFocused: (id: string) => boolean
  isConnExpanded: (id: string) => boolean
  isDbExpanded: (connectionId: string, database: string) => boolean
  databasesOf: (connectionId: string) => string[]
  tablesFor: (connectionId: string, db: string) => DbTableInfo[]
  treeDbKey: (connectionId: string, database: string) => string
}>()

function connConnecting(id: string): boolean {
  if (props.isConnecting) return props.isConnecting(id)
  return props.connectingId === id
}

const emit = defineEmits<{
  create: []
  toggleConnection: [conn: DbConnection]
  connect: [conn: DbConnection]
  edit: [conn: DbConnection]
  remove: [conn: DbConnection]
  export: []
  import: []
  expandDatabase: [connectionId: string, db: string]
  reloadTables: [connectionId: string, db: string]
  tableClick: [connectionId: string, database: string, table: DbTableInfo]
  connContext: [e: MouseEvent, conn: DbConnection]
  dbContext: [e: MouseEvent, connectionId: string, database: string]
  tableContext: [e: MouseEvent, connectionId: string, database: string, table: DbTableInfo]
}>()

const navFilter = ref('')
const showSystemDbs = ref(localStorage.getItem('LiteConnect.db.showSystemDbs') === 'true')
watch(showSystemDbs, (val) => {
  localStorage.setItem('LiteConnect.db.showSystemDbs', String(val))
})
const SYSTEM_DBS = ['information_schema', 'mysql', 'performance_schema', 'sys']

const filteredConnections = computed(() => {
  const q = navFilter.value.trim().toLowerCase()
  if (!q) return props.connections
  return props.connections.filter((c) => {
    if (
      c.name.toLowerCase().includes(q) ||
      c.host.toLowerCase().includes(q) ||
      c.username.toLowerCase().includes(q) ||
      (c.database || '').toLowerCase().includes(q) ||
      (c.group || '').toLowerCase().includes(q)
    ) {
      return true
    }
    if (props.isConnActive(c.id)) {
      return props.databasesOf(c.id).some((db) => {
        if (db.toLowerCase().includes(q)) return true
        return props.tablesFor(c.id, db).some((t) => t.name.toLowerCase().includes(q))
      })
    }
    return false
  })
})

/** Group connections for display; empty group last */
const groupedConnections = computed(() => {
  const list = filteredConnections.value
  const map = new Map<string, DbConnection[]>()
  for (const c of list) {
    const g = c.group?.trim() || ''
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(c)
  }
  const keys = [...map.keys()].sort((a, b) => {
    if (!a) return 1
    if (!b) return -1
    return a.localeCompare(b, 'zh-CN')
  })
  return keys.map((name) => ({ name, items: map.get(name)! }))
})

function filteredDbs(connectionId: string): string[] {
  let list = props.databasesOf(connectionId)
  if (!showSystemDbs.value) {
    list = list.filter((db) => !SYSTEM_DBS.includes(db.toLowerCase()))
  }
  const q = navFilter.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((db) => {
    if (db.toLowerCase().includes(q)) return true
    return props.tablesFor(connectionId, db).some((t) => t.name.toLowerCase().includes(q))
  })
}

/** 筛选时：库名已匹配则展示全部表；否则只展示匹配的表 */
function visibleTables(connectionId: string, db: string): DbTableInfo[] {
  const all = props.tablesFor(connectionId, db)
  const q = navFilter.value.trim().toLowerCase()
  if (!q || db.toLowerCase().includes(q)) return all
  return all.filter((t) => t.name.toLowerCase().includes(q))
}
</script>

<template>
  <aside class="bk-sidebar">
    <div class="bk-sidebar-head">
      <span>{{ t('database.nav.title') }}</span>
      <div class="nav-head-actions">
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost nav-head-btn" :title="t('database.nav.import')" @click="emit('import')">
          <AppIcon name="download" :size="14" />
        </button>
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost nav-head-btn" :title="t('database.nav.export')" @click="emit('export')">
          <AppIcon name="upload" :size="14" />
        </button>
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost nav-head-btn" :title="t('database.nav.create')" @click="emit('create')">
          <AppIcon name="plus" :size="14" />
        </button>
      </div>
    </div>
    <div class="bk-sidebar-search">
      <input v-model="navFilter" class="ui-input ui-input-sm" :placeholder="t('database.nav.filterPlaceholder')" />
      <button
        type="button"
        class="ui-icon-btn ui-icon-btn-ghost system-db-toggle"
        :class="{ active: showSystemDbs }"
        :title="showSystemDbs ? '隐藏系统数据库' : '显示系统数据库'"
        @click="showSystemDbs = !showSystemDbs"
      >
        <AppIcon :name="showSystemDbs ? 'eye' : 'eye-off'" :size="14" />
      </button>
    </div>
    <div class="bk-sidebar-scroll">
      <div v-if="loading" class="nav-muted">{{ t('database.nav.loading') }}</div>
      <div v-else-if="filteredConnections.length === 0" class="nav-empty">
        <p v-if="navFilter">{{ t('database.nav.noMatch') }}</p>
        <template v-else>
          <p>{{ t('database.nav.empty') }}</p>
          <button type="button" class="ui-btn ui-btn-primary nav-empty-btn" @click="emit('create')">
            {{ t('database.nav.create') }}
          </button>
        </template>
      </div>

      <template v-for="group in groupedConnections" :key="group.name || '__ungrouped__'">
        <div v-if="group.name" class="nav-group-label">{{ group.name }}</div>
        <div v-for="conn in group.items" :key="conn.id" class="nav-conn-block">
        <div
          class="nav-conn-row"
          :class="{
            active: isConnActive(conn.id),
            focused: isConnFocused(conn.id),
            expanded: isConnExpanded(conn.id),
            connecting: connConnecting(conn.id),
          }"
          @click="emit('toggleConnection', conn)"
          @dblclick="emit('connect', conn)"
          @contextmenu="emit('connContext', $event, conn)"
        >
          <AppIcon
            class="bk-chevron"
            :class="{ open: isConnExpanded(conn.id) }"
            name="chevron-right"
            :size="12"
          />
          <span class="nav-conn-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <ellipse cx="12" cy="5" rx="8" ry="3" />
              <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
              <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
            </svg>
          </span>
          <span
            class="nav-conn-name"
            :title="`${conn.host}:${conn.port}${conn.sshConnectionId ? t('database.nav.sshTunnelSuffix') : ''}`"
          >
            {{ conn.name }}
            <span v-if="conn.sshConnectionId" class="nav-tunnel-badge" :title="t('database.nav.sshTunnel')">SSH</span>
          </span>
          <span class="nav-status-slot" aria-hidden="true">
            <span v-if="isConnActive(conn.id)" class="nav-live-dot" :title="t('database.nav.connected')"></span>
            <span
              v-else-if="connConnecting(conn.id)"
              class="bk-spinner"
              :title="t('database.nav.connecting')"
            ></span>
          </span>
          <div class="nav-conn-actions" @click.stop>
            <button type="button" :title="t('database.nav.edit')" @click="emit('edit', conn)">
              <AppIcon name="edit" :size="12" />
            </button>
            <button type="button" :title="t('database.nav.delete')" class="danger" @click="emit('remove', conn)">
              <AppIcon name="delete" :size="12" />
            </button>
          </div>
        </div>

        <div v-if="isConnExpanded(conn.id) && isConnActive(conn.id)" class="nav-conn-children">
          <div v-if="databasesOf(conn.id).length === 0" class="nav-muted indent">{{ t('database.nav.noDatabases') }}</div>
          <div
            v-for="db in filteredDbs(conn.id)"
            :key="conn.id + ':' + db"
            class="bk-db-block"
            :class="{ expanded: isDbExpanded(conn.id, db) }"
          >
            <button
              type="button"
              class="bk-db-row"
              @click="emit('expandDatabase', conn.id, db)"
              @contextmenu="emit('dbContext', $event, conn.id, db)"
            >
              <AppIcon
                class="bk-chevron"
                :class="{ open: isDbExpanded(conn.id, db) }"
                name="chevron-right"
                :size="12"
              />
              <svg class="bk-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
              <span class="bk-name">{{ db }}</span>
              <span
                v-if="isTreeLoading(treeDbKey(conn.id, db))"
                class="bk-spinner"
                :title="t('database.nav.loading')"
              ></span>
            </button>
            <div v-if="isDbExpanded(conn.id, db)" class="bk-table-list">
              <button
                v-for="t in visibleTables(conn.id, db)"
                :key="t.name"
                type="button"
                class="bk-table-row"
                :class="{ selected: selectedTableKey === conn.id + '.' + db + '.' + t.name }"
                :title="t.comment || t.name"
                @click="emit('tableClick', conn.id, db, t)"
                @dblclick="emit('tableClick', conn.id, db, t)"
                @contextmenu="emit('tableContext', $event, conn.id, db, t)"
              >
                <svg
                  v-if="t.type === 'view'"
                  class="bk-ico view"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <svg
                  v-else
                  class="bk-ico table"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18M3 15h18M9 3v18" />
                </svg>
                <span class="bk-name">{{ t.name }}</span>
                <span v-if="t.rows != null" class="bk-rowcount">{{ formatRows(t.rows) }}</span>
              </button>
              <div
                v-if="visibleTables(conn.id, db).length === 0 && !isTreeLoading(treeDbKey(conn.id, db))"
                class="bk-tree-empty"
              >
                {{ t('database.nav.noTables') }}
              </div>
              <button type="button" class="bk-reload-tables" @click="emit('reloadTables', conn.id, db)">
                {{ t('database.nav.reloadTables') }}
              </button>
            </div>
          </div>
        </div>
        <div v-else-if="isConnExpanded(conn.id) && connConnecting(conn.id)" class="nav-muted indent">
          {{ t('database.nav.connecting') }}
        </div>
      </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.bk-sidebar {
  width: 240px;
  min-width: 200px;
  border-right: 1px solid var(--border-color);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
}

.nav-head-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.nav-group-label {
  padding: 8px 10px 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
  opacity: 0.85;
}

.nav-tunnel-badge {
  margin-left: 4px;
  font-size: 9px;
  font-weight: 700;
  padding: 0 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
  vertical-align: middle;
}

.bk-sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
}

.bk-sidebar-search {
  padding: 8px;
  border-bottom: 1px solid var(--border-color);
}

.bk-sidebar-scroll {
  flex: 1;
  overflow: auto;
  padding: 4px 0;
}

.nav-head-btn {
  width: 28px;
  height: 28px;
}

.nav-muted {
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.nav-muted.indent {
  padding-left: 28px;
}

.nav-empty {
  padding: 20px 12px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 12px;
}

.nav-empty p {
  margin: 0 0 10px;
}

.nav-empty-btn {
  margin-top: 4px;
}

.nav-conn-block {
  margin-bottom: 1px;
}

.nav-conn-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 5px 6px 5px 4px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  user-select: none;
}

.nav-conn-row:hover,
.nav-conn-row.connecting {
  background: var(--hover-bg);
}

.nav-conn-row.focused {
  background: var(--accent-bg);
  box-shadow: inset 2px 0 0 var(--accent);
}

.nav-conn-icon {
  flex-shrink: 0;
  display: flex;
  color: #dd6b20;
}

.nav-conn-name {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: inherit;
  line-height: 1.3;
}

.nav-status-slot {
  width: 12px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--success) 25%, transparent);
}

.nav-conn-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
  width: 46px;
  justify-content: flex-end;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
}

.nav-conn-row:hover .nav-conn-actions,
.nav-conn-row:focus-within .nav-conn-actions {
  opacity: 1;
  pointer-events: auto;
}

.nav-conn-actions button {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.nav-conn-actions button:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.nav-conn-actions button.danger:hover {
  color: var(--danger);
}

.nav-conn-children {
  padding-left: 6px;
}

.bk-db-block {
  position: relative;
}

.bk-db-block.expanded > .bk-db-row {
  position: sticky;
  top: 0;
  z-index: 4;
  background: var(--bg-secondary);
  box-shadow: 0 1px 0 var(--border-color);
}

.bk-db-row,
.bk-table-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
}

.bk-db-row:hover,
.bk-table-row:hover {
  background: var(--hover-bg);
}

.bk-db-block.expanded > .bk-db-row:hover {
  background: var(--hover-bg);
}

.bk-table-row.selected {
  background: var(--accent-bg);
  color: var(--accent);
}

.bk-chevron {
  font-size: 12px;
  color: var(--text-secondary);
  transition: transform 0.12s;
  flex-shrink: 0;
}

.bk-chevron.open {
  transform: rotate(90deg);
}

.bk-ico {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.bk-ico.table {
  color: #63b3ed;
}

.bk-ico.view {
  color: #f6ad55;
}

.bk-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bk-rowcount {
  font-size: 10px;
  color: var(--text-secondary);
}

.bk-table-list {
  padding-bottom: 4px;
}

.bk-table-row {
  padding-left: 28px;
}

.bk-tree-empty,
.bk-reload-tables {
  padding: 2px 10px 4px 28px;
  font-size: 11px;
  color: var(--text-secondary);
}

.bk-reload-tables {
  display: block;
  width: 100%;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
}

.bk-reload-tables:hover {
  color: var(--accent);
}

.bk-spinner {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  box-sizing: border-box;
  border: 1.5px solid color-mix(in srgb, var(--accent) 28%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: db-spin 0.7s linear infinite;
}

@keyframes db-spin {
  to {
    transform: rotate(360deg);
  }
}

.bk-sidebar-search {
  padding: 8px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  gap: 6px;
  align-items: center;
}

.bk-sidebar-search input {
  flex: 1;
  min-width: 0;
}

.system-db-toggle {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.system-db-toggle.active {
  color: var(--accent) !important;
  background: var(--accent-bg) !important;
}
</style>
