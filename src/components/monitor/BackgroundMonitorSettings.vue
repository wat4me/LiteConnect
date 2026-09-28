<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { Connection } from '../../env.d'
import { DEFAULT_MONITOR_ALERT_RULE, type BackgroundMonitorStatus, type MonitorAlertRule } from '../../../shared/monitorAlerts'

const { t } = useI18n()
const connections = ref<Connection[]>([])
const rules = ref<Record<string, MonitorAlertRule>>({})
const statuses = ref<Record<string, BackgroundMonitorStatus>>({})
const editing = ref<Connection | null>(null)
const draft = ref<MonitorAlertRule>({ ...DEFAULT_MONITOR_ALERT_RULE })
const saving = ref(false)
const loading = ref(true)
const isMacOs = ref(false)
let poll: ReturnType<typeof setInterval> | null = null

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
  draft.value = { ...(rules.value[connection.id] || DEFAULT_MONITOR_ALERT_RULE) }
}

async function save() {
  const connection = editing.value
  if (!connection || saving.value) return
  const rule = draft.value
  if (![rule.cpuThreshold, rule.memoryThreshold, rule.maxNotificationsPer24h].every(Number.isInteger)
    || rule.cpuThreshold < 50 || rule.cpuThreshold > 99
    || rule.memoryThreshold < 50 || rule.memoryThreshold > 99
    || rule.maxNotificationsPer24h < 1 || rule.maxNotificationsPer24h > 10) {
    ElMessage.warning(t('monitor.alertInvalid'))
    return
  }
  saving.value = true
  try {
    rules.value[connection.id] = await window.LiteConnect.monitorSetAlertRule(connection.id, {
      ...rule,
      backgroundEnabled: rule.enabled && rule.backgroundEnabled,
    })
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
  void window.LiteConnect.getAppInfo().then(info => { isMacOs.value = info.platform.startsWith('darwin-') }).catch(() => {})
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

    <Teleport to="body">
      <div v-if="editing" class="background-monitor-overlay" @click.self="editing = null">
        <form class="background-monitor-dialog" role="dialog" aria-modal="true" :aria-label="t('monitor.alertSettings')" @submit.prevent="save">
          <h2>{{ t('monitor.alertSettings') }} · {{ editing.name }}</h2>
          <label class="background-monitor-check"><input v-model="draft.enabled" type="checkbox" />{{ t('monitor.alertEnabled') }}</label>
          <label class="background-monitor-check"><input v-model="draft.backgroundEnabled" type="checkbox" :disabled="!draft.enabled" />{{ t('monitor.backgroundOption') }}</label>
          <p class="background-monitor-help">{{ t('monitor.backgroundOptionHint') }}</p>
          <div class="background-monitor-fields">
            <label>{{ t('monitor.alertCpuThreshold') }}<span><input v-model.number="draft.cpuThreshold" type="number" min="50" max="99" step="1" />%</span></label>
            <label>{{ t('monitor.alertMemoryThreshold') }}<span><input v-model.number="draft.memoryThreshold" type="number" min="50" max="99" step="1" />%</span></label>
            <label class="background-monitor-count">{{ t('monitor.alertMaxCount') }}<span><input v-model.number="draft.maxNotificationsPer24h" type="number" min="1" max="10" step="1" />{{ t('monitor.alertCountUnit') }}</span></label>
          </div>
          <p v-if="isMacOs" class="background-monitor-macos">{{ t('monitor.alertMacOsNote') }}</p>
          <div class="background-monitor-actions">
            <button type="button" class="ui-btn ui-btn-ghost" @click="editing = null">{{ t('common.cancel') }}</button>
            <button type="submit" class="ui-btn ui-btn-primary" :disabled="saving">{{ t('monitor.alertSave') }}</button>
          </div>
        </form>
      </div>
    </Teleport>
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
.background-monitor-overlay { position: fixed; inset: 0; z-index: 3000; display: grid; place-items: center; padding: 20px; background: rgb(0 0 0 / 48%); }
.background-monitor-dialog { box-sizing: border-box; width: min(460px, 100%); max-height: calc(100vh - 40px); overflow-y: auto; padding: 24px; border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg-primary); color: var(--text-primary); box-shadow: 0 16px 48px rgb(0 0 0 / 28%); }
.background-monitor-dialog h2 { margin: 0 0 18px; font-size: 17px; }
.background-monitor-check { display: flex; align-items: center; gap: 9px; margin: 12px 0; }
.background-monitor-check input { width: 16px; height: 16px; margin: 0; }
.background-monitor-help { margin: -4px 0 16px 25px; color: var(--text-secondary); line-height: 1.5; }
.background-monitor-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.background-monitor-fields label { display: flex; flex-direction: column; gap: 7px; }
.background-monitor-fields label span { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); }
.background-monitor-fields input { box-sizing: border-box; min-width: 0; width: 100%; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary); font: inherit; }
.background-monitor-fields .background-monitor-count { grid-column: 1 / -1; }
.background-monitor-count input { max-width: 92px; }
.background-monitor-macos { margin-top: 18px; padding: 10px 12px; border-left: 3px solid var(--warning); background: var(--bg-secondary); line-height: 1.5; }
.background-monitor-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 22px; }
@media (max-width: 560px) {
  .background-monitor-row { flex-wrap: wrap; }
  .background-monitor-identity { flex-basis: 45%; }
  .background-monitor-fields { grid-template-columns: 1fr; }
  .background-monitor-fields .background-monitor-count { grid-column: auto; }
}
</style>
