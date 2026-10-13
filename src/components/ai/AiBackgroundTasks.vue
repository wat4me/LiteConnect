<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SshMcpJobResult, SshMcpJobSummary } from '@shared/mcp/types'
import { useI18n } from 'vue-i18n'
import { useAiBackgroundJobs } from '@/composables/ai/useAiBackgroundJobs'
import { backgroundJobState, toolStateKeys } from '@/utils/ai/toolRunPresentation'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{ sessionId: string }>()
const { t } = useI18n()
const { sessionJobs, runningCount } = useAiBackgroundJobs(() => props.sessionId)
const displayedJobs = computed(() => [
  ...sessionJobs.value.filter(job => job.status === 'running'),
  ...sessionJobs.value.filter(job => job.status !== 'running').slice(0, 5),
])
const opened = ref<Set<string>>(new Set())
const results = ref<Record<string, SshMcpJobResult>>({})
const loading = ref<Record<string, boolean>>({})
const errors = ref<Record<string, string>>({})
let generation = 0
const requests = new Map<string, number>()

async function loadDetail(job: SshMcpJobSummary) {
  const currentGeneration = generation
  const request = (requests.get(job.jobId) || 0) + 1
  requests.set(job.jobId, request)
  loading.value[job.jobId] = true
  delete errors.value[job.jobId]
  const current = () => generation === currentGeneration && requests.get(job.jobId) === request
  try {
    const response = await window.LiteConnect.mcpCallTool('get_job', { jobId: job.jobId })
    if (!current()) return
    if (response.isError) throw new Error(response.content)
    const result = response.structuredContent as SshMcpJobResult
    if (result.jobId !== job.jobId || result.sessionId !== job.sessionId) throw new Error(t('ai.backgroundDetailUnavailable'))
    results.value[job.jobId] = result
  } catch (error) {
    if (current()) errors.value[job.jobId] = error instanceof Error ? error.message : String(error)
  } finally {
    if (current()) loading.value[job.jobId] = false
  }
}

function onToggle(job: SshMcpJobSummary, event: Event) {
  if (job.sessionId !== props.sessionId) return
  if ((event.target as HTMLDetailsElement).open) {
    opened.value.add(job.jobId)
    void loadDetail(job)
  } else opened.value.delete(job.jobId)
}

watch(() => props.sessionId, () => {
  generation++
  requests.clear()
  opened.value.clear()
  results.value = {}
  errors.value = {}
  loading.value = {}
})
watch(sessionJobs, (jobs, previous) => {
  for (const job of jobs) {
    const old = previous?.find(item => item.jobId === job.jobId)
    if (opened.value.has(job.jobId) && (!old || old.status !== job.status || old.finishedAt !== job.finishedAt || old.exitCode !== job.exitCode)) void loadDetail(job)
  }
})
function timeRange(job: SshMcpJobSummary) {
  const start = new Date(job.startedAt)
  const end = job.finishedAt == null ? undefined : new Date(job.finishedAt)
  const today = new Date().toDateString()
  const showDate = start.toDateString() !== today || (end && start.toDateString() !== end.toDateString())
  const pad = (value: number) => String(value).padStart(2, '0')
  const format = (date: Date) => `${showDate ? `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` : ''}${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return end ? `${format(start)}–${format(end)}` : format(start)
}
function fullTimeRange(job: SshMcpJobSummary) {
  return `${t('ai.backgroundStartedAt')} ${new Date(job.startedAt).toLocaleString()}${job.finishedAt == null ? '' : ` · ${t('ai.backgroundFinishedAt')} ${new Date(job.finishedAt).toLocaleString()}`}`
}
</script>

<template>
  <details v-if="sessionJobs.length" class="ai-background-tasks" :class="{ running: runningCount > 0 }">
    <summary class="background-heading" :title="t('ai.backgroundTaskHint')">
      <AppIcon name="activity" size="sm" />
      <span>{{ runningCount ? t('ai.backgroundTaskCount', { count: runningCount }) : t('ai.backgroundRecentTasks') }}</span>
      <AppIcon name="chevron-down" size="xs" />
    </summary>
    <div class="background-task-body">
    <ul>
      <li v-for="job in displayedJobs" :key="job.jobId" :data-status="backgroundJobState(job.status, job.exitCode)">
        <details class="background-job tool-run" @toggle="onToggle(job, $event)">
          <summary class="tool-run-head">
            <AppIcon name="chevron-right" size="xs" class="details-chevron" />
            <span class="tool-run-name">{{ t('ai.toolName.exec') }}</span>
            <code class="tool-run-desc" :title="job.command">{{ job.command }}</code>
            <span class="tool-run-outcome">
              <span class="tool-run-state">{{ t(toolStateKeys[backgroundJobState(job.status, job.exitCode)]) }}</span>
              <span v-if="job.exitCode != null && job.exitCode !== 0" class="tool-run-detail">{{ t('ai.toolSummaryExitHint', { code: job.exitCode }) }}</span>
            </span>
          </summary>
          <div v-if="opened.has(job.jobId)" class="background-job-detail">
            <div class="tool-run-section-label">{{ t('ai.toolCommand') }}</div>
            <pre class="tool-run-args">{{ job.command }}</pre>
            <div class="background-job-times" :title="fullTimeRange(job)" :aria-label="fullTimeRange(job)">{{ timeRange(job) }}</div>
            <p v-if="loading[job.jobId]" role="status">{{ t('common.loading') }}</p>
            <div v-else-if="errors[job.jobId]" role="alert" class="background-job-error">
              {{ t('ai.backgroundDetailUnavailable') }} {{ errors[job.jobId] }}
              <button type="button" @click="loadDetail(job)">{{ t('ai.backgroundReload') }}</button>
            </div>
            <template v-else-if="results[job.jobId]">
              <p v-if="job.status === 'running'">{{ t('ai.backgroundOutputPending') }}</p>
              <p v-if="results[job.jobId].truncated">{{ t('ai.toolOutputTruncated') }}</p>
              <template v-for="field in (['stdout', 'stderr', 'error', 'signal'] as const)" :key="field">
                <template v-if="results[job.jobId][field]">
                  <div class="tool-run-section-label">{{ t(`ai.backgroundResult.${field}`) }}</div>
                  <pre class="tool-run-out" :class="{ 'background-job-error': field === 'error' }">{{ results[job.jobId][field] }}</pre>
                </template>
              </template>
              <p v-if="job.status !== 'running' && !results[job.jobId].stdout && !results[job.jobId].stderr && !results[job.jobId].error && !results[job.jobId].signal">{{ t('ai.backgroundNoOutput') }}</p>
            </template>
          </div>
        </details>
      </li>
    </ul>
    </div>
  </details>
</template>

<style scoped>
.ai-background-tasks { flex-shrink: 0; margin: 6px 12px; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-secondary); font-size: 11px; }
.ai-background-tasks.running { color: var(--accent); background: var(--accent-bg); }
summary { display: flex; align-items: center; gap: 6px; list-style: none; cursor: pointer; line-height: 1.4; }
summary::-webkit-details-marker { display: none; }
.background-heading > span { flex: 1; min-width: 0; }
.background-task-body { margin-top: 4px; max-height: min(220px, 25vh); overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-gutter: stable; }
ul { list-style: none; padding: 0; margin: 0; }
li { min-width: 0; color: var(--text-secondary); }
.tool-run-head { min-height: 24px; padding: 1px 4px; font-weight: 500; }
.details-chevron { flex-shrink: 0; transition: transform .12s ease; }
.background-job[open] > summary .details-chevron { transform: rotate(90deg); }
.tool-run-name { flex-shrink: 0; line-height: 20px; }
.tool-run-desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; }
.tool-run-outcome { margin-left: auto; display: flex; flex-wrap: wrap; justify-content: flex-end; column-gap: 6px; line-height: 20px; font-weight: 400; }
.tool-run-state { flex-shrink: 0; white-space: nowrap; }
.background-job-detail { margin: 2px 0 6px 20px; min-width: 0; }
.tool-run-section-label { margin: 4px 0 2px; font-size: 10px; font-weight: 600; }
.tool-run-args, .tool-run-out { margin: 0; padding: 6px 8px; border: 1px solid var(--border-color); border-radius: 6px; background: color-mix(in srgb, var(--bg-tertiary) 55%, transparent); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
.background-job-times { margin-top: 4px; line-height: 1.4; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.background-job-detail p { line-height: 1.5; }
.background-job-error { color: var(--danger); overflow-wrap: anywhere; }
.background-job-error button { margin: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-tertiary); color: var(--text-primary); cursor: pointer; }
li[data-status="running"] .tool-run-state { color: var(--accent); }
li[data-status="failed"] .tool-run-state, li[data-status="timeout"] .tool-run-state { color: var(--danger); }
</style>
