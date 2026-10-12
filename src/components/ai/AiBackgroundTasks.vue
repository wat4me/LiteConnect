<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAiBackgroundJobs } from '@/composables/ai/useAiBackgroundJobs'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{ sessionId: string }>()
const { t } = useI18n()
const { sessionJobs, runningCount } = useAiBackgroundJobs(() => props.sessionId)
const displayedJobs = computed(() => [
  ...sessionJobs.value.filter(job => job.status === 'running'),
  ...sessionJobs.value.filter(job => job.status !== 'running').slice(0, 5),
])
const statusKeys = { running: 'ai.backgroundRunning', completed: 'ai.backgroundCompleted', failed: 'ai.backgroundFailed', cancelled: 'ai.backgroundCancelled', timeout: 'ai.backgroundTimeout' } as const
</script>

<template>
  <details v-if="sessionJobs.length" class="ai-background-tasks" :class="{ running: runningCount > 0 }">
    <summary>
      <AppIcon name="activity" size="sm" />
      <span>{{ runningCount ? t('ai.backgroundTaskCount', { count: runningCount }) : t('ai.backgroundRecentTasks') }}</span>
      <AppIcon name="chevron-down" size="xs" />
    </summary>
    <p class="background-task-hint">{{ t('ai.backgroundTaskHint') }}</p>
    <ul>
      <li v-for="job in displayedJobs" :key="job.jobId" :data-status="job.status === 'completed' && job.exitCode != null && job.exitCode !== 0 ? 'failed' : job.status">
        <code :title="job.command">{{ job.command }}</code>
        <span>{{ t(statusKeys[job.status === 'completed' && job.exitCode != null && job.exitCode !== 0 ? 'failed' : job.status]) }}<template v-if="job.exitCode != null"> · {{ job.exitCode }}</template></span>
      </li>
    </ul>
  </details>
</template>

<style scoped>
.ai-background-tasks { flex-shrink: 0; margin: 6px 12px; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-secondary); font-size: 11px; }
.ai-background-tasks.running { color: var(--accent); background: var(--accent-bg); }
summary { display: flex; align-items: center; gap: 6px; list-style: none; cursor: pointer; line-height: 1.4; }
summary::-webkit-details-marker { display: none; }
summary > span { flex: 1; min-width: 0; }
.background-task-hint { margin: 8px 0; color: var(--text-secondary); line-height: 1.45; }
ul { list-style: none; padding: 0; margin: 0; max-height: 160px; overflow-y: auto; }
li { display: flex; align-items: center; gap: 8px; padding: 4px 0; color: var(--text-primary); }
code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
li > span { flex-shrink: 0; color: var(--text-secondary); }
li[data-status="running"] > span { color: var(--accent); }
li[data-status="failed"] > span, li[data-status="timeout"] > span { color: var(--danger); }
</style>
