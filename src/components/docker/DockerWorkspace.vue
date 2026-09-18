<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { useDockerProbe } from '../../composables/docker/useDockerProbe'
import { useDockerContainers } from '../../composables/docker/useDockerContainers'
import { useDockerContainerActions } from '../../composables/docker/useDockerContainerActions'
import { useDockerContainerLogs } from '../../composables/docker/useDockerContainerLogs'
import DockerProbeBanner from './DockerProbeBanner.vue'
import DockerContainerList from './DockerContainerList.vue'
import DockerContainerDetail, {
  type DockerDetailTab,
} from './DockerContainerDetail.vue'
import { canShowContainerActions } from '../../composables/docker/dockerContainerActions'
import type { DockerListStateFilter } from '../../composables/docker/dockerContainersFilter'
import {
  onDockerAvailabilityKeyChange,
  onDockerSshReconnected,
} from '../../composables/docker/dockerWorkspaceLoadPolicy'
import { restoreListScrollAfterRefresh } from '../../composables/docker/listScrollPreserve'
import { appConfirm } from '@/composables/app/useAppDialog'
import type {
  DockerAvailability,
  DockerContainerAction,
  DockerContainerSummary,
} from '../../env.d'

const props = defineProps<{
  sessionId: string | null
  /** SSH transport down (session tab still open). */
  sshDisconnected?: boolean
}>()

const emit = defineEmits<{
  (e: 'back-to-terminal'): void
  (e: 'reconnect'): void
}>()

const { t } = useI18n()
const sessionIdRef = toRef(props, 'sessionId')
const { ui, probing, refresh: refreshProbe, probe } = useDockerProbe(sessionIdRef)
const {
  filteredContainers,
  containers,
  loadState,
  refreshing,
  stateFilter,
  searchQuery,
  selectedId,
  selectedContainer,
  inspectResult,
  inspectLoading,
  inspectError,
  refresh: refreshList,
  setStateFilter,
  setSearchQuery,
  selectContainer,
  refreshInspect,
} = useDockerContainers(sessionIdRef)
const {
  isBusy: isActionBusy,
  getBusyAction,
  runAction,
  feedback: actionFeedback,
  clearFeedback,
} = useDockerContainerActions(sessionIdRef)

const {
  entries: logEntries,
  droppedCount: logDroppedCount,
  streamState: logStreamState,
  streamErrorCode: logStreamErrorCode,
  tail: logTail,
  follow: logFollow,
  autoScroll: logAutoScroll,
  activate: activateLogs,
  deactivate: deactivateLogs,
  setTail: setLogTail,
  setFollow: setLogFollow,
  setAutoScroll: setLogAutoScroll,
  clearLogs,
} = useDockerContainerLogs(sessionIdRef)

const containerListRef = ref<{ getScrollEl: () => HTMLElement | null } | null>(null)
const detailRef = ref<{ resetSearches: () => void } | null>(null)
const listScrollEl = {
  get value() {
    return containerListRef.value?.getScrollEl() ?? null
  },
}
const detailTab = ref<DockerDetailTab>('overview')

const containerRunnable = computed(() => {
  const c = selectedContainer.value
  if (!c) return false
  const s = (c.state || '').toLowerCase()
  if (s === 'paused' || s === 'restarting' || s === 'removing') return false
  if (inspectResult.value?.overview.state) {
    const st = inspectResult.value.overview.state
    if (st.paused || st.restarting) return false
    return st.running === true
  }
  return s === 'running'
})

watch(
  () => props.sshDisconnected,
  (disconnected, wasDisconnected) => {
    if (wasDisconnected && !disconnected && props.sessionId) {
      onDockerSshReconnected({ probe })
    }
  },
)

watch(
  () => {
    if (props.sshDisconnected || !props.sessionId) return null
    if (ui.value.kind === 'result' && ui.value.availability.status === 'available') {
      return `${props.sessionId}:available`
    }
    return null
  },
  (key, prev) => {
    onDockerAvailabilityKeyChange(key, prev, () => {
      void refreshList()
    })
  },
)

const availability = computed<DockerAvailability | null>(() => {
  if (props.sshDisconnected) return { status: 'ssh-disconnected' }
  if (ui.value.kind === 'result') return ui.value.availability
  return null
})

const dockerAvailable = computed(() => availability.value?.status === 'available')

const showActions = computed(() =>
  canShowContainerActions({
    dockerAvailable: dockerAvailable.value,
    sshConnected: !!props.sessionId && !props.sshDisconnected,
  }),
)

const busy = computed(() => probing.value || refreshing.value)
const canRefresh = computed(() => !!props.sessionId && !props.sshDisconnected && !busy.value)

const listEmptyKind = computed(() => {
  if (!dockerAvailable.value) return null
  if (loadState.value.kind === 'loading' && containers.value.length === 0) return 'loading'
  if (loadState.value.kind === 'error' && containers.value.length === 0) return 'error'
  if (containers.value.length === 0) return 'empty'
  if (filteredContainers.value.length === 0) return 'filtered'
  return null
})

async function onRefresh() {
  if (!canRefresh.value) return
  refreshProbe()
  if (!dockerAvailable.value) return

  await restoreListScrollAfterRefresh({
    getScrollTop: () => listScrollEl.value?.scrollTop ?? 0,
    getMaxScrollTop: () => {
      const el = listScrollEl.value
      if (!el) return 0
      return Math.max(0, el.scrollHeight - el.clientHeight)
    },
    setScrollTop: (top) => {
      const el = listScrollEl.value
      if (el) el.scrollTop = top
    },
    refresh: async () => {
      await refreshList()
      if (selectedId.value) await refreshInspect()
    },
    nextTick: () => nextTick(),
  })
}

function onFilter(next: DockerListStateFilter) {
  setStateFilter(next)
}

function onSelectRow(c: DockerContainerSummary) {
  detailTab.value = 'overview'
  detailRef.value?.resetSearches()
  void deactivateLogs()
  void selectContainer(c.id)
}

function onListAction(payload: {
  event: MouseEvent
  id: string
  action: DockerContainerAction
  c?: DockerContainerSummary
}) {
  void onContainerAction(payload.event, payload.id, payload.action, payload.c)
}

function onDetailAction(payload: {
  event: MouseEvent
  id: string
  action: DockerContainerAction
}) {
  void onContainerAction(payload.event, payload.id, payload.action)
}

watch(
  () => [detailTab.value, selectedId.value, props.sessionId, props.sshDisconnected] as const,
  ([tab, cid, sid, disconnected]) => {
    if (tab === 'logs' && cid && sid && !disconnected && dockerAvailable.value) {
      void activateLogs(cid)
    } else {
      void deactivateLogs()
    }
  },
)

async function refreshAfterAction(): Promise<void> {
  await restoreListScrollAfterRefresh({
    getScrollTop: () => listScrollEl.value?.scrollTop ?? 0,
    getMaxScrollTop: () => {
      const el = listScrollEl.value
      if (!el) return 0
      return Math.max(0, el.scrollHeight - el.clientHeight)
    },
    setScrollTop: (top) => {
      const el = listScrollEl.value
      if (el) el.scrollTop = top
    },
    refresh: async () => {
      await refreshList()
      if (selectedId.value) await refreshInspect()
    },
    nextTick: () => nextTick(),
  })
}

async function onContainerAction(
  event: MouseEvent,
  containerId: string,
  action: DockerContainerAction,
  row?: DockerContainerSummary,
) {
  event.stopPropagation()
  if (!showActions.value || isActionBusy(containerId)) return

  if (action === 'stop' || action === 'restart') {
    const displayName =
      row?.displayName
      || (selectedContainer.value?.id === containerId
        ? selectedContainer.value?.displayName || containerId.slice(0, 12)
        : containerId.slice(0, 12))
    try {
      await appConfirm({
        title:
          action === 'stop'
            ? t('docker.actions.confirmStopTitle')
            : t('docker.actions.confirmRestartTitle'),
        message:
          action === 'stop'
            ? t('docker.actions.confirmStopMessage', { name: displayName })
            : t('docker.actions.confirmRestartMessage', { name: displayName }),
        confirmText:
          action === 'stop'
            ? t('docker.actions.confirmStop')
            : t('docker.actions.confirmRestart'),
        cancelText: t('common.cancel'),
        tone: 'warning',
        danger: action === 'stop',
      })
    } catch {
      return
    }
    if (!showActions.value || isActionBusy(containerId)) return
  }

  if (row && selectedId.value !== containerId) {
    detailTab.value = 'overview'
    detailRef.value?.resetSearches()
    void selectContainer(containerId)
  }
  void runAction(containerId, action, { onSuccessRefresh: refreshAfterAction })
}

function actionLabel(action: DockerContainerAction): string {
  if (action === 'start') return t('docker.actions.start')
  if (action === 'stop') return t('docker.actions.stop')
  return t('docker.actions.restart')
}

const actionFeedbackText = computed(() => {
  const fb = actionFeedback.value
  if (!fb) return ''
  const a = actionLabel(fb.action)
  switch (fb.kind) {
    case 'completed':
      return t('docker.actions.feedback.completed', { action: a })
    case 'already-in-state':
      return t('docker.actions.feedback.alreadyInState', { action: a })
    case 'container-not-found':
      return t('docker.actions.feedback.containerNotFound')
    case 'action-conflict':
      return t('docker.actions.feedback.actionConflict')
    case 'permission-denied':
      return t('docker.actions.feedback.permissionDenied')
    case 'ssh-disconnected':
      return t('docker.actions.feedback.sshDisconnected')
    case 'generation-stale':
      return t('docker.actions.feedback.generationStale')
    case 'request-timeout':
      return t('docker.actions.feedback.timeout')
    default:
      return t('docker.actions.feedback.failed')
  }
})

watch(actionFeedback, (fb) => {
  if (!fb) return
  const message = actionFeedbackText.value
  if (fb.kind === 'completed') {
    ElMessage.success(message)
  } else if (fb.kind === 'already-in-state') {
    ElMessage.info(message)
  } else if (fb.kind === 'ssh-disconnected' || fb.kind === 'generation-stale') {
    ElMessage.warning(message)
  } else {
    ElMessage.error(message)
  }
  clearFeedback()
})

onBeforeUnmount(() => {
  void deactivateLogs()
})
</script>

<template>
  <div class="docker-workspace" role="region" :aria-label="t('docker.title')">
    <DockerProbeBanner
      :session-id="sessionId"
      :ssh-disconnected="sshDisconnected"
      :availability="availability"
      :probe-ui-kind="ui.kind"
      :probing="probing"
      :refreshing="refreshing"
      @back-to-terminal="emit('back-to-terminal')"
      @reconnect="emit('reconnect')"
      @refresh="onRefresh"
    />

    <div v-if="dockerAvailable" class="docker-main">
      <div class="docker-split">
        <DockerContainerList
          ref="containerListRef"
          :filtered-containers="filteredContainers"
          :containers="containers"
          :state-filter="stateFilter"
          :search-query="searchQuery"
          :selected-id="selectedId"
          :show-actions="showActions"
          :list-empty-kind="listEmptyKind"
          :load-error-message="loadState.kind === 'error' ? loadState.message : ''"
          :refreshing="refreshing"
          :is-action-busy="isActionBusy"
          :get-busy-action="getBusyAction"
          @filter="onFilter"
          @search="setSearchQuery"
          @select="onSelectRow"
          @action="onListAction"
        />
        <DockerContainerDetail
          v-if="selectedContainer && sessionId"
          ref="detailRef"
          :container="selectedContainer"
          :session-id="sessionId"
          :ssh-disconnected="!!sshDisconnected"
          :show-actions="showActions"
          :detail-tab="detailTab"
          :container-runnable="containerRunnable"
          :is-action-busy="isActionBusy"
          :get-busy-action="getBusyAction"
          :inspect-result="inspectResult"
          :inspect-loading="inspectLoading"
          :inspect-error="inspectError"
          :log-entries="logEntries"
          :log-dropped-count="logDroppedCount"
          :log-stream-state="logStreamState"
          :log-stream-error-code="logStreamErrorCode"
          :log-tail="logTail"
          :log-follow="logFollow"
          :log-auto-scroll="logAutoScroll"
          @update:detail-tab="detailTab = $event"
          @action="onDetailAction"
          @set-log-tail="setLogTail"
          @set-log-follow="setLogFollow"
          @set-log-auto-scroll="setLogAutoScroll"
          @clear-logs="clearLogs"
        />
        <div v-else class="detail-pane detail-empty">
          {{ t('docker.detail.selectHint') }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.docker-workspace {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
}

.docker-main {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 10px 12px 12px;
  overflow: hidden;
}

.docker-split {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(280px, 1.05fr) minmax(320px, 1.2fr);
  gap: 10px;
}

@media (max-width: 960px) {
  .docker-split {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(200px, 40%) minmax(240px, 1fr);
  }
}

.detail-pane.detail-empty {
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 13px;
  padding: 24px;
  text-align: center;
}
</style>
