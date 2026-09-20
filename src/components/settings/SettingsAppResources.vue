<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  attachRendererEstimates,
  formatBytes,
  type AppFeatureId,
  type AppProcessKind,
  type AppProcessMemory,
  type AppResourceStats,
  type AppUtilityKind,
  type AppWindowRole,
} from '@shared/appResourceStats'
import { collectRendererResourceSnapshot } from '@/composables/app/rendererResourceRegistry'
import AppIcon from '../icons/AppIcon.vue'

const { t } = useI18n()
const emit = defineEmits<{
  (e: 'updated'): void
}>()

const stats = ref<AppResourceStats | null>(null)
const error = ref('')
let timer = 0

const processKindLabel: Record<AppProcessKind, string> = {
  main: 'about.processMain',
  renderer: 'about.processRenderer',
  gpu: 'about.processGpu',
  utility: 'about.processUtility',
  other: 'about.processOther',
}

const processKindHint: Record<AppProcessKind, string> = {
  main: 'about.processMainHint',
  renderer: 'about.processRendererHint',
  gpu: 'about.processGpuHint',
  utility: 'about.processUtilityHint',
  other: 'about.processOtherHint',
}

const windowRoleLabel: Record<AppWindowRole, string> = {
  main: 'about.windowMain',
  database: 'about.windowDatabase',
  detached: 'about.windowDetached',
}

const featureLabel: Record<AppFeatureId, string> = {
  electron: 'about.featureElectron',
  ssh: 'about.featureSsh',
  sftp: 'about.featureSftp',
  database: 'about.featureDatabase',
  ai: 'about.featureAi',
}

const kindOrder: Record<AppProcessKind, number> = {
  renderer: 0,
  main: 1,
  gpu: 2,
  utility: 3,
  other: 4,
}

const maxProcessBytes = computed(() => {
  const list = stats.value?.processes || []
  return list.reduce((max, proc) => Math.max(max, proc.workingSetBytes), 0) || 1
})

const orderedProcesses = computed(() => {
  const list = [...(stats.value?.processes || [])]
  return list.sort((a, b) => {
    const kind = kindOrder[a.kind] - kindOrder[b.kind]
    if (kind !== 0) return kind
    return b.workingSetBytes - a.workingSetBytes
  })
})

const featureRows = computed(() => (stats.value?.features || []).filter((feature) => feature.id !== 'electron'))

const utilityTitle: Record<AppUtilityKind, string> = {
  network: 'about.processUtility',
  audio: 'about.processAudio',
  other: 'about.processUtilityGeneric',
}

const utilityHint: Record<AppUtilityKind, string> = {
  network: 'about.processUtilityHint',
  audio: 'about.processAudioHint',
  other: 'about.processUtilityGenericHint',
}

function processTitle(proc: AppProcessMemory): string {
  const kindText = proc.kind === 'utility' && proc.utilityKind
    ? t(utilityTitle[proc.utilityKind])
    : t(processKindLabel[proc.kind])
  return proc.role ? `${kindText}（${t(windowRoleLabel[proc.role])}）` : kindText
}

function processHint(proc: AppProcessMemory): string {
  if (proc.kind === 'utility' && proc.utilityKind) return t(utilityHint[proc.utilityKind])
  return t(processKindHint[proc.kind])
}

function barWidth(bytes: number): string {
  return `${Math.max(2, Math.round((bytes / maxProcessBytes.value) * 100))}%`
}

function featureDetail(id: AppFeatureId, bytes: number | null, count: number): string {
  if (count === 0) return t('about.featureIdle')
  if (id === 'database' && stats.value?.windows.database && bytes != null) {
    return t('about.featureMeasured', { size: formatBytes(bytes) })
  }
  if (bytes != null) return t('about.featureEstimate', { size: formatBytes(bytes) })
  return t('about.featureUnknown')
}

async function refresh() {
  try {
    const main = await window.LiteConnect.getAppResourceStats()
    stats.value = attachRendererEstimates(main, collectRendererResourceSnapshot())
    error.value = ''
    emit('updated')
  } catch (err: any) {
    error.value = typeof err?.message === 'string' ? err.message : t('about.resourcesLoadFailed')
  }
}

onMounted(() => {
  void refresh()
  timer = window.setInterval(() => {
    void refresh()
  }, 2000)
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <div class="app-resources">
    <p v-if="error" class="resources-error">{{ error }}</p>

    <template v-else-if="stats">
      <div class="resources-total">
        <span>{{ t('about.resourcesTotal') }}</span>
        <span class="resources-badge">{{ t('about.resourcesMeasured') }}</span>
        <strong>{{ formatBytes(stats.totalWorkingSetBytes) }}</strong>
      </div>
      <p class="app-resources-hint">{{ t('about.resourcesHint') }}</p>

      <div class="resources-section-label">{{ t('about.resourcesOpen') }}</div>
      <ul class="resources-feature-list">
        <li v-for="feature in featureRows" :key="feature.id" class="resources-feature">
          <div class="resources-feature-title">
            <span>{{ t(featureLabel[feature.id]) }}</span>
            <span class="resources-size">{{ t('about.featureCount', { n: feature.count }) }}</span>
          </div>
          <div class="resources-feature-detail">
            {{ featureDetail(feature.id, feature.estimatedBytes, feature.count) }}
          </div>
        </li>
      </ul>
      <p class="app-resources-hint">{{ t('about.sshWindowHint') }}</p>

      <details class="resources-details">
        <summary><AppIcon name="chevron-right" size="xs" class="details-chevron" />{{ t('about.resourcesBreakdown') }}</summary>
        <p class="app-resources-hint">{{ t('about.resourcesBreakdownHint') }}</p>
        <ul class="resources-process-list">
          <li v-for="proc in orderedProcesses" :key="proc.pid" class="resources-process">
            <div class="resources-process-meta">
              <span>{{ processTitle(proc) }}</span>
              <span class="resources-size">{{ formatBytes(proc.workingSetBytes) }}</span>
            </div>
            <div class="resources-feature-detail">{{ processHint(proc) }}</div>
            <div class="resources-bar" aria-hidden="true">
              <span class="resources-bar-fill" :style="{ width: barWidth(proc.workingSetBytes) }"></span>
            </div>
          </li>
        </ul>
      </details>
    </template>
  </div>
</template>

<style scoped>
.app-resources-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
}

.resources-total {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  margin: 0 0 4px;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.resources-badge {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 99px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--success);
  background: color-mix(in srgb, var(--success) 14%, transparent);
}

.resources-total strong {
  margin-left: auto;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
}

.resources-section-label {
  margin: 16px 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.resources-process-list,
.resources-feature-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.resources-details {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border-color);
}

.resources-details summary {
  display: flex;
  align-items: center;
  gap: 4px;
  list-style: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  user-select: none;
}

.resources-details summary::-webkit-details-marker {
  display: none;
}

.resources-details .details-chevron {
  flex-shrink: 0;
  transition: transform 0.12s ease;
}

.resources-details[open] > summary .details-chevron {
  transform: rotate(90deg);
}

.resources-details .app-resources-hint {
  margin-top: 8px;
}

.resources-details[open] .resources-process-list {
  margin-top: 10px;
}

.resources-process-meta,
.resources-feature-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: var(--text-primary);
}

.resources-size {
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.resources-bar {
  margin-top: 4px;
  height: 6px;
  border-radius: 99px;
  background: var(--bg-tertiary, color-mix(in srgb, var(--text-secondary) 16%, transparent));
  overflow: hidden;
}

.resources-bar-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
}

.resources-feature-detail {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.resources-error {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--danger);
}
</style>
