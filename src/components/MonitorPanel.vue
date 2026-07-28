<script setup lang="ts">
import { ref, watch, computed, toRef, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSharedMonitor } from '../composables/useMonitorData'
import AppIcon from './icons/AppIcon.vue'

const props = withDefaults(
  defineProps<{
    sessionId: string
    connectionId: string
    connectionName: string
    /** bottom: compact dock bar only; side: full details panel */
    layout?: 'bottom' | 'side'
    /** side panel open (for dock "详情" active state) */
    detailsOpen?: boolean
  }>(),
  { layout: 'bottom', detailsOpen: false },
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toggle-details'): void
}>()

const { t } = useI18n()

const sessionIdRef = toRef(props, 'sessionId')
const { data, error: monitorError, starting, retry: retryMonitor } = useSharedMonitor(sessionIdRef)

const isBottom = computed(() => props.layout === 'bottom')

/** Available width for metric chips (excludes action buttons). */
const dockMetricsRef = ref<HTMLElement | null>(null)
const dockMetricsWidth = ref(0)
let dockResizeObserver: ResizeObserver | null = null

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

/** Busiest mount for dock disk chip */
const topDisk = computed(() => {
  const disks = data.value?.disk || []
  if (disks.length === 0) return null
  let best = disks[0]
  let bestPct = usagePercent(best.used, best.total)
  for (let i = 1; i < disks.length; i++) {
    const d = disks[i]
    const p = usagePercent(d.used, d.total)
    if (p > bestPct) {
      best = d
      bestPct = p
    }
  }
  return { mount: best.mountPoint, percent: bestPct, used: best.used, total: best.total }
})

const load1 = computed(() => {
  const v = data.value?.cpu.loadAvg?.[0]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
})

const topProcess = computed(() => {
  const list = data.value?.processes || []
  if (list.length === 0) return null
  return list[0]
})

/**
 * Progressive disclosure by available chip row width:
 * always CPU+MEM → disk → load → host → top process
 */
const showDockDisk = computed(() => dockMetricsWidth.value >= 300)
const showDockLoad = computed(() => dockMetricsWidth.value >= 420)
const showDockHost = computed(() => dockMetricsWidth.value >= 540)
const showDockProcess = computed(() => dockMetricsWidth.value >= 700)

function bindDockObserver() {
  unbindDockObserver()
  const el = dockMetricsRef.value
  if (!el || typeof ResizeObserver === 'undefined') return
  dockResizeObserver = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect?.width
    if (typeof w === 'number') dockMetricsWidth.value = w
  })
  dockResizeObserver.observe(el)
  dockMetricsWidth.value = el.clientWidth
}

function unbindDockObserver() {
  dockResizeObserver?.disconnect()
  dockResizeObserver = null
}

watch(isBottom, async (bottom) => {
  if (bottom) {
    await nextTick()
    bindDockObserver()
  } else {
    unbindDockObserver()
  }
})

onMounted(async () => {
  if (isBottom.value) {
    await nextTick()
    bindDockObserver()
  }
})

onBeforeUnmount(() => {
  unbindDockObserver()
})

// Host change: clear expanded state only (data handled by shared collector)
watch(
  () => props.connectionId,
  () => {
    expandedSections.value = {
      system: true,
      cpu: true,
      memory: true,
      disk: false,
      processes: false,
    }
  },
)
</script>

<template>
  <div class="monitor-panel" :class="{ 'is-bottom': isBottom, 'is-side': !isBottom }">
    <!-- Bottom compact dock (never expands downward); metrics adapt to width -->
    <div v-if="isBottom" class="monitor-dock-bar">
      <div ref="dockMetricsRef" class="dock-metrics">
        <template v-if="monitorError">
          <span class="dock-error">{{ t('monitor.unavailable') }}</span>
          <button type="button" class="ui-btn ui-btn-xs" :disabled="starting" @click="retryMonitor">{{ t('monitor.retry') }}</button>
        </template>
        <template v-else-if="!data">
          <span class="dock-loading">{{ t('common.loading') }}</span>
        </template>
        <template v-else>
          <div
            v-if="showDockHost && data.hostname"
            class="dock-chip dock-host"
            :title="`${t('monitor.hostname')}: ${data.hostname}`"
          >
            <span class="dock-chip-text">{{ data.hostname }}</span>
          </div>

          <div class="dock-metric" :title="cpuPercent >= 0 ? `CPU ${cpuPercent}%` : 'CPU'">
            <span class="dock-metric-label">CPU</span>
            <div class="dock-bar">
              <div
                class="dock-bar-fill"
                :style="{ width: `${Math.max(0, cpuPercent)}%`, backgroundColor: cpuPercent >= 0 ? barColor(cpuPercent) : 'var(--text-secondary)' }"
              ></div>
            </div>
            <span class="dock-metric-value" :style="{ color: cpuPercent >= 0 ? barColor(cpuPercent) : 'var(--text-secondary)' }">
              {{ cpuPercent >= 0 ? `${cpuPercent}%` : '--' }}
            </span>
          </div>

          <div class="dock-metric" :title="`${t('monitor.memory')} ${memPercent}% · ${formatBytes(data.memory.used)} / ${formatBytes(data.memory.total)}`">
            <span class="dock-metric-label">{{ t('monitor.memory') }}</span>
            <div class="dock-bar">
              <div class="dock-bar-fill" :style="{ width: `${memPercent}%`, backgroundColor: barColor(memPercent) }"></div>
            </div>
            <span class="dock-metric-value" :style="{ color: barColor(memPercent) }">{{ memPercent }}%</span>
          </div>

          <div
            v-if="showDockDisk && topDisk"
            class="dock-metric"
            :title="`${t('monitor.disk')} ${topDisk.mount} · ${topDisk.percent}% · ${formatBytes(topDisk.used)} / ${formatBytes(topDisk.total)}`"
          >
            <span class="dock-metric-label">{{ t('monitor.disk') }}</span>
            <div class="dock-bar">
              <div class="dock-bar-fill" :style="{ width: `${topDisk.percent}%`, backgroundColor: barColor(topDisk.percent) }"></div>
            </div>
            <span class="dock-metric-value" :style="{ color: barColor(topDisk.percent) }">{{ topDisk.percent }}%</span>
          </div>

          <div
            v-if="showDockLoad && load1 != null"
            class="dock-chip"
            :title="`${t('monitor.load')} ${data.cpu.loadAvg.map((v) => v.toFixed(2)).join(' / ')}`"
          >
            <span class="dock-metric-label">{{ t('monitor.load') }}</span>
            <span class="dock-metric-value dock-load-value">{{ load1.toFixed(2) }}</span>
          </div>

          <div
            v-if="showDockProcess && topProcess"
            class="dock-chip dock-proc"
            :title="`PID ${topProcess.pid} · CPU ${topProcess.cpu}% · ${topProcess.command}`"
          >
            <span class="dock-metric-label">{{ t('monitor.topProc') }}</span>
            <span class="dock-chip-text">{{ topProcess.command }}</span>
            <span class="dock-metric-value" :style="{ color: topProcess.cpu > 50 ? 'var(--danger)' : undefined }">
              {{ topProcess.cpu }}%
            </span>
          </div>
        </template>
      </div>

      <div class="dock-actions">
        <button
          type="button"
          class="ui-btn ui-btn-xs ui-btn-ghost dock-details-btn"
          :class="{ active: detailsOpen }"
          :title="detailsOpen ? t('monitor.collapseDetails') : t('monitor.expandDetails')"
          @click="emit('toggle-details')"
        >
          {{ detailsOpen ? t('monitor.collapseDetails') : t('monitor.expandDetails') }}
          <AppIcon :name="detailsOpen ? 'chevron-right' : 'chevron-left'" :size="12" />
        </button>
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" :title="t('common.close')" :aria-label="t('monitor.closeAria')" @click="emit('close')">
          <AppIcon name="close" :size="14" />
        </button>
      </div>
    </div>

    <!-- Side full details -->
    <template v-else>
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
              <span class="info-value info-mono">{{ data.cpu.loadAvg.map((v) => v.toFixed(2)).join(' / ') }}</span>
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
              <div class="bar-labels" style="margin-top: 6px">
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
    </template>
  </div>
</template>

<style scoped>
.monitor-panel {
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.monitor-panel.is-side {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px;
}

.monitor-panel.is-bottom {
  height: auto;
  padding: 0;
  overflow: hidden;
  gap: 0;
}

.monitor-dock-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  min-height: 36px;
  flex-shrink: 0;
}

.dock-metrics {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  overflow: hidden;
}

.dock-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.dock-metric {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-shrink: 0;
}

.dock-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-shrink: 1;
  max-width: 180px;
  padding: 2px 0;
}

.dock-host {
  max-width: 120px;
}

.dock-proc {
  max-width: 200px;
}

.dock-chip-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
}

.dock-load-value {
  min-width: 2.8em;
}

.dock-metric-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.dock-metric-value {
  font-family: var(--font-mono, 'Cascadia Code', Consolas, monospace);
  font-size: 11px;
  font-weight: 700;
  min-width: 2.4em;
  text-align: right;
}

.dock-bar {
  width: 72px;
  height: 6px;
  border-radius: 3px;
  background: var(--bg-tertiary);
  overflow: hidden;
  flex-shrink: 0;
}

.dock-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease, background-color 0.4s ease;
  min-width: 2px;
}

.dock-error {
  font-size: 11px;
  color: var(--danger);
}

.dock-loading {
  font-size: 11px;
  color: var(--text-secondary);
}

.dock-details-btn {
  gap: 4px;
}

.dock-details-btn.active {
  color: var(--accent);
  background: var(--accent-bg);
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

.monitor-close {
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
