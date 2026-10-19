<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiToolRun } from '@shared/types/ai'
import type { AiWorkspaceTarget } from '@shared/aiWorkspace'
import { backgroundJobState } from '@/utils/ai/toolRunPresentation'
import AppIcon from '../icons/AppIcon.vue'
import AiToolRunRow from './AiToolRun.vue'

const props = defineProps<{ notice: string; targets?: AiWorkspaceTarget[] }>()
const { t } = useI18n()
const jobs = computed(() => {
  try {
    const parsed: unknown = JSON.parse(props.notice.slice(props.notice.indexOf('\n') + 1))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((job): job is Record<string, unknown> => !!job && typeof job === 'object' && !Array.isArray(job))
      .filter(job => typeof job.command === 'string' && typeof job.status === 'string' && ['running', 'completed', 'failed', 'timeout', 'cancelled'].includes(job.status))
  } catch { return [] }
})
const counts = computed(() => {
  const result = { completed: 0, failed: 0, running: 0, stopped: 0 }
  for (const job of jobs.value) {
    const state = backgroundJobState(String(job.status), typeof job.exitCode === 'number' ? job.exitCode : undefined)
    if (state === 'completed') result.completed++
    else if (state === 'running') result.running++
    else if (state === 'stopped') result.stopped++
    else result.failed++
  }
  return result
})
const summaryState = computed(() => (['failed', 'running', 'stopped', 'completed'] as const).find(state => counts.value[state]) || 'completed')
const runs = computed<AiToolRun[]>(() => jobs.value.map((job, index) => {
  const text = (field: string) => typeof job[field] === 'string' ? job[field] as string : ''
  const stderr = [text('stderr'), text('error')].filter(Boolean).join('\n')
  return {
    id: text('jobId') || `background-result-${index}`, name: 'exec',
    args: JSON.stringify({ command: text('command') }),
    content: JSON.stringify({
      stdout: text('stdout') || (!stderr ? t('ai.backgroundNoOutput') : ''), stderr,
      exitCode: typeof job.exitCode === 'number' ? job.exitCode : undefined,
      truncated: job.truncated === true, code: job.status === 'timeout' ? 'EXEC_TIMEOUT' : undefined,
    }),
    isError: job.status === 'failed' || job.status === 'timeout',
    status: job.status === 'cancelled' ? 'aborted' : job.status === 'running' ? 'running' : 'done',
    target: props.targets?.find(target => target.connectionId === job.connectionId)?.name,
  }
}))
</script>

<template>
  <details class="background-result-notice">
    <summary class="background-result-heading" :title="t('ai.backgroundResultsReceived')">
      <AppIcon name="background-tasks" size="sm" />
      <span class="background-result-title">{{ t('ai.backgroundResultsTitle') }}</span>
      <span v-if="jobs.length" class="background-result-counts">
        <span v-if="jobs.length > counts[summaryState]" class="background-result-total">{{ t('ai.backgroundResultCount', { count: jobs.length }) }}</span>
        <span :data-state="summaryState">{{ t(`ai.toolGroup.${summaryState}`, { count: counts[summaryState] }) }}</span>
      </span>
      <AppIcon name="chevron-down" size="xs" class="background-result-chevron" />
    </summary>
    <div class="background-result-body">
      <template v-if="runs.length">
        <p v-if="jobs.some(job => job.truncated === true)" class="background-result-truncated">{{ t('ai.toolOutputTruncated') }}</p>
        <AiToolRunRow v-for="run in runs" :key="run.id" :run="run" />
      </template>
      <p v-else class="background-result-unavailable">{{ t('ai.backgroundResultUnreadable') }}</p>
    </div>
  </details>
</template>

<style scoped>
.background-result-notice { min-width: 0; margin: 4px 0; border: 1px solid var(--border-color); border-radius: var(--radius-md); color: var(--text-secondary); background: color-mix(in srgb, var(--bg-secondary) 55%, transparent); font-size: var(--font-ui-sm); }
.background-result-heading { display: flex; align-items: center; gap: 6px; min-height: 34px; padding: 8px 10px; list-style: none; cursor: pointer; line-height: 1.4; border-radius: var(--radius-md); }
.background-result-heading::-webkit-details-marker, .background-result-heading::marker { display: none; content: ''; }
.background-result-heading:hover { background: var(--hover-bg); }
.background-result-heading:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.background-result-heading > .app-icon { flex-shrink: 0; }
.background-result-title { flex: 1; min-width: 0; white-space: nowrap; }
.background-result-counts { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 3px 6px; }
.background-result-counts > span { white-space: nowrap; }
.background-result-total { color: var(--text-secondary); }
.background-result-counts [data-state=completed] { color: var(--success); }
.background-result-counts [data-state=failed] { color: var(--danger); }
.background-result-counts [data-state=running] { color: var(--accent); }
.background-result-chevron { transition: transform .12s ease; }
.background-result-notice[open] > summary .background-result-chevron { transform: rotate(180deg); }
.background-result-body { padding: 6px; border-top: 1px solid var(--border-color); max-height: min(420px, 50vh); overflow: auto; overscroll-behavior: contain; }
.background-result-truncated, .background-result-unavailable { margin: 4px; line-height: 1.5; overflow-wrap: anywhere; }
.background-result-truncated { color: var(--warning); }
@media (prefers-reduced-motion: reduce) { .background-result-chevron { transition: none; } }
</style>
