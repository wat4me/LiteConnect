<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MonitorData } from '../env.d'
import AppIcon from './icons/AppIcon.vue'

const props = defineProps<{
  sessionId: string
  connectionId: string
  connectionName: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()

const data = ref<MonitorData | null>(null)
const monitorError = ref('')
const starting = ref(false)
let unsub: (() => void) | null = null
let monitoredSessionId: string | null = null

const expandedSections = ref({
  system: true,
  cpu: true,
  memory: true,
  disk: false,
  processes: false,
})

function toggleSection(key: keyof typeof expandedSections.value) {
  expandedSections.value[key] = !expandedSections.value[key]
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const val = bytes / Math.pow(1024, i)
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`
}

function barColor(percent: number): string {
  if (percent >= 90) return 'var(--danger)'
  if (percent >= 70) return 'var(--warning)'
  return 'var(--success)'
}

async function startMonitor(sessionId: string, opts?: { resetData?: boolean }) {
  if (!sessionId) return
  // Same SSH session already collecting — keep charts, just ensure subscription.
  if (monitoredSessionId === sessionId && unsub && !monitorError.value) return

  stopMonitor()
  if (opts?.resetData !== false) {
    data.value = null
  }
  monitorError.value = ''
  monitoredSessionId = sessionId
  starting.value = true
  try {
    await window.LiteConnect.monitorStart(sessionId)
    unsub = window.LiteConnect.onMonitorData(sessionId, (d: MonitorData) => {
      data.value = d
      monitorError.value = ''
    })
  } catch (err: any) {
    monitorError.value = err?.message || t('monitor.startFailed')
    monitoredSessionId = null
  } finally {
    starting.value = false
  }
}

function retryMonitor() {
  void startMonitor(props.sessionId, { resetData: true })
}

function stopMonitor() {
  unsub?.()
  unsub = null
  if (monitoredSessionId) {
    window.LiteConnect.monitorStop(monitoredSessionId).catch(() => {})
    monitoredSessionId = null
  }
}

onMounted(() => {
  void startMonitor(props.sessionId)
})

onBeforeUnmount(() => {
  stopMonitor()
})

// Only rebind when the host connection changes, or the pinned session was closed
// (parent swaps to another session id on the same host). Sub-tab focus changes
// should not reach here if App pins to sessions[0].
watch(
  () => [props.connectionId, props.sessionId] as const,
  ([connId, sessionId], prev) => {
    const prevConn = prev?.[0]
    const prevSession = prev?.[1]
    if (connId !== prevConn) {
      void startMonitor(sessionId, { resetData: true })
      return
    }
    if (sessionId !== prevSession && sessionId !== monitoredSessionId) {
      // Pinned session closed / replaced — rebind without treating as brand-new host if possible
      void startMonitor(sessionId, { resetData: true })
    }
  },
)

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
</script>

<template>
  <div class="monitor-panel">
    <div class="monitor-header">
      <span class="monitor-title">{{ t('monitor.title') }}</span>
      <span class="monitor-name">{{ connectionName }}</span>
      <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close monitor-close" :title="t('common.close')" :aria-label="t('monitor.closeAria')" @click="emit('close')">
        <AppIcon name="close" :size="14" />
      </button>
    </div>

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
        <div class="section-header" @click="toggleSection('system')">
          <span class="section-title">{{ t('monitor.systemInfo') }}</span>
          <AppIcon name="chevron-down" :size="12" class="section-toggle" />
        </div>
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
      <div v-else class="section-header collapsed" @click="toggleSection('system')">
        <span class="section-title">{{ t('monitor.systemInfo') }}</span>
        <AppIcon name="chevron-right" :size="12" class="section-toggle" />
      </div>

      <div class="monitor-section" v-if="expandedSections.cpu">
        <div class="section-header" @click="toggleSection('cpu')">
          <span class="section-title">CPU</span>
          <span class="section-value" :style="{ color: cpuPercent >= 0 ? barColor(cpuPercent) : 'var(--text-secondary)' }">
            {{ cpuPercent >= 0 ? `${cpuPercent}%` : '--' }}
          </span>
          <AppIcon name="chevron-down" :size="12" class="section-toggle" />
        </div>
        <div class="section-body">
          <div class="progress-bar" v-if="cpuPercent >= 0">
            <div class="progress-fill" :style="{ width: `${cpuPercent}%`, backgroundColor: barColor(cpuPercent) }"></div>
          </div>
          <div class="info-row" v-if="data.cpu.loadAvg[0] !== undefined">
            <span class="info-label">{{ t('monitor.load') }}</span>
            <span class="info-value info-mono">{{ data.cpu.loadAvg.map(v => v.toFixed(2)).join(' / ') }}</span>
          </div>
        </div>
      </div>
      <div v-else class="section-header collapsed" @click="toggleSection('cpu')">
        <span class="section-title">CPU</span>
        <span class="section-value" :style="{ color: cpuPercent >= 0 ? barColor(cpuPercent) : 'var(--text-secondary)' }">
          {{ cpuPercent >= 0 ? `${cpuPercent}%` : '--' }}
        </span>
        <AppIcon name="chevron-right" :size="12" class="section-toggle" />
      </div>

      <div class="monitor-section" v-if="expandedSections.memory">
        <div class="section-header" @click="toggleSection('memory')">
          <span class="section-title">{{ t('monitor.memory') }}</span>
          <span class="section-value" :style="{ color: barColor(memPercent) }">{{ memPercent }}%</span>
          <AppIcon name="chevron-down" :size="12" class="section-toggle" />
        </div>
        <div class="section-body">
          <div class="bar-labels">
            <span class="bar-label-used">{{ t('monitor.used', { size: formatBytes(data.memory.used) }) }}</span>
            <span class="bar-label-cache">{{ t('monitor.cache', { size: formatBytes(data.memory.buffCache) }) }}</span>
            <span class="bar-label-available">{{ t('monitor.available', { size: formatBytes(data.memory.available) }) }}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: `${memPercent}%`, backgroundColor: barColor(memPercent) }"></div>
          </div>
          <template v-if="data.memory.swapTotal > 0">
            <div class="bar-labels" style="margin-top: 6px;">
              <span class="info-label">Swap</span>
              <span class="info-value info-mono">{{ formatBytes(data.memory.swapUsed) }} / {{ formatBytes(data.memory.swapTotal) }}</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: `${swapPercent}%`, backgroundColor: barColor(swapPercent) }"></div>
            </div>
          </template>
        </div>
      </div>
      <div v-else class="section-header collapsed" @click="toggleSection('memory')">
        <span class="section-title">{{ t('monitor.memory') }}</span>
        <span class="section-value" :style="{ color: barColor(memPercent) }">{{ memPercent }}%</span>
        <AppIcon name="chevron-right" :size="12" class="section-toggle" />
      </div>

      <div class="monitor-section" v-if="expandedSections.disk">
        <div class="section-header" @click="toggleSection('disk')">
          <span class="section-title">{{ t('monitor.disk') }}</span>
          <AppIcon name="chevron-down" :size="12" class="section-toggle" />
        </div>
        <div class="section-body">
          <div v-if="data.disk.length === 0" class="info-row">{{ t('monitor.noData') }}</div>
          <div v-for="(d, i) in data.disk" :key="i" class="disk-item">
            <div class="disk-header">
              <span class="disk-mount">{{ d.mountPoint }}</span>
              <span class="disk-percent" :style="{ color: barColor(usagePercent(d.used, d.total)) }">{{ formatBytes(d.used) }} / {{ formatBytes(d.total) }}</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: `${usagePercent(d.used, d.total)}%`, backgroundColor: barColor(usagePercent(d.used, d.total)) }"></div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="section-header collapsed" @click="toggleSection('disk')">
        <span class="section-title">{{ t('monitor.disk') }}</span>
        <AppIcon name="chevron-right" :size="12" class="section-toggle" />
      </div>

      <div class="monitor-section" v-if="expandedSections.processes">
        <div class="section-header" @click="toggleSection('processes')">
          <span class="section-title">{{ t('monitor.processes') }}</span>
          <AppIcon name="chevron-down" :size="12" class="section-toggle" />
        </div>
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
              <span class="proc-num" :style="{ color: p.cpu > 50 ? 'var(--danger)' : 'inherit' }">{{ p.cpu }}</span>
              <span class="proc-num" :style="{ color: p.mem > 50 ? 'var(--danger)' : 'inherit' }">{{ p.mem }}</span>
              <span class="proc-cmd" :title="p.command">{{ p.command }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="section-header collapsed" @click="toggleSection('processes')">
        <span class="section-title">{{ t('monitor.processes') }}</span>
        <AppIcon name="chevron-right" :size="12" class="section-toggle" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.monitor-panel {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  font-size: 12px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
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
  color: var(--success);
  font-size: 13px;
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

.monitor-close {
  margin-left: auto;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.monitor-close:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
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
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
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
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s;
  user-select: none;
}

.section-header:hover {
  background: var(--bg-tertiary);
}

.section-header.collapsed {
  padding: 4px 8px;
}

.section-title {
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
}

.section-value {
  margin-left: auto;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 11px;
  font-weight: 700;
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
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

.info-empty {
  color: var(--text-secondary);
  opacity: 0.5;
}

.progress-bar {
  width: 100%;
  height: 6px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  overflow: hidden;
  margin: 2px 0;
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
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

.bar-label-cache {
  color: var(--text-secondary);
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

.bar-label-available {
  color: var(--success);
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
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
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 11px;
  color: var(--text-primary);
}

.disk-percent {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 11px;
  font-weight: 700;
}

.proc-table {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
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

.proc-pid, .proc-user, .proc-num {
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
