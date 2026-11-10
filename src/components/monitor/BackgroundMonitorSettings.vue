<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import MonitorAlertDialog from './MonitorAlertDialog.vue'
import type { Connection } from '../../env.d'
import { DEFAULT_MONITOR_ALERT_RULE, type BackgroundMonitorStatus, type MonitorAlertRule } from '../../../shared/monitorAlerts'

const { t } = useI18n()
const connections = ref<Connection[]>([])
const rules = ref<Record<string, MonitorAlertRule>>({})
const statuses = ref<Record<string, BackgroundMonitorStatus>>({})
const editing = ref<Connection | null>(null)
const saving = ref(false)
const loading = ref(true)
let poll: ReturnType<typeof setInterval> | null = null

const editingRule = computed<MonitorAlertRule>(() =>
  editing.value ? (rules.value[editing.value.id] || DEFAULT_MONITOR_ALERT_RULE) : DEFAULT_MONITOR_ALERT_RULE)

async function refreshStatuses() {
  const entries = await Promise.all(connections.value.map(async (connection) => {
    try {
      return [connection.id, await window.LiteConnect.monitorGetBackgroundStatus(connection.id)] as const
    } catch {
      return [connection.id, { state: 'off' } as BackgroundMonitorStatus] as const
    }
  }))
  statuses.value = Object.fromEntries(entries)
}

async function load() {
  loading.value = true
  try {
    connections.value = await window.LiteConnect.getConnections()
    const entries = await Promise.all(connections.value.map(async (connection) =>
      [connection.id, await window.LiteConnect.monitorGetAlertRule(connection.id)] as const))
    rules.value = Object.fromEntries(entries)
    await refreshStatuses()
  } catch (error: any) {
    ElMessage.error(error?.message || t('monitor.backgroundLoadFailed'))
  } finally {
    loading.value = false
  }
}

function statusText(status: BackgroundMonitorStatus | undefined): string {
  switch (status?.state) {
    case 'terminal-only': return t('monitor.backgroundTerminalOnly')
    case 'using-terminal': return t('monitor.backgroundUsingTerminal')
    case 'connecting': return t('monitor.backgroundConnecting')
    case 'sampling': return t('monitor.backgroundSampling')
    case 'monitoring': return t('monitor.backgroundMonitoring')
    case 'retrying': return t('monitor.backgroundRetrying')
    case 'needs-attention': return t('monitor.backgroundNeedsAttention')
    case 'unavailable': return t('monitor.backgroundUnavailable')
    default: return t('monitor.backgroundOff')
  }
}

function openEditor(connection: Connection) {
  editing.value = connection
}

async function save(rule: MonitorAlertRule) {
  const connection = editing.value
  if (!connection || saving.value) return
  saving.value = true
  try {
    rules.value[connection.id] = await window.LiteConnect.monitorSetAlertRule(connection.id, rule)
    editing.value = null
    await refreshStatuses()
    ElMessage.success(t('monitor.alertSaved'))
  } catch (error: any) {
    ElMessage.error(error?.message || t('monitor.alertSaveFailed'))
  } finally {
    saving.value = false
  }
}

async function retry(connectionId: string) {
  try {
    await window.LiteConnect.monitorRetryBackground(connectionId)
    await refreshStatuses()
  } catch (error: any) {
    ElMessage.error(error?.message || t('monitor.backgroundRetryFailed'))
  }
}

onMounted(() => {
  void load()
  poll = setInterval(() => { void refreshStatuses() }, 5000)
  window.addEventListener('focus', load)
})

onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
  window.removeEventListener('focus', load)
})
</script>

<template>
  <div class="background-monitor-settings" data-setting="network.backgroundMonitor">
    <div class="settings-card-title">{{ t('monitor.backgroundTitle') }}</div>
    <p class="settings-hint">{{ t('monitor.backgroundIntro') }}</p>
    <div v-if="loading" class="background-monitor-empty">{{ t('common.loading') }}</div>
    <div v-else-if="!connections.length" class="background-monitor-empty">{{ t('monitor.backgroundNoConnections') }}</div>
    <div v-else class="background-monitor-list">
      <div v-for="connection in connections" :key="connection.id" class="background-monitor-row">
        <div class="background-monitor-identity">
          <strong :title="connection.name">{{ connection.name }}</strong>
          <span :title="connection.host">{{ connection.host }}</span>
        </div>
        <div class="background-monitor-state" :class="statuses[connection.id]?.state">
          {{ statusText(statuses[connection.id]) }}
          <small v-if="statuses[connection.id]?.detail" :title="statuses[connection.id]?.detail">{{ statuses[connection.id]?.detail }}</small>
        </div>
        <div class="background-monitor-buttons">
          <button v-if="['retrying', 'needs-attention', 'unavailable'].includes(statuses[connection.id]?.state || '')" type="button" class="ui-btn ui-btn-sm" @click="retry(connection.id)">{{ t('monitor.backgroundRetry') }}</button>
          <button type="button" class="ui-btn ui-btn-sm" @click="openEditor(connection)">{{ t('monitor.alertSettings') }}</button>
        </div>
      </div>
    </div>

    <MonitorAlertDialog
      :open="!!editing"
      :connection-name="editing?.name || ''"
      :rule="editingRule"
      :saving="saving"
      @save="save"
      @close="editing = null"
    />
  </div>
</template>

<style scoped>
.background-monitor-settings { min-width: 0; }
.background-monitor-settings > .settings-hint { margin: 7px 0 15px; line-height: 1.6; }
.background-monitor-empty { color: var(--text-secondary); padding: 14px 0; }
.background-monitor-list { max-height: 310px; overflow-y: auto; }
.background-monitor-row { display: flex; align-items: center; gap: 12px; padding: 11px 0; border-top: 1px solid var(--border-color); }
.background-monitor-identity { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: 3px; }
.background-monitor-identity strong, .background-monitor-identity span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.background-monitor-identity span { color: var(--text-secondary); font-size: 12px; }
.background-monitor-state { display: flex; flex: 1; flex-direction: column; min-width: 0; color: var(--text-secondary); }
.background-monitor-state.monitoring, .background-monitor-state.using-terminal { color: var(--success); }
.background-monitor-state.retrying, .background-monitor-state.needs-attention, .background-monitor-state.unavailable { color: var(--warning); }
.background-monitor-state small { overflow: hidden; color: var(--text-secondary); text-overflow: ellipsis; white-space: nowrap; }
.background-monitor-buttons { display: flex; gap: 6px; flex-shrink: 0; }
@media (max-width: 560px) {
  .background-monitor-row { flex-wrap: wrap; }
  .background-monitor-identity { flex-basis: 45%; }
}
</style>
