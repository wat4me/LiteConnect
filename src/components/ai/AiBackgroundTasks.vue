<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AiWorkspaceTarget } from '@shared/aiWorkspace'
import type { SshMcpJobResult, SshMcpJobSummary } from '@shared/mcp/types'
import { useI18n } from 'vue-i18n'
import { useAiBackgroundJobs } from '@/composables/ai/useAiBackgroundJobs'
import { useBackgroundJobClock } from '@/composables/ai/useBackgroundJobClock'
import { backgroundJobElapsedSeconds, formatBackgroundJobDuration } from '@/utils/ai/backgroundJobDuration'
import { backgroundJobState, toolStateKeys } from '@/utils/ai/toolRunPresentation'
import AppIcon from '../icons/AppIcon.vue'

const props = withDefaults(defineProps<{ sessionId: string; targets?: AiWorkspaceTarget[]; jobIds?: string[]; jobTargets?: Record<string, string>; active?: boolean; layout?: 'sidebar' | 'workspace' }>(), { active: true, layout: 'sidebar' })
const { t } = useI18n()
const { sessionJobs } = useAiBackgroundJobs(() => props.targets?.map(target => target.sessionId) || props.sessionId, () => props.jobIds)
const runningCount = computed(() => sessionJobs.value.filter(job => job.status === 'running').length)
const now = useBackgroundJobClock(() => props.active && runningCount.value > 0)
const longestElapsed = computed(() => {
  const seconds = sessionJobs.value.filter(job => job.status === 'running').map(job => backgroundJobElapsedSeconds(job, now.value)).filter((value): value is number => value != null)
  return seconds.length ? formatBackgroundJobDuration(Math.max(...seconds)) : null
})
function durationLabel(job: SshMcpJobSummary) {
  return t(job.status === 'running' ? 'ai.backgroundElapsed' : 'ai.backgroundDuration', { time: formatBackgroundJobDuration(backgroundJobElapsedSeconds(job, now.value)) })
}
const displayedJobs = computed(() => [
  ...sessionJobs.value.filter(job => job.status === 'running'),
  ...sessionJobs.value.filter(job => job.status !== 'running').slice(0, 5),
])
const opened = ref<Set<string>>(new Set())
const results = ref<Record<string, SshMcpJobResult>>({})
const loading = ref<Record<string, boolean>>({})
const errors = ref<Record<string, string>>({})
const stopping = ref<Record<string, boolean>>({})
const stopErrors = ref<Record<string, string>>({})
let generation = 0
const requests = new Map<string, number>()

async function stopJob(job: SshMcpJobSummary) {
  if (!(props.jobIds ? props.jobIds.includes(job.jobId) : (props.targets?.map(target => target.sessionId) || [props.sessionId]).includes(job.sessionId)) || job.status !== 'running' || stopping.value[job.jobId]) return
  const currentGeneration = generation
  stopping.value[job.jobId] = true
  delete stopErrors.value[job.jobId]
  try {
    const response = await window.LiteConnect.mcpCallTool('cancel_job', { jobId: job.jobId })
    if (response.isError) throw new Error(response.content)
  } catch (error) {
    if (generation === currentGeneration) stopErrors.value[job.jobId] = error instanceof Error ? error.message : String(error)
  } finally {
    if (generation === currentGeneration) stopping.value[job.jobId] = false
  }
}

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
  if (!(props.jobIds ? props.jobIds.includes(job.jobId) : (props.targets?.map(target => target.sessionId) || [props.sessionId]).includes(job.sessionId))) return
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
  stopping.value = {}
  stopErrors.value = {}
})
watch(sessionJobs, (jobs, previous) => {
  now.value = Date.now()
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
  <details v-if="sessionJobs.length" class="ai-background-tasks" :class="{ running: runningCount > 0, 'is-workspace': layout === 'workspace' }" :data-layout="layout">
    <summary class="background-heading" :title="t('ai.backgroundTaskHint')">
      <AppIcon name="background-tasks" size="sm" />
      <span>{{ runningCount ? t('ai.backgroundTaskCount', { count: runningCount }) : t('ai.backgroundRecentTasks') }}</span>
      <span v-if="longestElapsed" class="background-heading-elapsed" :title="t('ai.backgroundElapsedHint')">{{ t(runningCount > 1 ? 'ai.backgroundLongestElapsed' : 'ai.backgroundElapsed', { time: longestElapsed }) }}</span>
      <AppIcon name="chevron-down" size="xs" />
    </summary>
    <div class="background-task-body">
    <ul>
      <li v-for="job in displayedJobs" :key="job.jobId" :data-status="backgroundJobState(job.status, job.exitCode)">
        <details class="background-job tool-run" @toggle="onToggle(job, $event)">
          <summary class="tool-run-head">
            <AppIcon name="chevron-right" size="xs" class="details-chevron" />
            <span class="background-job-main">
              <span v-if="targets" class="tool-run-name background-job-host" :title="jobTargets?.[job.jobId] || targets.find(target => target.sessionId === job.sessionId)?.name">{{ jobTargets?.[job.jobId] || targets.find(target => target.sessionId === job.sessionId)?.name }}</span>
              <span class="background-job-kind" role="img" :title="t('ai.toolName.exec')" :aria-label="t('ai.toolName.exec')"><AppIcon name="terminal" size="sm" /></span>
              <code class="tool-run-desc" :title="job.command">{{ job.command }}</code>
            </span>
            <span class="tool-run-outcome">
              <span class="tool-run-state">{{ t(toolStateKeys[backgroundJobState(job.status, job.exitCode)]) }}</span>
              <span class="background-job-elapsed" :title="fullTimeRange(job)">{{ durationLabel(job) }}</span>
            </span>
            <button v-if="job.status === 'running'" type="button" class="ui-icon-btn ui-icon-btn-sm background-job-stop" :disabled="stopping[job.jobId]" :aria-busy="stopping[job.jobId] || undefined" :title="t(stopping[job.jobId] ? 'ai.backgroundStopping' : 'ai.backgroundStopHint')" :aria-label="stopping[job.jobId] ? t('ai.backgroundStopping') : t('ai.backgroundStopLabel', { command: job.command })" @click.stop.prevent="stopJob(job)"><AppIcon :name="stopping[job.jobId] ? 'refresh' : 'stop'" size="sm" /></button>
          </summary>
          <div v-if="opened.has(job.jobId)" class="background-job-detail">
            <div class="tool-run-section-label">{{ t('ai.toolCommand') }}</div>
            <pre class="tool-run-args">{{ job.command }}</pre>
            <div class="background-job-times" :title="fullTimeRange(job)" :aria-label="fullTimeRange(job)">{{ timeRange(job) }}</div>
            <p v-if="loading[job.jobId]" role="status">{{ t('common.loading') }}</p>
            <div v-else-if="errors[job.jobId]" role="alert" class="background-job-error">
              {{ t('ai.backgroundDetailUnavailable') }} {{ errors[job.jobId] }}
              <button type="button" class="ui-icon-btn ui-icon-btn-sm background-job-reload" :title="t('ai.backgroundReload')" :aria-label="t('ai.backgroundReload')" @click="loadDetail(job)"><AppIcon name="refresh" size="sm" /></button>
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
        <p v-if="stopErrors[job.jobId]" class="background-job-error" role="alert">{{ t('ai.backgroundStopFailed') }} {{ stopErrors[job.jobId] }}</p>
      </li>
    </ul>
    </div>
  </details>
</template>

<style scoped>
.ai-background-tasks { flex-shrink: 0; margin: 6px 12px; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-md); color: var(--text-secondary); font-size: var(--font-ui-sm); }
.ai-background-tasks.running { color: var(--accent); background: var(--accent-bg); }
summary { display: flex; align-items: center; gap: 6px; list-style: none; cursor: pointer; line-height: 1.4; }
summary::-webkit-details-marker { display: none; }
.background-heading > span { flex: 1; min-width: 0; }
.background-heading > .background-heading-elapsed { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-caption); font-variant-numeric: tabular-nums; }
.background-task-body { margin-top: 4px; max-height: min(220px, 25vh); overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-gutter: stable; }
ul { list-style: none; padding: 0; margin: 0; }
li { min-width: 0; color: var(--text-secondary); }
.tool-run-head { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; min-height: 24px; padding: var(--space-1); font-weight: 500; column-gap: 6px; row-gap: 2px; }
.tool-run-head > .details-chevron { grid-column: 1; grid-row: 1; }
.background-job-main { grid-column: 2 / -1; grid-row: 1; display: flex; align-items: center; gap: 6px; min-width: 0; }
.background-job-kind { display: inline-flex; flex-shrink: 0; align-items: center; color: var(--text-secondary); }
.background-job-main .background-job-host { flex: 0 1 auto; min-width: 0; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.details-chevron { flex-shrink: 0; transition: transform .12s ease; }
.background-job[open] > summary .details-chevron { transform: rotate(90deg); }
.tool-run-name { flex-shrink: 0; line-height: 20px; }
.tool-run-desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; }
.tool-run-outcome { grid-column: 2; grid-row: 2; display: flex; flex-wrap: wrap; column-gap: var(--space-2); line-height: 20px; font-weight: 400; min-width: 0; }
.background-job-elapsed { max-width: 100%; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--text-secondary); }
.tool-run-state { flex-shrink: 0; white-space: nowrap; }
.background-job-stop { grid-column: 3; grid-row: 2; }
.background-job-stop:hover:not(:disabled) { border-color: var(--danger); color: var(--danger); }
.background-job-stop:disabled { cursor: wait; opacity: .6; }
.background-job-stop[aria-busy="true"] :deep(svg) { animation: background-job-spin 1s linear infinite; }
@keyframes background-job-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .background-job-stop[aria-busy="true"] :deep(svg) { animation: none; } }
.background-job-detail { margin: 2px 0 6px 20px; min-width: 0; }
.tool-run-section-label { margin: 4px 0 2px; font-size: var(--font-caption); font-weight: 600; }
.tool-run-args, .tool-run-out { margin: 0; padding: 6px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--bg-tertiary) 55%, transparent); white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--font-caption); }
.background-job-times { margin-top: 4px; line-height: 1.4; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.background-job-detail p { line-height: 1.5; }
.background-job-error { color: var(--danger); overflow-wrap: anywhere; }
.background-job-reload { margin: 4px; vertical-align: middle; }
.background-job-reload:hover { color: var(--accent); border-color: var(--accent); }
li[data-status="running"] .tool-run-state { color: var(--accent); }
li[data-status="failed"] .tool-run-state, li[data-status="timeout"] .tool-run-state { color: var(--danger); }
@container ai-sidebar (min-width: 600px) {
  .is-workspace .tool-run-head { grid-template-columns: 12px minmax(0, 1fr) auto auto; }
  .is-workspace .background-job-main { grid-column: 2; }
  .is-workspace .tool-run-outcome { grid-column: 3; grid-row: 1; justify-content: flex-end; }
  .is-workspace .background-job-stop { grid-column: 4; grid-row: 1; }
}
</style>
