<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import DockerContainerTerminal from './DockerContainerTerminal.vue'
import DockerContainerOverview from './DockerContainerOverview.vue'
import DockerContainerLogsPanel from './DockerContainerLogsPanel.vue'
import DockerContainerInspectPanel from './DockerContainerInspectPanel.vue'
import { actionsForState, stateTone } from './dockerUiHelpers'
import type { DockerLogsUiState } from '../../composables/docker/useDockerContainerLogs'
import type {
  DockerContainerAction,
  DockerContainerInspectResult,
  DockerContainerSummary,
  DockerLogEntry,
  DockerLogTail,
  DockerTransportErrorCode,
} from '../../env.d'

export type DockerDetailTab = 'overview' | 'logs' | 'terminal' | 'inspect'

const props = defineProps<{
  container: DockerContainerSummary
  sessionId: string
  sshDisconnected: boolean
  showActions: boolean
  detailTab: DockerDetailTab
  containerRunnable: boolean
  isActionBusy: (id: string) => boolean
  getBusyAction: (id: string) => DockerContainerAction | null
  inspectResult: DockerContainerInspectResult | null
  inspectLoading: boolean
  inspectError: string | null
  logEntries: DockerLogEntry[]
  logDroppedCount: number
  logStreamState: DockerLogsUiState
  logStreamErrorCode: DockerTransportErrorCode | null | undefined
  logTail: DockerLogTail
  logFollow: boolean
  logAutoScroll: boolean
}>()

const emit = defineEmits<{
  (e: 'update:detailTab', tab: DockerDetailTab): void
  (e: 'action', payload: { event: MouseEvent; id: string; action: DockerContainerAction }): void
  (e: 'set-log-tail', value: DockerLogTail): void
  (e: 'set-log-follow', value: boolean): void
  (e: 'set-log-auto-scroll', value: boolean): void
  (e: 'clear-logs'): void
}>()

const { t } = useI18n()
const logsPanelRef = ref<{ resetSearch: () => void } | null>(null)
const inspectPanelRef = ref<{ resetSearch: () => void } | null>(null)

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

function actionBusyLabel(action: DockerContainerAction): string {
  if (action === 'start') return t('docker.actions.starting')
  if (action === 'stop') return t('docker.actions.stopping')
  return t('docker.actions.restarting')
}

function actionAria(action: DockerContainerAction): string {
  if (action === 'start') return t('docker.actions.startAria')
  if (action === 'stop') return t('docker.actions.stopAria')
  return t('docker.actions.restartAria')
}

function setTab(tab: DockerDetailTab) {
  emit('update:detailTab', tab)
}

function resetSearches() {
  logsPanelRef.value?.resetSearch()
  inspectPanelRef.value?.resetSearch()
}

defineExpose({ resetSearches })
</script>

<template>
  <div class="detail-pane">
    <div class="detail-header">
      <div class="detail-title-block">
        <div class="detail-title-main">
          <h3 class="detail-name" :title="container.displayName">
            {{ container.displayName }}
          </h3>
          <span class="state-pill" :class="`tone-${stateTone(container.state)}`">
            <span class="status-dot" aria-hidden="true"></span>
            {{ stateLabel(container.state) }}
          </span>
        </div>
        <div v-if="showActions" class="detail-actions">
          <template v-if="isActionBusy(container.id)">
            <span class="action-busy" aria-live="polite">
              {{ actionBusyLabel(getBusyAction(container.id) || 'start') }}
            </span>
          </template>
          <template v-else>
            <button
              v-for="act in actionsForState(container.state)"
              :key="act"
              type="button"
              class="action-btn primary"
              :aria-label="actionAria(act)"
              :title="actionAria(act)"
              :disabled="isActionBusy(container.id)"
              @click="emit('action', { event: $event, id: container.id, action: act })"
            >
              {{ actionLabel(act) }}
            </button>
          </template>
        </div>
      </div>
      <div class="detail-tabs" role="tablist">
        <button
          type="button"
          class="tab-btn"
          :class="{ active: detailTab === 'overview' }"
          @click="setTab('overview')"
        >
          {{ t('docker.detail.overview') }}
        </button>
        <button
          type="button"
          class="tab-btn"
          :class="{ active: detailTab === 'logs' }"
          @click="setTab('logs')"
        >
          {{ t('docker.detail.logs') }}
        </button>
        <button
          type="button"
          class="tab-btn"
          :class="{ active: detailTab === 'terminal' }"
          @click="setTab('terminal')"
        >
          {{ t('docker.detail.terminal') }}
        </button>
        <button
          type="button"
          class="tab-btn"
          :class="{ active: detailTab === 'inspect' }"
          @click="setTab('inspect')"
        >
          {{ t('docker.detail.inspect') }}
        </button>
      </div>
    </div>

    <DockerContainerOverview
      v-if="detailTab === 'overview'"
      :container="container"
      :inspect-result="inspectResult"
      :inspect-loading="inspectLoading"
      :inspect-error="inspectError"
    />
    <DockerContainerLogsPanel
      v-else-if="detailTab === 'logs'"
      ref="logsPanelRef"
      :entries="logEntries"
      :dropped-count="logDroppedCount"
      :stream-state="logStreamState"
      :stream-error-code="logStreamErrorCode"
      :tail="logTail"
      :follow="logFollow"
      :auto-scroll="logAutoScroll"
      :active="detailTab === 'logs'"
      @set-tail="emit('set-log-tail', $event)"
      @set-follow="emit('set-log-follow', $event)"
      @set-auto-scroll="emit('set-log-auto-scroll', $event)"
      @clear="emit('clear-logs')"
    />
    <div v-else-if="detailTab === 'terminal'" class="detail-body terminal-body">
      <DockerContainerTerminal
        :session-id="sessionId"
        :container-id="container.id"
        :container-name="container.displayName || container.id.slice(0, 12)"
        :container-runnable="containerRunnable"
        :ssh-disconnected="sshDisconnected"
        :active="detailTab === 'terminal'"
      />
    </div>
    <DockerContainerInspectPanel
      v-else
      ref="inspectPanelRef"
      :inspect-result="inspectResult"
      :inspect-loading="inspectLoading"
      :inspect-error="inspectError"
      :active="detailTab === 'inspect'"
      :selected-id="container.id"
    />
  </div>
</template>

<style scoped>
@import './dockerShared.css';

.detail-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
  overflow: hidden;
}

.detail-header {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-color);
  padding: 10px 12px 0;
}

.detail-title-block {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.detail-title-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.detail-name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.detail-actions {
  display: inline-flex;
  gap: 6px;
  flex-shrink: 0;
}

.action-btn {
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.action-btn.primary {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border-color));
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-busy {
  font-size: 12px;
  color: var(--text-secondary);
}

.detail-tabs {
  display: flex;
  gap: 2px;
}

.tab-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  padding: 8px 12px;
  font-size: 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}

.tab-btn.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.detail-body.terminal-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
