<script setup lang="ts">
import { ref, watch, computed, toRef, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSharedMonitor } from '@/composables/monitor/useMonitorData'
import AppIcon from '@/components/icons/AppIcon.vue'
import MonitorAlertDialog from './MonitorAlertDialog.vue'
import FeatureTipBanner from '@/components/common/FeatureTipBanner.vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { formatBytes } from '@shared/formatBytes'
import { DEFAULT_MONITOR_ALERT_RULE, type MonitorAlertRule } from '../../../shared/monitorAlerts'
import { TIP_MONITOR_KEY } from '@/utils/shared/featureTips'

const props = defineProps<{
  sessionId: string
  connectionId: string
  connectionName: string
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()

const sessionIdRef = toRef(props, 'sessionId')
const connectionIdRef = toRef(props, 'connectionId')
const { data, updatedAt: monitorUpdatedAt, error: monitorError, starting, retry: retryMonitor } = useSharedMonitor(connectionIdRef, sessionIdRef)
const alertRule = ref<MonitorAlertRule>({ ...DEFAULT_MONITOR_ALERT_RULE })
const alertDialogOpen = ref(false)
const alertSaving = ref(false)

watch(() => props.connectionId, async (connectionId) => {
  alertDialogOpen.value = false
  alertRule.value = { ...DEFAULT_MONITOR_ALERT_RULE }
  try {
    const next = await window.LiteConnect.monitorGetAlertRule(connectionId)
    if (props.connectionId === connectionId) alertRule.value = next
  } catch { /* Monitoring remains usable if alert settings cannot load. */ }
}, { immediate: true })

async function openAlertSettings() {
  const connectionId = props.connectionId
  try {
    const current = await window.LiteConnect.monitorGetAlertRule(connectionId)
    if (props.connectionId !== connectionId) return
    alertRule.value = current
  } catch { /* Use the last loaded rule if the refresh fails. */ }
  alertDialogOpen.value = true
}

async function saveAlertSettings(rule: MonitorAlertRule) {
  const connectionId = props.connectionId
  alertSaving.value = true
  try {
    const saved = await window.LiteConnect.monitorSetAlertRule(connectionId, rule)
    if (props.connectionId !== connectionId) return
    alertRule.value = saved
    alertDialogOpen.value = false
    ElMessage.success(t('monitor.alertSaved'))
  } catch (err: any) {
    ElMessage.error(err?.message || t('monitor.alertSaveFailed'))
  } finally {
    alertSaving.value = false
  }
}

const alertButtonHint = computed(() => [
  t('monitor.alertSettings'),
  alertRule.value.enabled ? t('monitor.alertStatusOn') : '',
  t('monitor.thresholdHint', { cpu: alertRule.value.cpuThreshold, memory: alertRule.value.memoryThreshold }),
].filter(Boolean).join(' · '))

const MONITOR_SECTIONS_KEY = 'LiteConnect.monitor.sections.v1'
const DEFAULT_SECTIONS = {
  system: true,
  cpu: true,
  memory: true,
  disk: false,
  processes: false,
}

function loadSections() {
  try {
    const raw = JSON.parse(localStorage.getItem(MONITOR_SECTIONS_KEY) || 'null') as Record<string, unknown> | null
    if (raw && typeof raw === 'object') {
      return Object.fromEntries(Object.keys(DEFAULT_SECTIONS).map(key => [key, raw[key] === true])) as typeof DEFAULT_SECTIONS
    }
  } catch { /* Ignore unavailable storage and use defaults. */ }
  return { ...DEFAULT_SECTIONS }
}

const expandedSections = ref(loadSections())
watch(expandedSections, value => {
  try { localStorage.setItem(MONITOR_SECTIONS_KEY, JSON.stringify(value)) } catch { /* Ignore quota / private mode. */ }
}, { deep: true })

function toggleSection(key: keyof typeof expandedSections.value) {
  expandedSections.value[key] = !expandedSections.value[key]
}

const now = ref(Date.now())
let freshnessClock: ReturnType<typeof setInterval> | undefined
onMounted(() => { freshnessClock = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => { if (freshnessClock) clearInterval(freshnessClock) })

const freshnessSeconds = computed(() => monitorUpdatedAt.value ? Math.max(0, Math.floor((now.value - monitorUpdatedAt.value) / 1000)) : null)
const freshnessText = computed(() => {
  const seconds = freshnessSeconds.value
  if (seconds === null) return ''
  return seconds < 1 ? t('monitor.updatedJustNow') : t('monitor.updatedAgo', { seconds })
})
const isStale = computed(() => (freshnessSeconds.value ?? 0) > 30)

const HEALTH_WARN_AT = 70
const HEALTH_DANGER_AT = 90
const ALERT_LEAD_PERCENT = 20

/** Fixed reference marks for disk / swap, which never trigger notifications. */
function healthColor(percent: number): string {
  if (percent >= HEALTH_DANGER_AT) return 'var(--danger)'
  if (percent >= HEALTH_WARN_AT) return 'var(--warning)'
  return 'var(--success)'
}

/** CPU / memory bars follow the per-host alert rule, so red means "will notify". */
function alertColor(percent: number, threshold: number): string {
  if (percent >= threshold) return 'var(--danger)'
  if (percent >= threshold - ALERT_LEAD_PERCENT) return 'var(--warning)'
  return 'var(--success)'
}

function processColor(percent: number): string {
  if (percent >= HEALTH_DANGER_AT) return 'var(--danger)'
  if (percent >= HEALTH_WARN_AT) return 'var(--warning)'
  return 'inherit'
}

const cpuBarStyle = computed(() => ({
  '--bar-warn': `${Math.max(0, alertRule.value.cpuThreshold - ALERT_LEAD_PERCENT)}%`,
  '--bar-danger': `${alertRule.value.cpuThreshold}%`,
}))
const memoryBarStyle = computed(() => ({
  '--bar-warn': `${Math.max(0, alertRule.value.memoryThreshold - ALERT_LEAD_PERCENT)}%`,
  '--bar-danger': `${alertRule.value.memoryThreshold}%`,
}))

function usagePercent(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0
}

const cpuPercent = computed(() => data.value?.cpu.usage ?? -1)
const memPercent = computed(() => {
  if (!data.value) return 0
  return usagePercent(data.value.memory.used, data.value.memory.total)
})
const swapPercent = computed(() => {
  if (!data.value || !data.value.memory.swapTotal) return 0
  return usagePercent(data.value.memory.swapUsed, data.value.memory.swapTotal)
})
const diskMaxPercent = computed(() => {
  if (!data.value || data.value.disk.length === 0) return -1
  return Math.max(...data.value.disk.map((d) => usagePercent(d.used, d.total)))
})

// Expanded sections are persisted across hosts and sessions; the shared collector handles data.
</script>

<template>
  <div class="monitor-panel">
    <div class="monitor-header">
      <span class="monitor-title">{{ t('monitor.title') }}</span>
      <span class="monitor-name" :title="connectionName">{{ connectionName }}</span>
      <span v-if="freshnessText" class="monitor-freshness" :class="{ stale: isStale }" :title="t('monitor.freshnessHint')">{{ freshnessText }}</span>
      <div class="monitor-header-actions">
        <button
          type="button"
          class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm monitor-alert-btn"
          :class="{ 'is-on': alertRule.enabled }"
          :title="alertButtonHint"
          :aria-label="alertButtonHint"
          :aria-pressed="alertRule.enabled"
          @click="openAlertSettings"
        >
          <AppIcon name="bell" size="sm" />
        </button>
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" :title="t('common.close')" :aria-label="t('monitor.closeAria')" @click="emit('close')">
          <AppIcon name="close" size="sm" />
        </button>
      </div>
    </div>

    <FeatureTipBanner :tip-key="TIP_MONITOR_KEY" :title="t('monitor.tipTitle')" :body="t('monitor.tipBody')" />

    <div v-if="monitorError" class="monitor-error">
      <p class="monitor-error-title">{{ t('monitor.unavailable') }}</p>
      <p class="monitor-error-text">{{ monitorError }}</p>
      <button type="button" class="ui-btn ui-btn-sm" :disabled="starting" @click="retryMonitor">{{ t('monitor.retry') }}</button>
    </div>

    <div v-else-if="!data" class="monitor-loading" aria-busy="true" :aria-label="t('monitor.loadingAria')">
      <div class="monitor-skeleton-block">
        <div class="ui-skeleton monitor-skel-title"></div>
        <div class="ui-skeleton monitor-skel-line" v-for="i in 4" :key="'sys-' + i"></div>
      </div>
      <div class="monitor-skeleton-block">
        <div class="ui-skeleton monitor-skel-title"></div>
        <div class="ui-skeleton monitor-skel-bar"></div>
        <div class="ui-skeleton monitor-skel-line short"></div>
      </div>
      <div class="monitor-skeleton-block">
        <div class="ui-skeleton monitor-skel-title"></div>
        <div class="ui-skeleton monitor-skel-bar"></div>
        <div class="ui-skeleton monitor-skel-line"></div>
      </div>
    </div>

    <template v-else>
      <div class="monitor-section" v-if="expandedSections.system">
        <button type="button" class="section-header" :aria-expanded="true" @click="toggleSection('system')">
          <span class="section-title">{{ t('monitor.systemInfo') }}</span>
          <AppIcon name="chevron-down" size="xs" class="section-toggle" />
        </button>
        <div class="section-body">
          <div class="info-row">
            <span class="info-label">{{ t('monitor.hostname') }}</span>
            <span class="info-value" :class="{ 'info-empty': !data.hostname }">{{ data.hostname || '--' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">{{ t('monitor.kernel') }}</span>
            <span class="info-value info-mono" :class="{ 'info-empty': !data.kernel }">{{ data.kernel || '--' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">{{ t('monitor.arch') }}</span>
            <span class="info-value" :class="{ 'info-empty': !data.arch }">{{ data.arch || '--' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">{{ t('monitor.uptime') }}</span>
            <span class="info-value" :class="{ 'info-empty': !data.uptime }">{{ data.uptime || '--' }}</span>
          </div>
        </div>
      </div>
      <button v-else type="button" class="section-header collapsed" :aria-expanded="false" @click="toggleSection('system')">
        <span class="section-title">{{ t('monitor.systemInfo') }}</span>
        <AppIcon name="chevron-right" size="xs" class="section-toggle" />
      </button>

      <div class="monitor-section" v-if="expandedSections.cpu">
        <button type="button" class="section-header" :aria-expanded="true" @click="toggleSection('cpu')">
          <span class="section-title">CPU</span>
          <span class="section-value" :style="{ color: cpuPercent >= 0 ? alertColor(cpuPercent, alertRule.cpuThreshold) : 'var(--text-secondary)' }">
            {{ cpuPercent >= 0 ? `${cpuPercent}%` : '--' }}
          </span>
          <AppIcon name="chevron-down" size="xs" class="section-toggle" />
        </button>
        <div class="section-body">
          <div class="progress-bar" :style="cpuBarStyle" v-if="cpuPercent >= 0">
            <div class="progress-fill" :style="{ width: `${cpuPercent}%`, backgroundColor: alertColor(cpuPercent, alertRule.cpuThreshold) }"></div>
          </div>
          <div class="info-row" v-if="data.cpu.loadAvg[0] !== undefined">
            <span class="info-label">{{ t('monitor.load') }}</span>
            <span class="info-value info-mono">{{ data.cpu.loadAvg.map((v) => v.toFixed(2)).join(' / ') }}</span>
          </div>
        </div>
      </div>
      <button v-else type="button" class="section-header collapsed" :aria-expanded="false" @click="toggleSection('cpu')">
        <span class="section-title">CPU</span>
        <span class="section-value" :style="{ color: cpuPercent >= 0 ? alertColor(cpuPercent, alertRule.cpuThreshold) : 'var(--text-secondary)' }">
          {{ cpuPercent >= 0 ? `${cpuPercent}%` : '--' }}
        </span>
        <AppIcon name="chevron-right" size="xs" class="section-toggle" />
      </button>

      <div class="monitor-section" v-if="expandedSections.memory">
        <button type="button" class="section-header" :aria-expanded="true" @click="toggleSection('memory')">
          <span class="section-title">{{ t('monitor.memory') }}</span>
          <span class="section-value" :style="{ color: alertColor(memPercent, alertRule.memoryThreshold) }">{{ memPercent }}%</span>
          <AppIcon name="chevron-down" size="xs" class="section-toggle" />
        </button>
        <div class="section-body">
          <div class="bar-labels">
            <span class="bar-label-used">{{ t('monitor.used', { size: formatBytes(data.memory.used) }) }}</span>
            <span class="bar-label-cache">{{ t('monitor.cache', { size: formatBytes(data.memory.buffCache) }) }}</span>
            <span class="bar-label-available">{{ t('monitor.available', { size: formatBytes(data.memory.available) }) }}</span>
          </div>
          <div class="progress-bar" :style="memoryBarStyle">
            <div class="progress-fill" :style="{ width: `${memPercent}%`, backgroundColor: alertColor(memPercent, alertRule.memoryThreshold) }"></div>
          </div>
          <template v-if="data.memory.swapTotal > 0">
            <div class="bar-labels" style="margin-top: 6px">
              <span class="info-label">Swap</span>
              <span class="info-value info-mono">{{ formatBytes(data.memory.swapUsed) }} / {{ formatBytes(data.memory.swapTotal) }}</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: `${swapPercent}%`, backgroundColor: healthColor(swapPercent) }"></div>
            </div>
          </template>
        </div>
      </div>
      <button v-else type="button" class="section-header collapsed" :aria-expanded="false" @click="toggleSection('memory')">
        <span class="section-title">{{ t('monitor.memory') }}</span>
        <span class="section-value" :style="{ color: alertColor(memPercent, alertRule.memoryThreshold) }">{{ memPercent }}%</span>
        <AppIcon name="chevron-right" size="xs" class="section-toggle" />
      </button>

      <div class="monitor-section" v-if="expandedSections.disk">
        <button type="button" class="section-header" :aria-expanded="true" @click="toggleSection('disk')">
          <span class="section-title">{{ t('monitor.disk') }}</span>
          <span class="section-value" :style="{ color: diskMaxPercent >= 0 ? healthColor(diskMaxPercent) : 'var(--text-secondary)' }">{{ diskMaxPercent >= 0 ? diskMaxPercent + '%' : '--' }}</span>
          <AppIcon name="chevron-down" size="xs" class="section-toggle" />
        </button>
        <div class="section-body">
          <div v-if="data.disk.length === 0" class="info-row">{{ t('monitor.noData') }}</div>
          <div v-for="(d, i) in data.disk" :key="i" class="disk-item">
            <div class="disk-header">
              <span class="disk-mount">{{ d.mountPoint }}</span>
              <span class="disk-percent" :style="{ color: healthColor(usagePercent(d.used, d.total)) }">{{ usagePercent(d.used, d.total) }}% · {{ formatBytes(d.used) }} / {{ formatBytes(d.total) }}</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: `${usagePercent(d.used, d.total)}%`, backgroundColor: healthColor(usagePercent(d.used, d.total)) }"></div>
            </div>
          </div>
        </div>
      </div>
      <button v-else type="button" class="section-header collapsed" :aria-expanded="false" @click="toggleSection('disk')">
        <span class="section-title">{{ t('monitor.disk') }}</span>
        <span class="section-value" :style="{ color: diskMaxPercent >= 0 ? healthColor(diskMaxPercent) : 'var(--text-secondary)' }">{{ diskMaxPercent >= 0 ? diskMaxPercent + '%' : '--' }}</span>
        <AppIcon name="chevron-right" size="xs" class="section-toggle" />
      </button>

      <div class="monitor-section" v-if="expandedSections.processes">
        <button type="button" class="section-header" :aria-expanded="true" @click="toggleSection('processes')">
          <span class="section-title">{{ t('monitor.processes') }}</span>
          <AppIcon name="chevron-down" size="xs" class="section-toggle" />
        </button>
        <div class="section-body">
          <div v-if="data.processes.length === 0" class="info-row">{{ t('monitor.noData') }}</div>
          <div v-else class="proc-table">
            <div class="proc-header">
              <span>PID</span>
              <span>USER</span>
              <span>CPU%</span>
              <span>MEM%</span>
              <span>COMMAND</span>
            </div>
            <div v-for="(p, i) in data.processes.slice(0, 5)" :key="i" class="proc-row">
              <span class="proc-pid">{{ p.pid }}</span>
              <span class="proc-user">{{ p.user }}</span>
              <span class="proc-num" :style="{ color: processColor(p.cpu) }">{{ p.cpu }}</span>
              <span class="proc-num" :style="{ color: processColor(p.mem) }">{{ p.mem }}</span>
              <span class="proc-cmd" :title="p.command">{{ p.command }}</span>
            </div>
          </div>
        </div>
      </div>
      <button v-else type="button" class="section-header collapsed" :aria-expanded="false" @click="toggleSection('processes')">
        <span class="section-title">{{ t('monitor.processes') }}</span>
        <AppIcon name="chevron-right" size="xs" class="section-toggle" />
      </button>
    </template>
    <MonitorAlertDialog
      :open="alertDialogOpen"
      :connection-name="connectionName"
      :rule="alertRule"
      :saving="alertSaving"
      @save="saveAlertSettings"
      @close="alertDialogOpen = false"
    />
  </div>
</template>

<style scoped>
.monitor-panel {
  --progress-tick: color-mix(in srgb, var(--text-primary) 55%, transparent);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px;
}

.monitor-alert-btn { position: relative; }
.monitor-alert-btn.is-on { color: var(--success); }
.monitor-alert-btn.is-on::after {
  content: '';
  position: absolute;
  top: 2px;
  right: 2px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 1px var(--bg-secondary);
}

.monitor-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 4px;
}

.monitor-title {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 13px;
  flex-shrink: 0;
}

.monitor-name {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.monitor-freshness {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.monitor-freshness.stale { color: var(--warning); }

.monitor-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex-shrink: 0;
}

.monitor-error {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-secondary);
}

.monitor-error-title {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.monitor-error-text {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--danger);
}

.monitor-loading {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px 4px;
}

.monitor-skeleton-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px 8px;
}

.monitor-skel-title {
  height: 12px;
  width: 40%;
}

.monitor-skel-line {
  height: 10px;
  width: 100%;
}

.monitor-skel-line.short {
  width: 55%;
}

.monitor-skel-bar {
  height: 6px;
  width: 100%;
  border-radius: 3px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
}

.section-header:hover {
  background: var(--bg-tertiary);
}

.section-header:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.section-title {
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
}

.section-value {
  margin-left: auto;
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  font-size: 14px;
  line-height: 1;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.section-toggle {
  font-size: 9px;
  color: var(--text-secondary);
  flex-shrink: 0;
  opacity: 0.6;
}

.section-body {
  padding: 4px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 20px;
}

.info-label {
  color: var(--text-secondary);
  font-size: 11px;
  flex-shrink: 0;
}

.info-value {
  color: var(--text-primary);
  font-size: 11px;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-mono {
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
}

.info-empty {
  color: var(--text-secondary);
  opacity: 0.5;
}

.progress-bar {
  position: relative;
  width: 100%;
  height: 6px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  overflow: hidden;
  margin: 2px 0;
}

/* Ticks follow the per-host alert thresholds for CPU/memory; disk/swap keep 70/90 reference marks. */
.progress-bar::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(to right, transparent calc(var(--bar-warn, 70%) - 1px), var(--progress-tick) calc(var(--bar-warn, 70%) - 1px), var(--progress-tick) var(--bar-warn, 70%), transparent var(--bar-warn, 70%)),
    linear-gradient(to right, transparent calc(var(--bar-danger, 90%) - 1px), var(--progress-tick) calc(var(--bar-danger, 90%) - 1px), var(--progress-tick) var(--bar-danger, 90%), transparent var(--bar-danger, 90%));
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s ease, background-color 0.5s ease;
  min-width: 2px;
}

.bar-labels {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
}

.bar-label-used {
  color: var(--text-primary);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
}

.bar-label-cache {
  color: var(--text-secondary);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
}

.bar-label-available {
  color: var(--success);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  margin-left: auto;
}

.disk-item {
  margin-bottom: 6px;
}

.disk-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
}

.disk-mount {
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  font-size: 11px;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.disk-percent {
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  white-space: nowrap;
}

.proc-table {
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  font-size: 10px;
}

.proc-header {
  display: grid;
  grid-template-columns: 42px 40px 36px 36px 1fr;
  gap: 4px;
  color: var(--text-secondary);
  font-weight: 600;
  padding: 2px 0;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 2px;
}

.proc-row {
  display: grid;
  grid-template-columns: 42px 40px 36px 36px 1fr;
  gap: 4px;
  padding: 1px 0;
  color: var(--text-primary);
}

.proc-pid,
.proc-user,
.proc-num {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.proc-cmd {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
