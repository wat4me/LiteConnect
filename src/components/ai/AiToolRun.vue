<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiToolRun } from '@shared/types/ai'
import { extractJsonStringField } from '@shared/aiToolRunDisplay'
import { createToolRunDisplayCache } from '@/utils/ai/toolRunDisplayCache'
import { useAiToolNameLabel } from '@/composables/ai/useAiToolNameLabel'
import { splitToolReason } from '@/utils/ai/toolReason'
import { toolRunPresentation, toolStateKeys } from '@/utils/ai/toolRunPresentation'
import AppIcon from '../icons/AppIcon.vue'

const props = withDefaults(defineProps<{ run: AiToolRun; streaming?: boolean; open?: boolean; executionHistoryAvailable?: boolean }>(), { open: undefined })
const emit = defineEmits<{ (event: 'toggle', open: boolean): void; (event: 'view-execution'): void; (event: 'view-knowledge'): void }>()
const { t } = useI18n()
const toolNameLabel = useAiToolNameLabel()
const localOpen = ref(false)
const isOpen = computed(() => props.open ?? localOpen.value)
const { toolView } = createToolRunDisplayCache(t)
const view = computed(() => toolView(props.run))
const presentation = computed(() => toolRunPresentation(props.run, view.value.summary, props.streaming))
const explanation = computed(() => splitToolReason(props.run.reason).explanation)
const description = computed(() => (explanation.value || view.value.hint).replace(/\s+/g, ' ').trim())
const invocationLabel = computed(() => t(extractJsonStringField(props.run.args || '', 'command') ? 'ai.toolCommand' : 'ai.toolParameters'))
const stateLabel = computed(() => t(toolStateKeys[presentation.value.state]))
const detail = computed(() => {
  const state = presentation.value
  return [state.detailKey ? t(state.detailKey, state.detailParams || {}) : '', state.truncated ? t('ai.toolOutputTruncated') : ''].filter(Boolean).join(' · ')
})
function onToggle(event: Event) {
  localOpen.value = (event.currentTarget as HTMLDetailsElement).open
  emit('toggle', localOpen.value)
}
</script>

<template>
      <details
        class="tool-run"
        :data-state="presentation.state"
        :class="{
          error:
            run.status !== 'reclassify' &&
            ['failed', 'timeout', 'denied', 'blocked'].includes(presentation.state),
          reclassify: run.status === 'reclassify',
          pending: presentation.state === 'running',
          ask: run.status === 'ask',
          danger: run.risk === 'destructive' || run.risk === 'privileged' || run.risk === 'forbidden',
        }"
        :open="isOpen"
        @toggle="onToggle($event)"
      >
        <summary class="tool-run-head">
          <AppIcon name="chevron-right" size="xs" class="details-chevron" />
          <span v-if="run.target" class="tool-run-target" :title="run.target">{{ run.target }}</span>
          <span class="tool-run-name" :class="{ 'tool-run-name-flex': run.name === 'knowledge_save' }" :title="toolNameLabel(run.name)">{{ toolNameLabel(run.name) }}</span>
          <span
            v-if="!isOpen && description"
            class="tool-run-desc"
            :title="description"
          >{{ description }}</span>
          <span class="tool-run-outcome" :title="[stateLabel, detail].filter(Boolean).join(' · ')">
            <span class="tool-run-state">{{ stateLabel }}</span>
            <span v-if="detail" class="tool-run-detail">{{ detail }}</span>
          </span>
          <button v-if="run.name === 'knowledge_save' && run.status === 'done' && !run.isError" type="button" class="tool-run-knowledge" :title="t('ai.knowledge.view')" :aria-label="t('ai.knowledge.view')" @click.stop.prevent="emit('view-knowledge')">{{ t('ai.knowledge.view') }}</button>
        </summary>
        <template v-if="isOpen">
        <div v-if="executionHistoryAvailable && run.name === 'exec'" class="tool-run-section"><button type="button" class="ui-btn ui-btn-xs tool-run-view-execution" @click="emit('view-execution')"><AppIcon name="terminal-history" size="xs" />{{ t('ai.execution.view') }}</button></div>
        <div v-if="explanation" class="tool-run-section tool-run-explanation-section">
          <div class="tool-run-section-label">{{ t('ai.toolExplanationLabel') }}</div>
          <div class="tool-run-explanation">{{ explanation }}</div>
        </div>
        <div v-if="view.hint && run.status !== 'denied'" class="tool-run-section">
          <div class="tool-run-section-label">{{ invocationLabel }}</div>
          <pre class="tool-run-args">{{ view.hint }}</pre>
        </div>
        <div v-if="run.diffPreview || (view.body && run.status !== 'denied' && run.status !== 'blocked' && run.status !== 'reclassify') || run.status === 'blocked' || run.status === 'reclassify'" class="tool-run-section">
          <div class="tool-run-section-label">{{ t('ai.toolExecutionResult') }}</div>
          <div v-if="run.diffSummary" class="tool-run-result-summary">{{ run.diffSummary }}</div>
          <pre v-if="run.diffPreview" class="tool-run-out">{{ run.diffPreview }}</pre>
          <pre v-else-if="view.body && run.status !== 'denied' && run.status !== 'blocked' && run.status !== 'reclassify'" class="tool-run-out">{{ view.body }}</pre>
          <div v-else-if="run.status === 'blocked'" class="tool-run-result-summary">{{ t('ai.toolAskForbidden') }}</div>
          <div v-else-if="run.status === 'reclassify'" class="tool-run-result-summary">{{ t('ai.toolReclassifyHint') }}</div>
        </div>
        </template>
      </details>
</template>

<style scoped>
.tool-run-knowledge { flex-shrink: 0; padding: 0 3px; border: none; background: transparent; color: var(--accent); cursor: pointer; font: inherit; }
.tool-run:has(.tool-run-knowledge) .tool-run-outcome { flex-shrink: 0; }
.tool-run-target { min-width: 0; max-width: min(200px, 25%); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--accent); font-size: 10px; }
.tool-run-view-execution { display: inline-flex; align-items: center; gap: 5px; }
.tool-run {
  padding: 1px 0;
  border: none;
  border-radius: 0;
  background: transparent;
  font-size: 11px;
  color: var(--text-secondary);
}

.tool-run.error .tool-run-head {
  color: var(--danger);
}
.tool-run.error .tool-run-state { color: var(--danger); }
.tool-run.reclassify .tool-run-state { color: var(--warning); }
.tool-run[data-state=completed] .tool-run-state { color: var(--success); }

.tool-run.reclassify .tool-run-head {
  color: var(--warning);
}

.tool-run.danger.ask .tool-run-name {
  color: var(--danger);
}

.tool-run.ask .tool-run-name {
  color: var(--accent);
}

.tool-run.pending .tool-run-state {
  color: var(--accent);
}

.tool-run > summary {
  cursor: pointer;
  list-style: none;
  border-radius: 5px;
}

.tool-run > summary:hover {
  background: var(--hover-bg);
}

.tool-run > summary::-webkit-details-marker,
.tool-run > summary::marker {
  display: none;
  content: '';
}

.tool-run-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 24px;
  padding: 1px 4px;
  font-weight: 500;
  color: var(--text-secondary);
}

.tool-run-name {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  line-height: 20px;
  color: color-mix(in srgb, var(--text-secondary) 88%, transparent);
}
.tool-run-name-flex { display: block; flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.details-chevron {
  flex-shrink: 0;
  color: var(--text-secondary);
  transition: transform 0.12s ease;
}

.tool-run[open] > summary .details-chevron {
  transform: rotate(90deg);
}

.tool-run-risk {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 500;
  padding: 0 4px;
  border-radius: 999px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-tertiary) 70%, transparent);
}

.tool-run-risk[data-risk='destructive'],
.tool-run-risk[data-risk='privileged'],
.tool-run-risk[data-risk='forbidden'] {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.tool-run-desc {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 20px;
  font-weight: 400;
  color: color-mix(in srgb, var(--text-secondary) 85%, transparent);
  cursor: help;
}

.tool-run-hint {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 400;
  color: var(--text-secondary);
}

.tool-run-outcome {
  margin-left: auto;
  display: flex;
  flex: 0 1 auto;
  min-width: 0;
  align-items: center;
  white-space: nowrap;
  justify-content: flex-end;
  column-gap: 6px;
}

.tool-run-detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-secondary);
  font-weight: 400;
  line-height: 20px;
}

.tool-run-state {
  flex-shrink: 0;
  max-width: none;
  overflow: visible;
  text-overflow: clip;
  white-space: nowrap;
  line-height: 20px;
  color: var(--text-secondary);
  font-weight: 400;
}

.tool-ask-copy {
  margin: 2px 0 0 20px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-secondary);
  font-weight: 400;
}

.tool-run-section {
  margin: 5px 0 2px 20px;
  min-width: 0;
}

.tool-run-section-label {
  margin-bottom: 3px;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 600;
}

.tool-run-result-summary {
  margin-bottom: 3px;
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 1.4;
}

.tool-run-explanation,
.tool-run-args,
.tool-run-out {
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-tertiary) 55%, transparent);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  max-height: 280px;
  overflow: auto;
}

.tool-run-explanation {
  font-family: inherit;
  font-size: 11px;
  line-height: 1.45;
}

.tool-run-args,
.tool-run-out {
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  font-size: 10px;
  line-height: 1.4;
}


.tool-run { min-width: 0; }
.tool-run > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
