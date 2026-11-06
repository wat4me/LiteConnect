<script setup lang="ts">
import { computed, onMounted, ref, useId, watch } from 'vue'
import type { AiWorkspaceTarget } from '@shared/aiWorkspace'
import type { SshMcpJobResult, SshMcpJobSummary } from '@shared/mcp/types'
import { useI18n } from 'vue-i18n'
import { useAiBackgroundJobs } from '@/composables/ai/useAiBackgroundJobs'
import { useBackgroundJobClock } from '@/composables/ai/useBackgroundJobClock'
import { useAiTaskFloat } from '@/composables/ai/useAiTaskFloat'
import { useAiFileTransfers } from '@/composables/ai/useAiFileTransfers'
import { ensureTransferListeners, useTransfers } from '@/composables/sftp/useTransfers'
import { backgroundJobElapsedSeconds, formatBackgroundJobDuration } from '@/utils/ai/backgroundJobDuration'
import { backgroundJobState, toolStateKeys } from '@/utils/ai/toolRunPresentation'
import { ElMessage } from 'element-plus/es/components/message/index'
import AppIcon from '../icons/AppIcon.vue'
import AiFileTransfers from './AiFileTransfers.vue'

const props = withDefaults(defineProps<{ sessionId: string; threadId: string; targets?: AiWorkspaceTarget[]; jobIds?: string[]; jobTargets?: Record<string, string>; active?: boolean; layout?: 'sidebar' | 'workspace' }>(), { active: true, layout: 'sidebar' })
const { t } = useI18n()
const panelId = useId()
const { surface, trigger, panel, expanded, rendered, dragging, fits, edge, triggerStyle, panelStyle, close, toggle, pointerDown, pointerMove, pointerUp, cancelDrag, tucked, untuck } = useAiTaskFloat(() => props.active, () => props.layout)
const { items: transfers, active: activeTransfers, progress: transferProgress } = useAiFileTransfers(() => props.sessionId, () => props.threadId, useTransfers(() => props.sessionId))
// Keep progress subscribed even while the floating entry is collapsed or empty.
onMounted(ensureTransferListeners)
const { sessionJobs } = useAiBackgroundJobs(() => props.targets?.map(target => target.sessionId) || props.sessionId, () => props.jobIds)
const runningCount = computed(() => sessionJobs.value.filter(job => job.status === 'running').length)
const scheduledCount = computed(() => sessionJobs.value.filter(job => job.status === 'scheduled').length)
const totalRunning = computed(() => runningCount.value + activeTransfers.value.length)
const taskIcon = computed(() => sessionJobs.value.length ? (!runningCount.value && scheduledCount.value ? 'scheduled-task' : 'background-tasks') : 'transfer')
const heading = computed(() => transfers.value.length
  ? sessionJobs.value.length ? t('ai.taskCenterTitle') : t('ai.fileTransfersTitle')
  : runningCount.value ? t('ai.backgroundTaskCount', { count: runningCount.value })
    : scheduledCount.value ? t('ai.scheduledTaskCount', { count: scheduledCount.value }) : t('ai.backgroundRecentTasks'))
const now = useBackgroundJobClock(() => props.active && (runningCount.value > 0 || scheduledCount.value > 0))
const longestElapsed = computed(() => {
  const seconds = sessionJobs.value.filter(job => job.status === 'running').map(job => backgroundJobElapsedSeconds(job, now.value)).filter((value): value is number => value != null)
  return seconds.length ? formatBackgroundJobDuration(Math.max(...seconds)) : null
})
function durationLabel(job: SshMcpJobSummary) {
  if (job.status === 'scheduled') {
    if (job.awaitingConnection) return t('ai.backgroundAwaitingConnection')
    const remaining = Math.max(0, Math.ceil(((job.dueAt ?? now.value) - now.value) / 1000))
    return t('ai.backgroundDueIn', { time: formatBackgroundJobDuration(remaining) })
  }
  return t(job.status === 'running' ? 'ai.backgroundElapsed' : 'ai.backgroundDuration', { time: formatBackgroundJobDuration(backgroundJobElapsedSeconds(job, now.value)) })
}
const displayedJobs = computed(() => [
  ...sessionJobs.value.filter(job => job.status === 'running'),
  ...sessionJobs.value.filter(job => job.status === 'scheduled').sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0)),
  ...sessionJobs.value.filter(job => job.status !== 'running' && job.status !== 'scheduled').slice(0, 5),
])
const failedCount = computed(() => displayedJobs.value.filter(job => ['failed', 'timeout'].includes(backgroundJobState(job.status, job.exitCode, job.signal))).length
  + transfers.value.filter(([, item]) => item.status === 'partial' || item.status === 'error' && item.error !== t('sftp.transferCancelled')).length)
const overview = computed(() => [
  sessionJobs.value.length ? runningCount.value ? t('ai.backgroundTaskCount', { count: runningCount.value }) : t('ai.backgroundRecentTasks') : '',
  scheduledCount.value ? t('ai.scheduledTaskCount', { count: scheduledCount.value }) : '',
  transfers.value.length ? `${t('ai.fileTransfersTitle')} · ${t(activeTransfers.value.length ? 'ai.fileTransfersRunning' : 'ai.fileTransfersFinished', { count: activeTransfers.value.length || transfers.value.length })}${transferProgress.value == null ? '' : ` · ${transferProgress.value}%`}` : '',
  longestElapsed.value ? t(runningCount.value > 1 ? 'ai.backgroundLongestElapsed' : 'ai.backgroundElapsed', { time: longestElapsed.value }) : '',
  failedCount.value ? t('ai.backgroundAttention', { count: failedCount.value }) : '',
].filter(Boolean).join(' · '))
const opened = ref<Set<string>>(new Set())
const results = ref<Record<string, SshMcpJobResult>>({})
const loading = ref<Record<string, boolean>>({})
const errors = ref<Record<string, string>>({})
const stopping = ref<Record<string, boolean>>({})
const stopErrors = ref<Record<string, string>>({})
let generation = 0
const requests = new Map<string, number>()
/** Jobs already announced, so a waiting schedule or a failure brings the icon back once per state change. */
const awaitedJobs = new Set<string>()
const failedJobs = new Set<string>()

async function stopJob(job: SshMcpJobSummary) {
  if (!(props.jobIds ? props.jobIds.includes(job.jobId) : (props.targets?.map(target => target.sessionId) || [props.sessionId]).includes(job.sessionId)) || (job.status !== 'running' && job.status !== 'scheduled') || stopping.value[job.jobId]) return
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
  awaitedJobs.clear()
  failedJobs.clear()
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
    // A tucked icon comes back when something needs a human: a failure, or a scheduled command that is due but has no connection.
    if (job.status === 'scheduled' && job.awaitingConnection) {
      if (!awaitedJobs.has(job.jobId)) {
        awaitedJobs.add(job.jobId)
        untuck()
        ElMessage.info(t('ai.scheduledAwaitingNotice'))
      }
    } else awaitedJobs.delete(job.jobId)
    const jobState = backgroundJobState(job.status, job.exitCode, job.signal)
    const failed = jobState === 'failed' || jobState === 'timeout'
    if (failed && !failedJobs.has(job.jobId)) {
      failedJobs.add(job.jobId)
      untuck()
    } else if (!failed) failedJobs.delete(job.jobId)
  }
})
const pad = (value: number) => String(value).padStart(2, '0')
function clockLabel(date: Date, showDate: boolean) {
  return `${showDate ? `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` : ''}${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
function timeRange(job: SshMcpJobSummary) {
  const today = new Date().toDateString()
  if (job.status === 'scheduled' && job.dueAt != null) {
    const due = new Date(job.dueAt)
    return t('ai.backgroundDueAt', { time: clockLabel(due, due.toDateString() !== today) })
  }
  const start = new Date(job.startedAt)
  const end = job.finishedAt == null ? undefined : new Date(job.finishedAt)
  const showDate = start.toDateString() !== today || Boolean(end && start.toDateString() !== end.toDateString())
  return end ? `${clockLabel(start, showDate)}–${clockLabel(end, showDate)}` : clockLabel(start, showDate)
}
function fullTimeRange(job: SshMcpJobSummary) {
  if (job.status === 'scheduled' && job.dueAt != null) {
    return `${t('ai.backgroundCreatedAt')} ${new Date(job.startedAt).toLocaleString()} · ${t('ai.backgroundDueAtFull')} ${new Date(job.dueAt).toLocaleString()}`
  }
  return `${t('ai.backgroundStartedAt')} ${new Date(job.startedAt).toLocaleString()}${job.finishedAt == null ? '' : ` · ${t('ai.backgroundFinishedAt')} ${new Date(job.finishedAt).toLocaleString()}`}`
}
</script>

<template>
  <div v-if="sessionJobs.length || transfers.length" v-show="active" ref="surface" class="ai-background-tasks" :style="{ visibility: fits ? undefined : 'hidden' }" :class="{ running: totalRunning > 0, scheduled: !totalRunning && scheduledCount > 0, attention: failedCount > 0, dragging, tucked, 'is-workspace': layout === 'workspace' }" :data-layout="layout" :data-edge="edge">
    <div class="background-float-anchor" :class="{ 'is-tucked': tucked }" :style="triggerStyle">
    <button ref="trigger" type="button" class="background-float-trigger" :class="{ 'is-morphed': rendered }" :title="`${overview}\n${t(tucked ? 'ai.backgroundFloatTucked' : 'ai.backgroundFloatHint')}`" :aria-label="tucked ? `${overview} · ${t('ai.backgroundFloatTucked')}` : overview" :aria-expanded="expanded" :aria-controls="expanded ? panelId : undefined" :aria-hidden="rendered || undefined" :tabindex="rendered ? -1 : 0" aria-haspopup="dialog"
      @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="cancelDrag" @lostpointercapture="cancelDrag" @click="toggle">
      <AppIcon :name="taskIcon" :size="tucked ? 'sm' : 'md'" />
      <span v-if="totalRunning || scheduledCount" class="background-float-count" :class="{ scheduled: !totalRunning }" aria-hidden="true">{{ (totalRunning || scheduledCount) > 99 ? '99+' : (totalRunning || scheduledCount) }}</span>
      <span v-if="failedCount" class="background-float-attention" aria-hidden="true" />
    </button>
    </div>
    <section v-if="rendered" :id="panelId" ref="panel" class="background-popover" :style="panelStyle" role="dialog" :aria-label="t('ai.taskCenterTitle')" :aria-hidden="!expanded || undefined" :inert="!expanded || undefined" tabindex="-1">
    <div class="background-popover-content">
    <header class="background-heading">
      <div class="background-heading-main" data-task-content>
        <span>{{ heading }}</span>
        <span v-if="transfers.length && totalRunning" class="background-heading-elapsed">{{ t('ai.taskCenterRunning', { count: totalRunning }) }}</span>
        <span v-if="longestElapsed" class="background-heading-elapsed" :title="t('ai.backgroundElapsedHint')">{{ t(runningCount > 1 ? 'ai.backgroundLongestElapsed' : 'ai.backgroundElapsed', { time: longestElapsed }) }}</span>
      </div>
      <button type="button" class="ui-icon-btn ui-icon-btn-sm background-heading-close" data-task-content :title="t('ai.taskCenterCollapse')" :aria-label="t('ai.taskCenterCollapse')" @click="close(true)"><AppIcon name="close" size="sm" /></button>
    </header>
    <div class="background-task-body" data-task-content>
    <h3 v-if="sessionJobs.length && transfers.length" class="task-section-heading"><AppIcon name="terminal" size="sm" />{{ t('ai.taskCenterCommands') }}<span>{{ runningCount ? t('ai.taskCenterRunning', { count: runningCount }) : t('ai.backgroundRecentTasks') }}</span></h3>
    <ul v-if="sessionJobs.length">
      <li v-for="job in displayedJobs" :key="job.jobId" :data-status="backgroundJobState(job.status, job.exitCode, job.signal)">
        <details class="background-job tool-run" :open="opened.has(job.jobId)" @toggle="onToggle(job, $event)">
          <summary class="tool-run-head">
            <AppIcon name="chevron-right" size="xs" class="details-chevron" />
            <span class="background-job-main">
              <span v-if="targets" class="tool-run-name background-job-host" :title="jobTargets?.[job.jobId] || targets.find(target => target.sessionId === job.sessionId)?.name">{{ jobTargets?.[job.jobId] || targets.find(target => target.sessionId === job.sessionId)?.name }}</span>
              <span class="background-job-kind" role="img" :title="t(job.status === 'scheduled' ? 'ai.toolScheduled' : 'ai.toolName.exec')" :aria-label="t(job.status === 'scheduled' ? 'ai.toolScheduled' : 'ai.toolName.exec')"><AppIcon :name="job.status === 'scheduled' ? 'scheduled-task' : 'terminal'" size="sm" /></span>
              <code class="tool-run-desc" :title="job.command">{{ job.command }}</code>
              <span v-if="job.note" class="background-job-note" :title="job.note">{{ job.note }}</span>
            </span>
            <span class="tool-run-outcome">
              <span class="tool-run-state">{{ t(toolStateKeys[backgroundJobState(job.status, job.exitCode, job.signal)]) }}</span>
              <span class="background-job-elapsed" :title="fullTimeRange(job)">{{ durationLabel(job) }}</span>
            </span>
            <button v-if="job.status === 'running' || job.status === 'scheduled'" type="button" class="ui-icon-btn ui-icon-btn-sm background-job-stop" :disabled="stopping[job.jobId]" :aria-busy="stopping[job.jobId] || undefined" :title="t(stopping[job.jobId] ? 'ai.backgroundStopping' : job.status === 'scheduled' ? 'ai.backgroundCancelScheduleHint' : 'ai.backgroundStopHint')" :aria-label="stopping[job.jobId] ? t('ai.backgroundStopping') : t(job.status === 'scheduled' ? 'ai.backgroundCancelScheduleLabel' : 'ai.backgroundStopLabel', { command: job.command })" @click.stop.prevent="stopJob(job)"><AppIcon :name="stopping[job.jobId] ? 'refresh' : job.status === 'scheduled' ? 'close' : 'stop'" size="sm" /></button>
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
    <AiFileTransfers v-if="transfers.length" :session-id="sessionId" :thread-id="threadId" :targets="targets" :class="{ 'after-command-tasks': sessionJobs.length }" />
    </div>
    </div>
    </section>
  </div>
</template>

<style scoped>
.ai-background-tasks { position: absolute; z-index: 3; inset: 8px 10px var(--ai-composer-overlay-inset, 150px); pointer-events: none; color: var(--text-secondary); font-size: var(--font-ui-sm); }
.background-float-trigger { position: absolute; display: flex; align-items: center; justify-content: center; box-sizing: border-box; width: 100%; height: 100%; padding: 0; border: 1px solid var(--border-color); border-radius: 50%; background: var(--bg-primary); color: var(--text-secondary); box-shadow: var(--shadow-menu); cursor: grab; touch-action: none; user-select: none; pointer-events: auto; -webkit-app-region: no-drag; }
.background-float-trigger:hover, .background-float-trigger[aria-expanded="true"] { background: var(--bg-secondary); border-color: var(--accent); color: var(--accent); }
.background-float-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.background-float-trigger.is-morphed { visibility: hidden; pointer-events: none; }
/* Tucked size matches TUCKED_SIZE in useAiTaskFloat.ts. Clip to a semicircle so the shadow cannot form a square. */
.background-float-anchor { position: absolute; width: 40px; height: 40px; pointer-events: none; transition: transform .18s ease, width .18s ease, height .18s ease; }
.dragging .background-float-anchor { transition: none; }
.background-float-anchor .background-float-trigger { position: absolute; inset: 0; }
.background-float-anchor.is-tucked { width: 28px; height: 28px; }
.background-float-anchor.is-tucked .background-float-trigger { opacity: .92; box-shadow: none; }
[data-edge="right"] .background-float-anchor.is-tucked { transform: translateX(50%); clip-path: inset(0 50% 0 0 round 14px 0 0 14px); }
[data-edge="left"] .background-float-anchor.is-tucked { transform: translateX(-50%); clip-path: inset(0 0 0 50% round 0 14px 14px 0); }
[data-edge="bottom"] .background-float-anchor.is-tucked { transform: translateY(50%); clip-path: inset(0 0 50% 0 round 14px 14px 0 0); }
[data-edge="top"] .background-float-anchor.is-tucked { transform: translateY(-50%); clip-path: inset(50% 0 0 0 round 0 0 14px 14px); }
@media (prefers-reduced-motion: reduce) { .background-float-anchor { transition: none; } }
[data-edge="right"] .is-tucked .background-float-count { top: 1px; right: auto; left: 1px; }
[data-edge="left"] .is-tucked .background-float-count { top: 1px; right: 1px; }
[data-edge="bottom"] .is-tucked .background-float-count { top: 1px; right: 1px; }
[data-edge="top"] .is-tucked .background-float-count { top: auto; right: 1px; bottom: 1px; }
[data-edge="left"] .is-tucked .background-float-attention { left: auto; right: 0; }
[data-edge="bottom"] .is-tucked .background-float-attention { bottom: auto; top: 0; }
.dragging .background-float-trigger { cursor: grabbing; }
.running .background-float-trigger { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color)); background: var(--bg-primary); }
.scheduled .background-float-trigger { border-style: dashed; }
.background-float-count.scheduled { background: var(--text-secondary); }
.background-job-note { display: block; width: 100%; color: var(--text-secondary); font-size: var(--font-caption); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Keep the collapsed task row to one line; the note belongs to the opened details. */
.background-job:not([open]) .background-job-note { display: none; }
.attention:not(.running) .background-float-trigger { color: var(--danger); }
.background-float-count { position: absolute; top: -4px; right: -4px; display: flex; align-items: center; justify-content: center; min-width: 17px; height: 17px; padding: 0 3px; box-sizing: border-box; border-radius: 9px; border: 2px solid var(--bg-primary); background: var(--accent); color: #fff; font-size: 10px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; }
.background-float-attention { position: absolute; bottom: 0; left: 0; width: 8px; height: 8px; border: 2px solid var(--bg-primary); border-radius: 50%; background: var(--danger); }
.background-popover { --font-ui-sm: calc(11px * var(--ui-font-scale)); --font-caption: calc(10px * var(--ui-font-scale)); position: absolute; display: flex; flex-direction: column; box-sizing: border-box; min-height: 0; border: 1px solid var(--border-color); border-radius: var(--radius-lg, 12px); background: var(--bg-primary); color: var(--text-secondary); font-size: var(--font-ui-sm); box-shadow: var(--shadow-menu); overflow: hidden; pointer-events: auto; outline: none; -webkit-app-region: no-drag; }
.background-popover:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.background-popover-content { display: flex; flex: 1; flex-direction: column; min-height: 0; width: calc(var(--task-panel-width) - 2px); max-width: none; }
.background-heading { display: flex; flex-shrink: 0; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
.background-heading-main { display: flex; flex: 1; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; min-width: 0; color: var(--text-primary); font-weight: 600; }
summary { display: flex; align-items: center; gap: 6px; list-style: none; cursor: pointer; line-height: 1.4; }
summary::-webkit-details-marker { display: none; }
.background-heading-elapsed { color: var(--text-secondary); font-size: var(--font-caption); font-variant-numeric: tabular-nums; font-weight: 400; }
.background-task-body { min-height: 0; padding: 6px; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-gutter: stable; }
.task-section-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; padding: 8px 4px; color: var(--text-primary); font-size: var(--font-ui-sm); font-weight: 500; }
.task-section-heading > span { margin-left: auto; color: var(--text-secondary); font-size: var(--font-caption); font-weight: 400; }
.after-command-tasks { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color); }
ul { list-style: none; padding: 0; margin: 0; }
li { min-width: 0; color: var(--text-secondary); }
.tool-run-head { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto auto; align-items: center; min-height: 24px; padding: var(--space-1); font-weight: 500; column-gap: 6px; }
.tool-run-head > .details-chevron { grid-column: 1; grid-row: 1; }
.background-job-main { grid-column: 2; grid-row: 1; display: flex; align-items: center; gap: 6px; min-width: 0; }
.background-job-kind { display: inline-flex; flex-shrink: 0; align-items: center; color: var(--text-secondary); }
.background-job-main .background-job-host { flex: 0 1 auto; min-width: 0; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.details-chevron { flex-shrink: 0; transition: transform .12s ease; }
.background-job[open] > summary .details-chevron { transform: rotate(90deg); }
.tool-run-name { flex-shrink: 0; line-height: 20px; }
.tool-run-desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; }
.tool-run-outcome { grid-column: 3; grid-row: 1; display: flex; flex-wrap: nowrap; column-gap: var(--space-2); line-height: 20px; font-weight: 400; min-width: 0; }
.background-job-elapsed { max-width: 100%; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--text-secondary); }
.tool-run-state { flex-shrink: 0; white-space: nowrap; }
.background-job-stop { grid-column: 4; grid-row: 1; }
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
</style>
