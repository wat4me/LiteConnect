<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { startRendererPerformanceSampling, type RendererTimingId } from '@/composables/app/rendererPerformance'

const { t } = useI18n()
type Sampling = ReturnType<typeof startRendererPerformanceSampling>
let sampling: Sampling | null = null
let timer: ReturnType<typeof setInterval> | null = null
const metrics = ref<ReturnType<Sampling['snapshot']> | null>(null)
const timingKeys: Record<RendererTimingId, string> = {
  'renderer-mounted': 'about.perfMounted', 'bootstrap-ready': 'about.perfBootstrap',
  'settings-load': 'about.perfSettingsLoad', 'database-load': 'about.perfDatabaseLoad',
  'ai-load': 'about.perfAiLoad', 'ssh-load': 'about.perfSshLoad', 'view-layout': 'about.perfViewLayout',
}

function formatMs(value: number | null | undefined) {
  return value == null ? t('about.perfUnavailable') : `${value.toFixed(1)} ms`
}
function stop() {
  if (timer) clearInterval(timer)
  timer = null
  sampling?.stop()
  sampling = null
}
function onToggle(event: Event) {
  if (!(event.currentTarget as HTMLDetailsElement).open) { stop(); return }
  if (sampling) return
  sampling = startRendererPerformanceSampling()
  metrics.value = sampling.snapshot()
  timer = setInterval(() => { if (sampling) metrics.value = sampling.snapshot() }, 1000)
}
onBeforeUnmount(stop)
</script>

<template>
  <details class="renderer-performance" @toggle="onToggle">
    <summary>{{ t('about.perfTitle') }}</summary>
    <p class="performance-hint">{{ t('about.perfHint') }}</p>
    <template v-if="metrics">
      <p v-if="!metrics.visible" class="performance-hint">{{ t('about.perfPaused') }}</p>
      <dl class="performance-grid">
        <div><dt>{{ t('about.perfFps') }}</dt><dd>{{ metrics.fps == null ? t('about.perfSampling') : metrics.fps.toFixed(1) }}</dd></div>
        <div><dt>{{ t('about.perfFrameP95') }}</dt><dd>{{ formatMs(metrics.p95Ms) }}</dd></div>
        <div><dt>{{ t('about.perfFrameMax') }}</dt><dd>{{ formatMs(metrics.maxMs) }}</dd></div>
        <div><dt>{{ t('about.perfLongTasks') }}</dt><dd>{{ metrics.longTasks?.count ?? t('about.perfUnavailable') }}</dd></div>
        <div><dt>{{ t('about.perfLongTaskTotal') }}</dt><dd>{{ formatMs(metrics.longTasks?.totalMs) }}</dd></div>
        <div><dt>{{ t('about.perfDomNodes') }}</dt><dd>{{ metrics.domNodes.toLocaleString() }}</dd></div>
        <div><dt>{{ t('about.perfFirstPaint') }}</dt><dd>{{ formatMs(metrics.firstPaintMs) }}</dd></div>
        <div v-for="timing in metrics.timings" :key="timing.id"><dt>{{ t(timingKeys[timing.id]) }}</dt><dd>{{ formatMs(timing.durationMs) }}</dd></div>
      </dl>
    </template>
  </details>
</template>

<style scoped>
.renderer-performance { margin-top: 16px; border-top: 1px solid var(--border-color); padding-top: 14px; }
summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--text-primary); }
.performance-hint { margin: 8px 0; font-size: 12px; line-height: 1.5; color: var(--text-secondary); }
.performance-grid { margin: 12px 0 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 8px 20px; }
.performance-grid > div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-width: 0; font-size: 12px; }
dt { color: var(--text-secondary); overflow-wrap: anywhere; }
dd { margin: 0; color: var(--text-primary); font-family: var(--font-mono); white-space: nowrap; }
</style>
