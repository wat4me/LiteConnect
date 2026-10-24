<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChatItem } from '@/domain/ai/chat'
import { commandExecutionCommand, commandExecutionDetail, commandExecutionRecords, type CommandExecutionRecord } from '@/utils/ai/commandExecutionHistory'
import { createToolRunDisplayCache } from '@/utils/ai/toolRunDisplayCache'
import { toolRunPresentation, toolStateKeys } from '@/utils/ai/toolRunPresentation'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{ messages: ChatItem[]; fallbackTarget?: string; initialRecordKey?: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const titleId = useId()
const panel = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const selectedKey = ref('')
const query = ref('')
const { toolView } = createToolRunDisplayCache()
const records = computed(() => commandExecutionRecords(props.messages))
const visible = computed(() => {
  const text = query.value.trim().toLocaleLowerCase()
  return records.value.filter(record => !text || `${commandExecutionCommand(record.run)} ${record.run.target || ''}`.toLocaleLowerCase().includes(text))
})
const selected = computed(() => visible.value.find(record => record.key === selectedKey.value) || visible.value.at(-1))
const detail = computed(() => selected.value ? commandExecutionDetail(selected.value.run) : undefined)
const presentation = (record: CommandExecutionRecord) => toolRunPresentation(record.run, toolView(record.run).summary, record.streaming)
const state = computed(() => selected.value ? presentation(selected.value).state : undefined)
const noOutputLabel = computed(() => t(state.value === 'running' ? 'ai.execution.outputPending' : state.value === 'started' ? 'ai.execution.backgroundPending' : ['waiting', 'denied', 'blocked', 'invalid'].includes(state.value || '') ? 'ai.execution.notExecuted' : state.value === 'stopped' || state.value === 'timeout' ? 'ai.execution.outputUnavailable' : 'ai.backgroundNoOutput'))
let previousFocus: HTMLElement | null = null

function trapFocus(event: KeyboardEvent) {
  const elements = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]') || [])].filter(element => element.checkVisibility())
  const first = elements[0], last = elements.at(-1)
  if (event.shiftKey && (document.activeElement === first || !panel.value?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(() => {
  previousFocus = document.activeElement as HTMLElement | null
  selectedKey.value = props.initialRecordKey || records.value.at(-1)?.key || ''
  closeButton.value?.focus()
})
onBeforeUnmount(() => { if (previousFocus?.isConnected) void nextTick(() => previousFocus?.focus({ preventScroll: true })) })
</script>

<template>
  <Teleport to="body">
    <div class="execution-history-layer" @click.self="emit('close')" @keydown.esc.stop.prevent="emit('close')">
      <section ref="panel" class="execution-history" role="dialog" aria-modal="true" :aria-labelledby="titleId" @keydown.tab="trapFocus">
        <header class="execution-header">
          <AppIcon name="terminal" size="md" />
          <div><h2 :id="titleId">{{ t('ai.execution.title') }} <span>{{ records.length }}</span></h2><p>{{ t('ai.execution.hint') }}</p></div>
          <button ref="closeButton" type="button" class="ui-icon-btn" :title="t('common.close')" :aria-label="t('ai.execution.close')" @click="emit('close')"><AppIcon name="close" size="sm" /></button>
        </header>
        <div class="execution-layout">
          <nav class="execution-list" :aria-label="t('ai.execution.commands')">
            <label class="execution-search"><AppIcon name="search" size="sm" /><input v-model="query" :placeholder="t('ai.execution.search')" :aria-label="t('ai.execution.search')" /></label>
            <p v-if="!visible.length" class="execution-empty">{{ t(records.length ? 'ai.execution.noMatches' : 'ai.execution.empty') }}</p>
            <button v-for="(record, index) in visible" :key="record.key" type="button" class="execution-item" :class="{ selected: selected?.key === record.key }" :aria-current="selected?.key === record.key ? 'true' : undefined" @click="selectedKey = record.key">
              <span class="execution-item-heading"><span>#{{ index + 1 }}<template v-if="record.run.target"> · {{ record.run.target }}</template></span><span :data-state="presentation(record).state">{{ t(toolStateKeys[presentation(record).state]) }}</span></span>
              <code :title="commandExecutionCommand(record.run)">{{ commandExecutionCommand(record.run) || t('ai.execution.commandUnavailable') }}</code>
            </button>
          </nav>
          <div v-if="selected && detail" class="execution-terminal" tabindex="0" :aria-label="t('ai.execution.output')">
            <div class="execution-terminal-bar"><span>{{ detail.target || fallbackTarget || t('ai.execution.currentServer') }}</span><span v-if="state" :data-state="state">{{ t(toolStateKeys[state]) }}</span></div>
            <div class="execution-output">
              <p v-if="detail.commandTruncated" class="execution-notice">{{ t('ai.execution.commandTruncated') }}</p>
              <pre class="execution-command"><span aria-hidden="true">$ </span>{{ detail.command || t('ai.execution.commandUnavailable') }}</pre>
              <template v-if="detail.structured">
                <pre v-if="detail.stdout" class="execution-stdout">{{ detail.stdout }}</pre>
                <template v-if="detail.stderr"><div class="execution-stream-label">stderr</div><pre class="execution-stderr">{{ detail.stderr }}</pre></template>
                <pre v-if="detail.error" class="execution-stderr">{{ detail.error }}</pre>
                <p v-if="!detail.stdout && !detail.stderr && !detail.error" class="execution-muted">{{ noOutputLabel }}</p>
              </template>
              <pre v-else-if="selected.run.content && !detail.background" class="execution-stdout">{{ toolView(selected.run).body }}</pre>
              <p v-else class="execution-muted">{{ noOutputLabel }}</p>
              <p v-if="detail.truncated" class="execution-notice">{{ t('ai.toolOutputTruncated') }}</p>
              <p v-if="detail.signal" class="execution-muted">{{ t('ai.execution.signal', { signal: detail.signal }) }}</p>
              <p v-if="detail.exitCode !== null" class="execution-exit" :class="{ failed: detail.exitCode !== 0 }">{{ t('ai.execution.exitCode', { code: detail.exitCode }) }}</p>
              <p v-if="state === 'running' || state === 'started'" class="execution-muted">{{ t('ai.execution.savedOutputHint') }}</p>
            </div>
          </div>
          <div v-else class="execution-terminal execution-placeholder"><AppIcon name="terminal" size="2xl" /><p>{{ t('ai.execution.selectCommand') }}</p></div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.execution-history-layer { position: fixed; inset: 0; z-index: var(--z-dialog-blocking); display: grid; place-items: center; padding: 24px; background: var(--overlay-bg); }
.execution-history { display: flex; flex-direction: column; width: min(1040px, 100%); height: min(680px, calc(100dvh - 48px)); min-height: 0; overflow: hidden; border: 1px solid var(--border-color); border-radius: var(--radius-dialog); background: var(--bg-primary); color: var(--text-primary); box-shadow: var(--shadow-dialog); }
.execution-header { display: flex; flex-shrink: 0; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--border-color); }
.execution-header > div { flex: 1; min-width: 0; }
.execution-header h2 { margin: 0; font-size: var(--font-section); }
.execution-header h2 span { margin-left: 6px; color: var(--text-secondary); font-size: var(--font-ui-sm); font-weight: 400; }
.execution-header p { margin: 5px 0 0; color: var(--text-secondary); font-size: var(--font-caption); line-height: 1.5; }
.execution-layout { display: flex; flex: 1; min-height: 0; }
.execution-list { display: flex; flex-direction: column; flex: 0 0 280px; min-width: 0; overflow: auto; border-right: 1px solid var(--border-color); background: var(--bg-secondary); }
.execution-search { display: flex; align-items: center; flex-shrink: 0; gap: 6px; margin: 12px; padding: 7px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); color: var(--text-secondary); background: var(--bg-primary); }
.execution-search input { width: 100%; min-width: 0; padding: 0; border: 0; outline: 0; font: inherit; font-size: var(--font-ui-sm); color: var(--text-primary); background: transparent; }
.execution-search:focus-within { outline: 2px solid var(--accent); }
.execution-item { display: flex; flex-direction: column; gap: 7px; flex-shrink: 0; padding: 12px; border: 0; border-bottom: 1px solid var(--border-color); background: transparent; color: var(--text-primary); text-align: left; cursor: pointer; }
.execution-item:hover { background: var(--hover-bg); }
.execution-item.selected { background: var(--accent-bg); box-shadow: inset 3px 0 var(--accent); }
.execution-item-heading { display: flex; justify-content: space-between; gap: 8px; color: var(--text-secondary); font-size: var(--font-caption); }
.execution-item-heading > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.execution-item-heading > span:last-child { flex-shrink: 0; }
.execution-item code { display: block; max-height: 3em; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-mono); font-size: var(--font-ui-sm); line-height: 1.5; }
.execution-empty { margin: 8px 14px; color: var(--text-secondary); font-size: var(--font-ui-sm); line-height: 1.7; }
.execution-terminal { flex: 1; min-width: 0; min-height: 0; overflow: auto; background: var(--bg-primary); }
.execution-terminal-bar { display: flex; justify-content: space-between; gap: 12px; padding: 12px 18px; border-bottom: 1px solid var(--border-color); color: var(--text-secondary); font-size: var(--font-caption); overflow-wrap: anywhere; }
.execution-terminal-bar > span:last-child { flex-shrink: 0; }
.execution-output { padding: 18px; font-family: var(--font-mono, Consolas, monospace); font-size: var(--font-ui-sm); line-height: 1.7; }
.execution-output pre { margin: 0 0 14px; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4; }
.execution-command { color: var(--accent); }
.execution-command > span { user-select: none; }
.execution-stderr, .execution-exit.failed { color: var(--danger); }
.execution-stream-label, .execution-muted { color: var(--text-secondary); font-size: var(--font-caption); }
.execution-notice { color: var(--warning); font-size: var(--font-caption); }
.execution-exit { color: var(--success); }
[data-state=failed], [data-state=timeout] { color: var(--danger); }
[data-state=running], [data-state=started] { color: var(--accent); }
[data-state=blocked], [data-state=denied], [data-state=waiting], [data-state=invalid] { color: var(--warning); }
.execution-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-secondary); font-size: var(--font-ui-sm); }
.execution-history :is(button, [tabindex]):focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
@media (max-width: 680px) {
  .execution-history-layer { padding: 12px; }
  .execution-history { height: calc(100dvh - 24px); }
  .execution-header { padding: 12px; }
  .execution-layout { flex-direction: column; }
  .execution-list { flex: 0 0 180px; border-right: 0; border-bottom: 1px solid var(--border-color); }
  .execution-output { padding: 12px; }
}
</style>
