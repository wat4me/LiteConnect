<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Connection } from '@shared/types/connection'
import type { AiSettings } from '@shared/types/ai'
import type { AiSchedule, AiScheduleHostRun, AiScheduleRun, AiScheduleSnapshot } from '@shared/aiSchedules'
import { aiScheduleConnectionIds, validateAiSchedule } from '@shared/aiSchedules'
import { appConfirm } from '@/composables/app/useAppDialog'
import AiNotificationSettings from './AiNotificationSettings.vue'
import AiMarkdownBlocks from './AiMarkdownBlocks.vue'
import AiToolRunGroup from './AiToolRunGroup.vue'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps<{ connections: Connection[]; connectionId?: string; createToken?: number; returnToChat?: boolean }>()
const emit = defineEmits<{ (event: 'close'): void }>()
const { t } = useI18n()
const state = ref<AiScheduleSnapshot>({ plans: [], runs: [] })
const aiSettings = ref<AiSettings | null>(null)
const error = ref('')
const working = ref(false)
const starting = ref(false)
const editing = ref(false)
const showNotify = ref(false)
const showRuntime = ref(false)
const selectedId = ref('')
const expandedRunId = ref('')
const selectedHostId = ref('')
const form = reactive({
  id: undefined as string | undefined, name: '', connectionId: props.connectionId || '', prompt: '', intervalMinutes: 60, enabled: true,
  kind: 'interval' as 'interval' | 'daily' | 'weekly', time: '09:00', weekday: 1, connectionIds: [] as string[],
  modelKey: '', concurrency: 1,
})
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const weekdays = [1, 2, 3, 4, 5, 6, 0]
const concurrencyOptions = [1, 2, 3, 5]
const active = computed(() => state.value.runs.some(run => run.status === 'running' || (run.status === 'cancelled' && run.finishedAt == null)))
const runs = computed(() => state.value.runs.filter(run => !selectedId.value || run.scheduleId === selectedId.value).slice(0, 30))
const modelOptions = computed(() => {
  const groups: { providerId: string; providerName: string; models: { id: string; label: string; key: string }[] }[] = []
  for (const provider of aiSettings.value?.providers || []) {
    const models = (provider.models || []).map(model => ({
      id: model.id,
      label: model.displayName || model.id,
      key: `${provider.id}\0${model.id}`,
    })).filter(model => model.id)
    if (models.length) groups.push({ providerId: provider.id, providerName: provider.name || provider.id, models })
  }
  return groups
})
let disposed = false
let revision = 0
let unsubscribe: (() => void) | undefined
function host(id: string) { return props.connections.find(connection => connection.id === id)?.name || t('ai.schedule.deletedHost') }
function targetIds(plan: AiSchedule) { return aiScheduleConnectionIds(plan) }
function targetNames(plan: AiSchedule) { return targetIds(plan).map(host) }
function time(value: number) {
  const date = new Date(value)
  const today = date.toDateString() === new Date().toDateString()
  return today ? `${t('ai.today')} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } as const : {}) })
}
function modelKey(providerId?: string, model?: string) { return providerId && model ? `${providerId}\0${model}` : '' }
function parseModelKey(value: string) {
  if (!value) return { providerId: undefined as string | undefined, model: undefined as string | undefined }
  const split = value.indexOf('\0')
  if (split < 0) return { providerId: undefined, model: undefined }
  return { providerId: value.slice(0, split), model: value.slice(split + 1) }
}
function timingLabel(plan: AiSchedule) {
  const timing = plan.timing
  if (!timing || timing.kind === 'interval') return t('ai.schedule.everyMinutes', { count: plan.intervalMinutes })
  return timing.kind === 'daily' ? t('ai.schedule.dailyAt', { time: timing.time })
    : t('ai.schedule.weeklyAt', { day: t(`ai.schedule.weekday.${timing.weekday}`), time: timing.time })
}
function modelLabel(plan: AiSchedule) {
  if (!plan.providerId || !plan.model) return t('ai.schedule.modelDefault')
  const provider = modelOptions.value.find(group => group.providerId === plan.providerId)
  const model = provider?.models.find(item => item.id === plan.model)
  return provider ? `${provider.providerName} · ${model?.label || plan.model}` : t('ai.schedule.modelMissing')
}
function concurrencyLabel(plan: AiSchedule) {
  return t(plan.concurrency && plan.concurrency > 1 ? 'ai.schedule.parallelHosts' : 'ai.schedule.serialHosts', { count: plan.concurrency || 1 })
}
function plainPreview(content?: string) {
  if (!content) return ''
  return content.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~\-\[\]()!]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
}
function runStatusLabel(run: AiScheduleRun) {
  return run.status === 'cancelled' && run.finishedAt == null ? t('ai.backgroundStopping') : t(`ai.schedule.status.${run.status}`)
}
function hostCounts(run: AiScheduleRun) {
  const hosts = run.hosts || []
  if (!hosts.length) return ''
  const failed = hosts.filter(item => item.status === 'failed').length
  const completed = hosts.filter(item => item.status === 'completed').length
  const cancelled = hosts.filter(item => item.status === 'cancelled').length
  const running = hosts.filter(item => item.status === 'running' || item.status === 'queued').length
  const parts = []
  if (failed) parts.push(t('ai.schedule.countFailed', { count: failed }))
  if (completed) parts.push(t('ai.schedule.countCompleted', { count: completed }))
  if (cancelled) parts.push(t('ai.schedule.countStopped', { count: cancelled }))
  if (running) parts.push(t('ai.schedule.countRunning', { count: running }))
  return parts.join(' · ')
}
function sortedHosts(run: AiScheduleRun): AiScheduleHostRun[] {
  const rank: Record<string, number> = { failed: 0, running: 1, queued: 2, completed: 3, cancelled: 4 }
  const healthRank = { critical: 0, warning: 1, unknown: 2, healthy: 3 }
  return [...(run.hosts || [])].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || healthRank[a.health || 'unknown'] - healthRank[b.health || 'unknown'])
}
function selectedHost(run: AiScheduleRun) {
  return sortedHosts(run).find(item => item.connectionId === selectedHostId.value) || sortedHosts(run)[0]
}
function toggleRun(run: AiScheduleRun) {
  if (expandedRunId.value === run.id) {
    expandedRunId.value = ''
    return
  }
  expandedRunId.value = run.id
  selectedHostId.value = sortedHosts(run).find(item => item.status === 'failed')?.connectionId || sortedHosts(run)[0]?.connectionId || ''
}
async function act(action: () => Promise<unknown>) {
  working.value = true
  error.value = ''
  try { await action() } catch (failure: any) { error.value = failure?.message || t('ai.schedule.operationFailed') }
  finally { working.value = false }
}
function edit(plan?: AiSchedule) {
  showNotify.value = false
  Object.assign(form, plan ? {
    ...plan,
    kind: plan.timing?.kind || 'interval',
    time: plan.timing && plan.timing.kind !== 'interval' ? plan.timing.time : '09:00',
    weekday: plan.timing?.kind === 'weekly' ? plan.timing.weekday : 1,
    modelKey: modelKey(plan.providerId, plan.model),
    concurrency: plan.concurrency && plan.concurrency > 1 ? plan.concurrency : 1,
  } : {
    id: undefined, name: '', connectionId: props.connectionId || props.connections[0]?.id || '', prompt: t('ai.schedule.defaultPrompt'),
    intervalMinutes: 60, enabled: true, kind: 'interval', time: '09:00', weekday: 1, modelKey: '', concurrency: 1,
  })
  form.connectionIds = plan ? aiScheduleConnectionIds(plan) : [form.connectionId].filter(Boolean)
  editing.value = true
}
async function save() {
  await act(async () => {
    const timing = form.kind === 'interval' ? undefined : form.kind === 'daily' ? { kind: 'daily' as const, time: form.time } : { kind: 'weekly' as const, time: form.time, weekday: Number(form.weekday) }
    const selected = parseModelKey(form.modelKey)
    await window.LiteConnect.aiSaveSchedule(validateAiSchedule({
      id: form.id, name: form.name, connectionId: form.connectionIds[0] || '', connectionIds: [...form.connectionIds],
      prompt: form.prompt, intervalMinutes: Number(form.intervalMinutes), timing, enabled: form.enabled,
      providerId: selected.providerId, model: selected.model, concurrency: Number(form.concurrency),
    }))
    editing.value = false
  })
}
async function remove(plan: AiSchedule) {
  try { await appConfirm({ title: t('ai.schedule.deleteTitle'), message: t('ai.schedule.deleteHint', { name: plan.name }), confirmText: t('common.delete'), cancelText: t('common.cancel'), danger: true }) }
  catch { return }
  await act(() => window.LiteConnect.aiRemoveSchedule(plan.id))
}
async function runNow(plan: AiSchedule) {
  if (starting.value || active.value) return
  starting.value = true
  error.value = ''
  try {
    const run = await window.LiteConnect.aiRunSchedule(plan.id)
    expandedRunId.value = run.id
    selectedHostId.value = sortedHosts(run).find(item => item.status === 'failed')?.connectionId || sortedHosts(run)[0]?.connectionId || ''
  } catch (failure: any) { error.value = failure?.message || t('ai.schedule.operationFailed') }
  finally { starting.value = false }
}
function toggle(plan: AiSchedule) { return act(() => window.LiteConnect.aiSaveSchedule(validateAiSchedule({ ...plan, enabled: !plan.enabled }))) }
function stop(id: string) { return act(() => window.LiteConnect.aiStopScheduleRun(id)) }
watch(() => form.connectionIds.length, count => {
  if (count <= 1 && form.concurrency !== 1) form.concurrency = 1
})
watch(() => props.createToken, (token, previous) => {
  if (token && token !== previous) edit()
})
onMounted(async () => {
  unsubscribe = window.LiteConnect.onAiSchedulesChanged(snapshot => {
    revision++
    state.value = snapshot
    if (expandedRunId.value) {
      const run = snapshot.runs.find(item => item.id === expandedRunId.value)
      if (run && !selectedHostId.value) selectedHostId.value = sortedHosts(run)[0]?.connectionId || ''
    }
  })
  const before = revision
  try {
    const [snapshot, settings] = await Promise.all([window.LiteConnect.aiListSchedules(), window.LiteConnect.getAiSettings()])
    if (!disposed) {
      aiSettings.value = settings
      if (revision === before) state.value = snapshot
      if (props.createToken) edit()
    }
  } catch (failure: any) { error.value = failure?.message || t('ai.schedule.operationFailed') }
})
onBeforeUnmount(() => { disposed = true; unsubscribe?.() })
</script>

<template>
  <section class="ai-schedule-panel">
    <header class="schedule-header">
      <div>
        <h2>{{ t('ai.schedule.title') }}</h2>
        <p>{{ t('ai.schedule.hint') }}</p>
      </div>
      <div class="schedule-header-actions">
        <button type="button" class="ui-btn ui-btn-sm" :class="{ active: showNotify }" :aria-pressed="showNotify" @click="showNotify = !showNotify; editing = false"><AppIcon name="bell" size="sm" />{{ t('ai.notification.settings') }}</button>
        <button type="button" class="ui-icon-btn" :aria-label="t('ai.schedule.runtimeTitle')" :aria-expanded="showRuntime" @click="showRuntime = !showRuntime"><AppIcon name="help-circle" size="sm" /></button>
        <button type="button" class="ui-btn ui-btn-sm" @click="emit('close')">{{ t(returnToChat ? 'ai.schedule.exit' : 'ai.workspace.backToHosts') }}</button>
      </div>
    </header>
    <p v-if="showRuntime" class="schedule-runtime-hint">{{ t('ai.schedule.runtimeHint') }}</p>
    <p v-if="error" role="alert" class="schedule-error">{{ error }}</p>
    <AiNotificationSettings v-if="showNotify" :open="true" @close="showNotify = false" />
    <div class="schedule-toolbar">
      <button type="button" class="ui-btn ui-btn-primary ui-btn-sm schedule-new" :disabled="active || working || !connections.length" @click="edit()">{{ t('ai.schedule.create') }}</button>
      <span class="schedule-toolbar-meta">{{ t('ai.schedule.planCount', { count: state.plans.length }) }}</span>
    </div>
    <form v-if="editing" class="schedule-form" @submit.prevent="save">
      <label>{{ t('ai.schedule.name') }}<input v-model="form.name" required maxlength="100" :disabled="working" /></label>
      <fieldset class="schedule-targets"><legend>{{ t('ai.schedule.hosts', { count: form.connectionIds.length }) }}</legend><div><label v-for="connection in connections" :key="connection.id"><input v-model="form.connectionIds" type="checkbox" :value="connection.id" :disabled="working || (form.connectionIds.length >= 10 && !form.connectionIds.includes(connection.id))" /><span>{{ connection.name }} · {{ connection.host }}</span></label></div></fieldset>
      <label>{{ t('ai.schedule.frequency') }}<select v-model="form.kind" class="schedule-kind" :disabled="working"><option value="interval">{{ t('ai.schedule.byInterval') }}</option><option value="daily">{{ t('ai.schedule.daily') }}</option><option value="weekly">{{ t('ai.schedule.weekly') }}</option></select></label>
      <label v-if="form.kind === 'interval'">{{ t('ai.schedule.interval') }}<select v-model="form.intervalMinutes" :disabled="working"><option :value="15">{{ t('ai.schedule.every15') }}</option><option :value="60">{{ t('ai.schedule.everyHour') }}</option><option :value="1440">{{ t('ai.schedule.everyDay') }}</option></select></label>
      <label v-if="form.kind === 'weekly'">{{ t('ai.schedule.onWeekday') }}<select v-model="form.weekday" class="schedule-weekday" :disabled="working"><option v-for="day in weekdays" :key="day" :value="day">{{ t(`ai.schedule.weekday.${day}`) }}</option></select></label>
      <label v-if="form.kind !== 'interval'">{{ t('ai.schedule.atTime') }}<input v-model="form.time" type="time" class="schedule-time" step="60" required :disabled="working" /></label>
      <label>{{ t('ai.schedule.model') }}<select v-model="form.modelKey" :disabled="working"><option value="">{{ t('ai.schedule.modelDefault') }}</option><optgroup v-for="group in modelOptions" :key="group.providerId" :label="group.providerName"><option v-for="model in group.models" :key="model.key" :value="model.key">{{ model.label }}</option></optgroup></select></label>
      <label>{{ t('ai.schedule.concurrency') }}<select v-model.number="form.concurrency" :disabled="working || form.connectionIds.length <= 1"><option v-for="count in concurrencyOptions" :key="count" :value="count" :disabled="count > 1 && form.connectionIds.length <= 1">{{ count === 1 ? t('ai.schedule.serialHosts', { count: 1 }) : t('ai.schedule.parallelHosts', { count }) }}</option></select></label>
      <p v-if="form.kind !== 'interval'" class="schedule-prompt">{{ t('ai.schedule.timeZoneHint', { zone: timeZone }) }}</p>
      <p class="schedule-prompt">{{ t('ai.schedule.modelHint') }}</p>
      <label class="schedule-prompt">{{ t('ai.schedule.prompt') }}<textarea v-model="form.prompt" required maxlength="8000" rows="4" :disabled="working" /></label>
      <div class="schedule-form-actions"><label><input v-model="form.enabled" type="checkbox" :disabled="working" />{{ t('ai.schedule.enable') }}</label><button type="button" class="ui-btn ui-btn-sm" :disabled="working" @click="editing = false">{{ t('common.cancel') }}</button><button type="submit" class="ui-btn ui-btn-primary ui-btn-sm" :disabled="working || active || !form.connectionIds.length">{{ t('common.save') }}</button></div>
    </form>
    <p v-if="!state.plans.length && !editing" class="schedule-empty">{{ t('ai.schedule.empty') }}</p>
    <article v-for="plan in state.plans" :key="plan.id" class="schedule-plan">
      <div class="schedule-plan-main">
        <div class="schedule-plan-title">
          <strong>{{ plan.name }}</strong>
          <span class="schedule-badge" :data-enabled="plan.enabled">{{ t(plan.enabled ? 'ai.schedule.enabled' : 'ai.schedule.paused') }}</span>
        </div>
        <div class="schedule-meta">
          <span>{{ timingLabel(plan) }}</span>
          <span>{{ modelLabel(plan) }}</span>
          <span>{{ concurrencyLabel(plan) }}</span>
          <span>{{ t('ai.schedule.hostCount', { count: targetIds(plan).length }) }}</span>
        </div>
        <div class="schedule-host-chips">
          <span v-for="name in targetNames(plan).slice(0, 6)" :key="name" class="schedule-chip">{{ name }}</span>
          <span v-if="targetNames(plan).length > 6" class="schedule-chip muted">{{ t('ai.schedule.moreHosts', { count: targetNames(plan).length - 6 }) }}</span>
        </div>
        <small v-if="plan.enabled" :title="new Date(plan.nextRunAt).toLocaleString()">{{ t('ai.schedule.nextRun', { time: time(plan.nextRunAt) }) }}</small>
      </div>
      <div class="schedule-actions">
        <button type="button" class="ui-btn ui-btn-primary ui-btn-xs schedule-run" :disabled="active || starting || working" @click="runNow(plan)">{{ t('ai.schedule.runNow') }}</button>
        <button type="button" class="ui-btn ui-btn-xs" :disabled="active || working" @click="toggle(plan)">{{ t(plan.enabled ? 'ai.schedule.pause' : 'ai.schedule.resume') }}</button>
        <button type="button" class="ui-btn ui-btn-xs" :disabled="active || working" @click="edit(plan)">{{ t('ai.schedule.edit') }}</button>
        <button type="button" class="ui-icon-btn ui-icon-btn-sm schedule-delete" :disabled="active || working" :title="t('common.delete')" @click="remove(plan)"><AppIcon name="delete" size="xs" /></button>
      </div>
    </article>
    <div class="schedule-history-heading">
      <h3>{{ t('ai.schedule.history') }}</h3>
      <select v-model="selectedId" :aria-label="t('ai.schedule.filter')"><option value="">{{ t('ai.schedule.allPlans') }}</option><option v-for="plan in state.plans" :key="plan.id" :value="plan.id">{{ plan.name }}</option></select>
    </div>
    <p v-if="!runs.length" class="schedule-empty">{{ t('ai.schedule.noRuns') }}</p>
    <article v-for="run in runs" :key="run.id" class="schedule-result" :data-status="run.status" :data-open="expandedRunId === run.id">
      <button type="button" class="schedule-result-summary" @click="toggleRun(run)">
        <span class="schedule-result-top">
          <span class="schedule-result-title">
            <strong>{{ run.name }}</strong>
            <time :title="new Date(run.startedAt).toLocaleString()">{{ time(run.startedAt) }}</time>
          </span>
          <span class="schedule-result-badges">
            <strong class="schedule-status">{{ runStatusLabel(run) }}</strong>
            <small v-if="run.health" class="schedule-health" :data-health="run.health">{{ t('ai.schedule.healthTitle') }}：{{ t(`ai.schedule.health.${run.health}`) }}</small>
            <small v-if="hostCounts(run)" class="schedule-counts">{{ hostCounts(run) }}</small>
            <small v-if="run.notification?.status === 'failed' || run.notification?.status === 'sending'" class="schedule-error">{{ t(`ai.notification.delivery.${run.notification.status}`) }}</small>
            <AppIcon :name="expandedRunId === run.id ? 'chevron-up' : 'chevron-down'" size="xs" />
          </span>
        </span>
        <p v-if="plainPreview(run.error || run.content)" class="schedule-preview">{{ plainPreview(run.error || run.content) }}</p>
      </button>
      <div v-if="run.status === 'running'" class="schedule-result-stop">
        <button type="button" class="ui-btn ui-btn-xs schedule-stop" :disabled="working" @click="stop(run.id)">{{ t('ai.backgroundStop') }}</button>
      </div>
      <div v-if="expandedRunId === run.id" class="schedule-result-body">
        <p class="schedule-outcome-hint">{{ t('ai.schedule.outcomeHint') }}</p>
        <p v-if="run.error" class="schedule-error">{{ run.error }}</p>
        <p v-if="run.notification && run.notification.status !== 'skipped'" :class="{ 'schedule-error': run.notification.status === 'failed' }">{{ t(`ai.notification.delivery.${run.notification.status}`) }} {{ run.notification.error }}</p>
        <div v-if="run.content" class="schedule-report">
          <h4>{{ t('ai.schedule.reportTitle') }}</h4>
          <AiMarkdownBlocks :content="run.content" />
        </div>
        <p v-if="run.hosts?.some(item => item.truncated)">{{ t('ai.toolOutputTruncated') }}</p>
        <div v-if="run.hosts?.length" class="schedule-host-panel">
          <div class="schedule-host-list" role="tablist" :aria-label="t('ai.schedule.host')">
            <button v-for="item in sortedHosts(run)" :key="item.connectionId" type="button" class="schedule-host-tab" :class="{ active: selectedHost(run)?.connectionId === item.connectionId }" :data-status="item.status" role="tab" :aria-selected="selectedHost(run)?.connectionId === item.connectionId" @click="selectedHostId = item.connectionId">
              <span>{{ item.name }}</span>
              <small>{{ t(`ai.schedule.hostStatus.${item.status}`) }}<template v-if="item.health"> · {{ t(`ai.schedule.health.${item.health}`) }}</template></small>
            </button>
          </div>
          <div v-if="selectedHost(run)" class="schedule-host-detail">
            <p v-if="selectedHost(run)?.error" class="schedule-error">{{ selectedHost(run)?.error }}</p>
            <AiMarkdownBlocks v-if="selectedHost(run)?.content" :content="selectedHost(run)!.content!" />
            <AiToolRunGroup :key="`${run.id}:${selectedHost(run)?.connectionId}`" :runs="selectedHost(run)?.toolRuns || []" />
          </div>
        </div>
        <AiToolRunGroup v-else :key="run.id" :runs="run.toolRuns || []" />
      </div>
    </article>
  </section>
</template>

<style scoped>
.ai-schedule-panel { flex: 1; min-width: 0; min-height: 0; padding: 20px; overflow-y: auto; color: var(--text-primary); }
.schedule-header, .schedule-toolbar, .schedule-history-heading, .schedule-form-actions, .schedule-header-actions, .schedule-plan-title, .schedule-meta, .schedule-actions { display: flex; align-items: center; gap: 10px; }
.schedule-header > div:first-child, .schedule-form-actions > label, .schedule-plan-main { flex: 1; min-width: 0; }
.schedule-header > div:first-child { flex-basis: 300px; }
.schedule-plan-main { flex-basis: 280px; }
h2 { font-size: 18px; margin: 0; } h3, h4 { font-size: 14px; margin: 0; }
p, small, .schedule-toolbar-meta { font-size: 12px; line-height: 1.6; color: var(--text-secondary); }
.schedule-header { flex-wrap: wrap; }
.schedule-header-actions { flex-shrink: 0; flex-wrap: wrap; }
.schedule-header-actions .active { background: var(--accent-bg); color: var(--accent); }
.schedule-toolbar { flex-wrap: wrap; margin: 14px 0 16px; }
.schedule-form, .schedule-plan, .schedule-result { padding: 14px; border: 1px solid var(--border-color); border-radius: 10px; margin-bottom: 10px; background: var(--bg-primary); }
.schedule-form { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; background: var(--bg-secondary); }
.schedule-form > label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.schedule-form input:not([type=checkbox]), select, textarea { box-sizing: border-box; min-width: 0; max-width: 100%; padding: 7px 8px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 5px; font: inherit; font-size: 12px; }
.schedule-prompt, .schedule-form-actions, .schedule-targets { grid-column: 1/-1; }
.schedule-plan { display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
.schedule-plan-title { margin-bottom: 8px; }
.schedule-plan-title strong { font-size: 14px; }
.schedule-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 11px; background: var(--bg-secondary); color: var(--text-secondary); }
.schedule-badge[data-enabled=true] { background: color-mix(in srgb, var(--success) 14%, transparent); color: var(--success); }
.schedule-meta { flex-wrap: wrap; margin-bottom: 8px; color: var(--text-secondary); font-size: 12px; }
.schedule-meta > span:not(:last-child)::after { content: '·'; margin-left: 10px; color: var(--border-color); }
.schedule-host-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.schedule-chip { display: inline-flex; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 3px 8px; border-radius: 999px; background: var(--bg-secondary); border: 1px solid var(--border-color); font-size: 11px; color: var(--text-secondary); }
.schedule-chip.muted { opacity: 0.8; }
.schedule-actions { flex-shrink: 0; flex-wrap: wrap; }
.schedule-delete { color: var(--danger); }
.schedule-history-heading { margin: 24px 0 12px; justify-content: space-between; }
.schedule-result { padding: 0; overflow: hidden; }
.schedule-result-summary { width: 100%; display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; }
.schedule-result-top { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between; }
.schedule-result-title { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: baseline; min-width: 0; }
.schedule-result-title strong { font-size: 13px; }
.schedule-result-badges { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; color: var(--text-secondary); }
.schedule-preview { margin: 0; color: var(--text-secondary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.schedule-result-stop { padding: 0 14px 10px; }
.schedule-result[data-status=failed] .schedule-status, .schedule-error { color: var(--danger); }
.schedule-result[data-status=completed] .schedule-status { color: var(--success); }
.schedule-result[data-status=running] .schedule-status { color: var(--accent); }
.schedule-result-body { padding: 0 14px 14px; border-top: 1px solid var(--border-color); }
.schedule-report { margin-top: 12px; }
.schedule-host-panel { display: grid; grid-template-columns: minmax(180px, 240px) minmax(0, 1fr); gap: 12px; margin-top: 14px; }
.schedule-host-list { display: flex; flex-direction: column; gap: 6px; max-height: 360px; overflow: auto; }
.schedule-host-tab { display: flex; flex-direction: column; gap: 4px; width: 100%; text-align: left; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); color: var(--text-primary); cursor: pointer; font: inherit; font-size: 12px; }
.schedule-host-tab.active { border-color: var(--accent); background: var(--accent-bg); }
.schedule-host-tab[data-status=failed] small { color: var(--danger); }
.schedule-host-tab[data-status=completed] small { color: var(--success); }
.schedule-host-detail { min-width: 0; padding: 10px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); }
pre { max-height: 220px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg-primary); padding: 8px; border-radius: 5px; font-size: 12px; }
.schedule-tool { margin-top: 10px; font-size: 12px; } .schedule-tool summary { cursor: pointer; }
.schedule-targets { min-width: 0; border: 1px solid var(--border-color); border-radius: 6px; padding: 8px; font-size: 12px; }
.schedule-targets > div { max-height: 140px; overflow: auto; }
.schedule-targets label { display: flex; gap: 6px; align-items: flex-start; margin: 4px 0; overflow-wrap: anywhere; }
.schedule-outcome-hint, .schedule-runtime-hint { padding: 8px 10px; border-radius: 6px; background: var(--bg-secondary); }
.schedule-health[data-health=healthy] { color: var(--success); }
.schedule-health[data-health=warning], .schedule-health[data-health=unknown] { color: var(--warning); }
.schedule-health[data-health=critical] { color: var(--danger); }
.schedule-empty { margin: 18px 0; }
@media(max-width:900px) { .schedule-host-panel { grid-template-columns: 1fr; } .schedule-host-list { flex-direction: row; overflow-x: auto; max-height: none; } .schedule-host-tab { min-width: 160px; } }
@media(max-width:760px) { .ai-schedule-panel { padding: 12px; } .schedule-form { grid-template-columns: minmax(0,1fr); } }
</style>
