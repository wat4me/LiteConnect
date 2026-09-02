<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  buildInspectSegments,
  findInspectMatches,
  inspectMatchDisplay,
  nextInspectMatchIndex,
  prevInspectMatchIndex,
} from '../../composables/docker/inspectJsonSearch'
import {
  dockerLogStateI18nKey,
  type DockerLogsUiState,
} from '../../composables/docker/useDockerContainerLogs'
import type { DockerLogEntry, DockerLogTail, DockerTransportErrorCode } from '../../env.d'

const props = defineProps<{
  entries: DockerLogEntry[]
  droppedCount: number
  streamState: DockerLogsUiState
  streamErrorCode: DockerTransportErrorCode | null | undefined
  tail: DockerLogTail
  follow: boolean
  autoScroll: boolean
  active: boolean
}>()

const emit = defineEmits<{
  (e: 'set-tail', value: DockerLogTail): void
  (e: 'set-follow', value: boolean): void
  (e: 'set-auto-scroll', value: boolean): void
  (e: 'clear'): void
}>()

const { t } = useI18n()
const logScrollEl = ref<HTMLElement | null>(null)
const logSearch = ref('')
const logActiveMatch = ref(0)
const logCopyFeedback = ref<'idle' | 'ok' | 'fail'>('idle')
const logTailOptions: DockerLogTail[] = [100, 200, 500, 1000]
let logCopyTimer: ReturnType<typeof setTimeout> | null = null
let logScrollRaf = 0

const logStatusLabel = computed(() =>
  t(dockerLogStateI18nKey(props.streamState, props.streamErrorCode)),
)

const logStatusTone = computed(() => {
  const s = props.streamState
  if (s === 'streaming') return 'ok'
  if (s === 'connecting') return 'muted'
  if (s === 'ended') return 'muted'
  if (s === 'disconnected' || s === 'error') return 'warn'
  return 'muted'
})

const hasLogQuery = computed(() => logSearch.value.trim().length > 0)

const logMatchLineIndexes = computed(() => {
  const q = logSearch.value.trim()
  if (!q) return [] as number[]
  const needle = q.toLowerCase()
  const out: number[] = []
  for (let i = 0; i < props.entries.length; i++) {
    if (formatLogLineRaw(props.entries[i]).toLowerCase().includes(needle)) {
      out.push(i)
    }
  }
  return out
})

const logMatchLineSet = computed(() => new Set(logMatchLineIndexes.value))

const logActiveLineIndex = computed(() => {
  const indexes = logMatchLineIndexes.value
  if (!indexes.length) return -1
  return indexes[logActiveMatch.value] ?? -1
})

const logMatchUi = computed(() =>
  inspectMatchDisplay(logActiveMatch.value, logMatchLineIndexes.value.length),
)

function formatLogLineRaw(line: { timestamp: string | null; text: string }): string {
  return line.text
}

function logLineSegments(lineIndex: number) {
  const line = props.entries[lineIndex]
  if (!line) return [{ kind: 'text' as const, text: '' }]
  const raw = formatLogLineRaw(line)
  if (!hasLogQuery.value) return [{ kind: 'text' as const, text: raw }]
  return buildInspectSegments(raw, findInspectMatches(raw, logSearch.value))
}

function goPrevLogMatch() {
  logActiveMatch.value = prevInspectMatchIndex(
    logActiveMatch.value,
    logMatchLineIndexes.value.length,
  )
}

function goNextLogMatch() {
  logActiveMatch.value = nextInspectMatchIndex(
    logActiveMatch.value,
    logMatchLineIndexes.value.length,
  )
}

function scrollToActiveLogMatch() {
  const indexes = logMatchLineIndexes.value
  if (!indexes.length) return
  const lineIdx = indexes[logActiveMatch.value]
  if (lineIdx == null) return
  const el = logScrollEl.value?.querySelector(
    `[data-log-line="${lineIdx}"]`,
  ) as HTMLElement | null
  el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

watch(
  () => [logSearch.value, props.entries.length] as const,
  () => {
    logActiveMatch.value = 0
  },
)

watch(
  () => [logActiveMatch.value, logMatchLineIndexes.value.length, props.active] as const,
  async () => {
    if (!props.active) return
    if (!logMatchLineIndexes.value.length) return
    await nextTick()
    scrollToActiveLogMatch()
  },
)

watch(
  () => props.entries.length,
  async () => {
    if (!props.active) return
    if (!props.autoScroll) return
    if (hasLogQuery.value) return
    await nextTick()
    if (logScrollRaf) cancelAnimationFrame(logScrollRaf)
    logScrollRaf = requestAnimationFrame(() => {
      logScrollRaf = 0
      const el = logScrollEl.value
      if (el) el.scrollTop = el.scrollHeight
    })
  },
)

function onLogScroll() {
  const el = logScrollEl.value
  if (!el || !props.follow) return
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight
  if (dist > 48) {
    if (props.autoScroll) emit('set-auto-scroll', false)
  }
}

function onLogTailChange(e: Event) {
  const v = Number((e.target as HTMLSelectElement).value)
  if (v === 100 || v === 200 || v === 500 || v === 1000) {
    emit('set-tail', v)
  }
}

function onLogFollowChange(e: Event) {
  emit('set-follow', (e.target as HTMLInputElement).checked)
}

function toggleLogAutoScroll() {
  const next = !props.autoScroll
  emit('set-auto-scroll', next)
  if (next) {
    void nextTick(() => {
      const el = logScrollEl.value
      if (el) el.scrollTop = el.scrollHeight
    })
  }
}

async function copyLogsAll() {
  const text = props.entries.map(formatLogLineRaw).join('\n')
  if (!text) return
  try {
    await window.LiteConnect.clipboardWriteText(text)
    logCopyFeedback.value = 'ok'
  } catch {
    logCopyFeedback.value = 'fail'
  }
  if (logCopyTimer) clearTimeout(logCopyTimer)
  logCopyTimer = setTimeout(() => {
    logCopyFeedback.value = 'idle'
    logCopyTimer = null
  }, 2000)
}

function resetSearch() {
  logSearch.value = ''
  logActiveMatch.value = 0
}

defineExpose({ resetSearch })
</script>

<template>
  <div class="detail-body logs-body">
    <div class="logs-toolbar">
      <label class="logs-field">
        <span class="logs-field-label">{{ t('docker.logs.tailLabel') }}</span>
        <select
          class="ui-select ui-input-sm logs-select"
          :value="String(tail)"
          :aria-label="t('docker.logs.tailLabel')"
          @change="onLogTailChange"
        >
          <option v-for="n in logTailOptions" :key="n" :value="String(n)">{{ n }}</option>
        </select>
      </label>
      <label class="logs-check">
        <input type="checkbox" :checked="follow" @change="onLogFollowChange" />
        <span>{{ t('docker.logs.follow') }}</span>
      </label>
      <button
        type="button"
        class="ui-btn ui-btn-sm ui-btn-ghost"
        :disabled="!follow"
        @click="toggleLogAutoScroll"
      >
        {{ autoScroll ? t('docker.logs.pauseScroll') : t('docker.logs.resumeScroll') }}
      </button>
      <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" @click="emit('clear')">
        {{ t('docker.logs.clear') }}
      </button>
      <button
        type="button"
        class="ui-btn ui-btn-sm ui-btn-ghost"
        :disabled="!entries.length"
        @click="copyLogsAll"
      >
        {{
          logCopyFeedback === 'ok'
            ? t('docker.logs.copied')
            : logCopyFeedback === 'fail'
              ? t('docker.logs.copyFailed')
              : t('docker.logs.copyAll')
        }}
      </button>
      <span class="status-pill logs-status" :class="`tone-${logStatusTone}`">
        <span class="status-dot" aria-hidden="true"></span>
        {{ logStatusLabel }}
      </span>
    </div>
    <div class="logs-search-row">
      <input
        class="ui-input ui-input-sm ui-grow logs-search"
        type="search"
        v-model="logSearch"
        :placeholder="t('docker.logs.search')"
        :aria-label="t('docker.logs.search')"
      />
      <div v-if="hasLogQuery" class="logs-nav" aria-live="polite">
        <span class="logs-match-count">
          {{
            logMatchLineIndexes.length
              ? t('docker.logs.matchCount', {
                  current: logMatchUi.current,
                  total: logMatchUi.total,
                })
              : t('docker.logs.noMatch')
          }}
        </span>
        <button
          type="button"
          class="ui-icon-btn ui-icon-btn-sm ui-icon-btn-ghost"
          :disabled="!logMatchLineIndexes.length"
          :title="t('docker.logs.prevMatch')"
          :aria-label="t('docker.logs.prevMatch')"
          @click="goPrevLogMatch"
        >
          ↑
        </button>
        <button
          type="button"
          class="ui-icon-btn ui-icon-btn-sm ui-icon-btn-ghost"
          :disabled="!logMatchLineIndexes.length"
          :title="t('docker.logs.nextMatch')"
          :aria-label="t('docker.logs.nextMatch')"
          @click="goNextLogMatch"
        >
          ↓
        </button>
      </div>
    </div>
    <div v-if="droppedCount > 0" class="logs-dropped" aria-live="polite">
      {{ t('docker.logs.dropped', { count: droppedCount }) }}
    </div>
    <div
      ref="logScrollEl"
      class="logs-scroll"
      role="log"
      aria-live="polite"
      @scroll="onLogScroll"
    >
      <div v-if="!entries.length" class="logs-empty">
        {{ t('docker.logs.empty') }}
      </div>
      <div
        v-for="(line, idx) in entries"
        :key="`${line.sequence}-${idx}`"
        class="log-line"
        :class="{
          'log-line-hit': hasLogQuery && logMatchLineSet.has(idx),
          'log-line-active': hasLogQuery && logActiveLineIndex === idx,
        }"
        :data-log-line="idx"
      ><template v-for="(seg, si) in logLineSegments(idx)" :key="si"><span
          v-if="seg.kind === 'match'"
          class="log-hit"
        >{{ seg.text }}</span><span v-else>{{ seg.text }}</span></template></div>
    </div>
  </div>
</template>

<style scoped>
@import './dockerShared.css';

.detail-body.logs-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 10px 12px;
  gap: 8px;
}

.logs-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.logs-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.logs-select {
  width: auto;
  min-width: 72px;
}

.logs-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.logs-search-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logs-search {
  flex: 1;
  min-width: 0;
  max-width: none;
}

.logs-nav {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.logs-match-count {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.logs-dropped {
  font-size: 11px;
  color: var(--warning);
}

.logs-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-tertiary);
  padding: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
}

.logs-empty {
  color: var(--text-secondary);
  padding: 12px 4px;
}

.log-line {
  white-space: pre-wrap;
  word-break: break-word;
}

.log-line-hit {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.log-line-active {
  outline: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
}

.log-hit {
  background: color-mix(in srgb, var(--warning) 35%, transparent);
}
</style>
