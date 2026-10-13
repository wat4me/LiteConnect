<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiToolRun } from '@shared/types/ai'
import { createToolRunDisplayCache } from '@/utils/ai/toolRunDisplayCache'
import { toolRunPresentation } from '@/utils/ai/toolRunPresentation'
import AiToolRunRow from './AiToolRun.vue'

const props = defineProps<{ runs: AiToolRun[] }>()
const { t } = useI18n()
const { toolView } = createToolRunDisplayCache()
const counts = computed(() => {
  const result = { completed: 0, failed: 0, blocked: 0, running: 0, stopped: 0 }
  for (const run of props.runs) {
    const state = toolRunPresentation(run, toolView(run).summary).state
    if (state === 'completed') result.completed++
    else if (['blocked', 'denied', 'invalid'].includes(state)) result.blocked++
    else if (['waiting', 'running', 'started'].includes(state)) result.running++
    else if (state === 'stopped') result.stopped++
    else result.failed++
  }
  return result
})
</script>

<template>
  <details v-if="runs.length" class="ai-tool-group">
    <summary>
      <strong>{{ t('ai.toolGroup.total', { count: runs.length }) }}</strong>
      <span v-for="(count, state) in counts" v-show="count" :key="state" :data-state="state">{{ t(`ai.toolGroup.${state}`, { count }) }}</span>
    </summary>
    <div class="ai-tool-group-list"><AiToolRunRow v-for="run in runs" :key="run.id" :run="run" /></div>
  </details>
</template>

<style scoped>
.ai-tool-group { margin-top: 12px; min-width: 0; font-size: 12px; color: var(--text-secondary); }
.ai-tool-group > summary { cursor: pointer; padding: 6px 0; }
.ai-tool-group > summary span { display: inline-block; margin-left: 10px; }
.ai-tool-group [data-state=failed] { color: var(--danger); }
.ai-tool-group [data-state=blocked] { color: var(--warning); }
.ai-tool-group-list { max-height: min(45vh, 420px); overflow: auto; overscroll-behavior: contain; padding: 4px; }
</style>
