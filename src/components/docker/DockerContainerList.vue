<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  formatContainerPortsSummary,
  matchesStateFilter,
  type DockerListStateFilter,
} from '../../composables/docker/dockerContainersFilter'
import { primaryRowActions, stateTone } from './dockerUiHelpers'
import type { DockerContainerAction, DockerContainerSummary } from '../../env.d'

const props = defineProps<{
  filteredContainers: DockerContainerSummary[]
  containers: DockerContainerSummary[]
  stateFilter: DockerListStateFilter
  searchQuery: string
  selectedId: string | null
  showActions: boolean
  listEmptyKind: 'loading' | 'error' | 'empty' | 'filtered' | null
  loadErrorMessage: string
  refreshing: boolean
  isActionBusy: (id: string) => boolean
  getBusyAction: (id: string) => DockerContainerAction | null
}>()

const emit = defineEmits<{
  (e: 'filter', next: DockerListStateFilter): void
  (e: 'search', value: string): void
  (e: 'select', c: DockerContainerSummary): void
  (
    e: 'action',
    payload: {
      event: MouseEvent
      id: string
      action: DockerContainerAction
      c?: DockerContainerSummary
    },
  ): void
}>()

const { t } = useI18n()
const scrollEl = ref<HTMLElement | null>(null)

defineExpose({ getScrollEl: () => scrollEl.value })

const filterCounts = computed(() => {
  let running = 0
  let stopped = 0
  for (const c of props.containers) {
    if (matchesStateFilter(c, 'running')) running++
    else if (matchesStateFilter(c, 'stopped')) stopped++
  }
  return { all: props.containers.length, running, stopped }
})

function stateLabel(state: string): string {
  const s = (state || '').toLowerCase()
  if (s === 'running') return t('docker.containerState.running')
  if (s === 'exited') return t('docker.containerState.exited')
  if (s === 'created') return t('docker.containerState.created')
  if (s === 'dead') return t('docker.containerState.dead')
  if (s === 'paused') return t('docker.containerState.paused')
  if (s === 'restarting') return t('docker.containerState.restarting')
  if (s === 'removing') return t('docker.containerState.removing')
  return state || t('docker.containerState.unknown')
}

function actionLabel(action: DockerContainerAction): string {
  if (action === 'start') return t('docker.actions.start')
  if (action === 'stop') return t('docker.actions.stop')
  return t('docker.actions.restart')
}

function actionAria(action: DockerContainerAction): string {
  if (action === 'start') return t('docker.actions.startAria')
  if (action === 'stop') return t('docker.actions.stopAria')
  return t('docker.actions.restartAria')
}

function actionBusyLabel(action: DockerContainerAction): string {
  if (action === 'start') return t('docker.actions.starting')
  if (action === 'stop') return t('docker.actions.stopping')
  return t('docker.actions.restarting')
}

function onSearchInput(e: Event) {
  emit('search', (e.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="list-column">
    <div class="docker-toolbar">
      <div class="filter-group" role="tablist" :aria-label="t('docker.filters.label')">
        <button
          type="button"
          class="filter-btn"
          :class="{ active: stateFilter === 'all' }"
          @click="emit('filter', 'all')"
        >
          {{ t('docker.filters.all') }}
          <span class="filter-count">{{ filterCounts.all }}</span>
        </button>
        <button
          type="button"
          class="filter-btn"
          :class="{ active: stateFilter === 'running' }"
          @click="emit('filter', 'running')"
        >
          {{ t('docker.filters.running') }}
          <span class="filter-count">{{ filterCounts.running }}</span>
        </button>
        <button
          type="button"
          class="filter-btn"
          :class="{ active: stateFilter === 'stopped' }"
          @click="emit('filter', 'stopped')"
        >
          {{ t('docker.filters.stopped') }}
          <span class="filter-count">{{ filterCounts.stopped }}</span>
        </button>
      </div>
      <input
        class="search-input"
        type="search"
        :value="searchQuery"
        :placeholder="t('docker.searchPlaceholder')"
        :aria-label="t('docker.searchPlaceholder')"
        @input="onSearchInput"
      />
    </div>

    <div class="list-pane">
      <div v-if="listEmptyKind === 'loading'" class="list-placeholder">
        {{ t('docker.list.loading') }}
      </div>
      <div v-else-if="listEmptyKind === 'error'" class="list-placeholder error">
        {{ t('docker.list.loadFailed') }}
        <span v-if="loadErrorMessage" class="list-error-detail">{{ loadErrorMessage }}</span>
      </div>
      <div v-else-if="listEmptyKind === 'empty'" class="list-placeholder">
        {{ t('docker.list.empty') }}
      </div>
      <div v-else-if="listEmptyKind === 'filtered'" class="list-placeholder">
        {{ t('docker.list.noMatch') }}
      </div>
      <div v-else class="list-table" :class="{ 'no-actions': !showActions }">
        <div class="list-head" aria-hidden="true">
          <span class="col-state">{{ t('docker.list.columns.state') }}</span>
          <span class="col-container">{{ t('docker.list.columns.container') }}</span>
          <span class="col-runtime">{{ t('docker.list.columns.runtime') }}</span>
          <span v-if="showActions" class="col-actions">{{ t('docker.list.columns.actions') }}</span>
        </div>
        <div
          ref="scrollEl"
          class="container-list"
          role="listbox"
          :aria-label="t('docker.list.aria')"
        >
          <div
            v-for="c in filteredContainers"
            :key="c.id"
            class="container-row"
            role="option"
            :aria-selected="selectedId === c.id"
            :class="{ selected: selectedId === c.id, 'row-busy': isActionBusy(c.id) }"
            @click="emit('select', c)"
          >
            <span class="col-state">
              <span class="state-pill" :class="`tone-${stateTone(c.state)}`">
                <span class="status-dot" aria-hidden="true"></span>
                {{ stateLabel(c.state) }}
              </span>
            </span>
            <span class="col-container">
              <span class="row-name" :title="c.displayName">{{ c.displayName }}</span>
              <span class="row-image" :title="c.image || undefined">{{ c.image || '—' }}</span>
            </span>
            <span
              class="col-runtime"
              :title="[
                formatContainerPortsSummary(c.ports) || t('docker.list.noPorts'),
                c.status || '',
              ]
                .filter(Boolean)
                .join(' · ')"
            >
              <span class="row-ports">{{
                formatContainerPortsSummary(c.ports) || t('docker.list.noPorts')
              }}</span>
              <span class="row-status">{{ c.status || '—' }}</span>
            </span>
            <span v-if="showActions" class="col-actions" @click.stop>
              <template v-if="isActionBusy(c.id)">
                <span class="action-busy" aria-live="polite">
                  {{ actionBusyLabel(getBusyAction(c.id) || 'start') }}
                </span>
              </template>
              <template v-else>
                <button
                  v-for="act in primaryRowActions(c.state)"
                  :key="act"
                  type="button"
                  class="action-btn"
                  :aria-label="actionAria(act)"
                  :title="actionAria(act)"
                  :disabled="isActionBusy(c.id)"
                  @click="emit('action', { event: $event, id: c.id, action: act, c })"
                >
                  {{ actionLabel(act) }}
                </button>
              </template>
            </span>
          </div>
        </div>
      </div>
      <div v-if="refreshing" class="list-refresh-bar" aria-live="polite">
        {{ t('docker.list.refreshing') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
@import './dockerShared.css';

.list-column {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.docker-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}

.filter-group {
  display: inline-flex;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-secondary);
}

.filter-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.filter-btn.active {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--text-primary);
  font-weight: 600;
}

.filter-count {
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

.search-input {
  flex: 1;
  min-width: 140px;
  max-width: 280px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  padding: 6px 10px;
  font-size: 12px;
}

.list-pane {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
  overflow: hidden;
}

.list-placeholder {
  padding: 24px 16px;
  color: var(--text-secondary);
  font-size: 13px;
  text-align: center;
}

.list-placeholder.error {
  color: var(--danger, #f85149);
}

.list-error-detail {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.85;
}

.list-table {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.list-head,
.container-row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1.2fr) minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 0 10px;
}

.list-table.no-actions .list-head,
.list-table.no-actions .container-row {
  grid-template-columns: 88px minmax(0, 1.2fr) minmax(0, 1fr);
}

.list-head {
  flex-shrink: 0;
  height: 32px;
  font-size: 11px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.container-list {
  overflow: auto;
  min-height: 0;
  flex: 1;
}

.container-row {
  min-height: 52px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  cursor: pointer;
}

.container-row:hover {
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.container-row.selected {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.container-row.row-busy {
  opacity: 0.85;
}

.row-name {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-image,
.row-ports,
.row-status {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-actions {
  display: inline-flex;
  gap: 4px;
  justify-content: flex-end;
}

.action-btn {
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-busy {
  font-size: 11px;
  color: var(--text-secondary);
}

.list-refresh-bar {
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-secondary);
  border-top: 1px solid var(--border-color);
  background: var(--bg-tertiary);
}
</style>
