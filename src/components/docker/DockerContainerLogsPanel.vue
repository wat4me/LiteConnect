<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
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
import AppIcon from '../icons/AppIcon.vue'
import VirtualList from '../common/VirtualList.vue'

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
const virtualListRef = ref<{ scrollToIndex: (index: number) => void } | null>(null)
const logKey = (line: DockerLogEntry) => String(line.sequence)
const logSearch = ref('')
const logActiveMatch = ref(0)
let activeMatchSequence: number | null = null
const logCopyFeedback = ref<'idle' | 'ok' | 'fail'>('idle')
const logTailOptions: DockerLogTail[] = [100, 200, 500, 1000]
let logCopyTimer: ReturnType<typeof setTimeout> | null = null
let logViewportWidth = 0
let logViewportHeight = 0

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
  rememberActiveMatch()
}

function goNextLogMatch() {
  logActiveMatch.value = nextInspectMatchIndex(
    logActiveMatch.value,
    logMatchLineIndexes.value.length,
  )
  rememberActiveMatch()
}

function rememberActiveMatch() {
  activeMatchSequence = props.entries[logActiveLineIndex.value]?.sequence ?? null
}

async function scrollToActiveLogMatch() {
  const indexes = logMatchLineIndexes.value
  if (!indexes.length) return
  const lineIdx = indexes[logActiveMatch.value]
  if (lineIdx == null) return
  virtualListRef.value?.scrollToIndex(lineIdx)
  await nextTick()
  if (logActiveLineIndex.value !== lineIdx || !props.active) return
  const el = logScrollEl.value?.querySelector(
    `[data-log-line="${lineIdx}"]`,
  ) as HTMLElement | null
  el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

watch(
  logSearch,
  () => {
    logActiveMatch.value = 0
    activeMatchSequence = null
    if (hasLogQuery.value) emit('set-auto-scroll', false)
  },
)

watch(logMatchLineIndexes, (indexes) => {
  const retained = activeMatchSequence === null ? -1 : indexes.findIndex(index => props.entries[index]?.sequence === activeMatchSequence)
  logActiveMatch.value = retained >= 0 ? retained : Math.min(logActiveMatch.value, Math.max(0, indexes.length - 1))
  rememberActiveMatch()
})

watch(
  () => [logSearch.value, logActiveLineIndex.value, logMatchLineIndexes.value.length, props.active] as const,
  async () => {
    if (!props.active) return
    if (!logMatchLineIndexes.value.length) return
    await nextTick()
    scrollToActiveLogMatch()
  },
)

watch(
  () => [props.entries[props.entries.length - 1]?.sequence, props.droppedCount, props.autoScroll, props.active] as const,
  async () => {
    await nextTick()
    if (!props.active) return
    if (!props.autoScroll) return
    if (hasLogQuery.value) return
    scrollLogsToBottom()
  },
  { immediate: true },
)

function scrollLogsToBottom() {
  const el = logScrollEl.value
  if (!el) return
  logViewportWidth = el.clientWidth
  logViewportHeight = el.clientHeight
  virtualListRef.value?.scrollToIndex(props.entries.length - 1)
  el.scrollTop = el.scrollHeight
}

function onRangeResized() {
  if (props.active && props.autoScroll && !hasLogQuery.value) scrollLogsToBottom()
}

function onLogScroll() {
  const el = logScrollEl.value
  if (!el) return
  // Resizing the pane can dispatch a scroll event without user scrolling.
  const resized = el.clientWidth !== logViewportWidth || el.clientHeight !== logViewportHeight
  logViewportWidth = el.clientWidth
  logViewportHeight = el.clientHeight
  if (resized && props.autoScroll && !hasLogQuery.value) {
    scrollLogsToBottom()
    return
  }
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

function onLogAutoScrollChange(e: Event) {
  if ((e.target as HTMLInputElement).checked) jumpToLatest()
  else emit('set-auto-scroll', false)
}

function jumpToLatest() {
  resetSearch()
  emit('set-auto-scroll', true)
  void nextTick(scrollLogsToBottom)
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

onBeforeUnmount(() => {
  if (logCopyTimer) clearTimeout(logCopyTimer)
})
</script>

<template>
  <div class="detail-body logs-body">
    <div class="logs-toolbar">
      <label class="logs-field" :title="t('docker.logs.tailHint')">
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
      <label class="logs-check" :title="t('docker.logs.followHint')">
        <input type="checkbox" :checked="follow" @change="onLogFollowChange" />
        <span>{{ t('docker.logs.follow') }}</span>
      </label>
      <label class="logs-check" :title="t('docker.logs.autoScrollHint')">
        <input type="checkbox" :checked="autoScroll" @change="onLogAutoScrollChange" />
        <span>{{ t('docker.logs.autoScroll') }}</span>
      </label>
      <span class="status-pill logs-status" :class="`tone-${logStatusTone}`" role="status">
        <span class="status-dot" aria-hidden="true"></span>
        {{ logStatusLabel }}
      </span>
    </div>
    <div class="logs-search-row">
      <div class="logs-search-field">
        <input
          v-model="logSearch"
          class="ui-input ui-input-sm logs-search"
          type="text"
          :placeholder="t('docker.logs.search')"
          :aria-label="t('docker.logs.search')"
          @keydown.enter.exact.prevent="goNextLogMatch"
          @keydown.shift.enter.prevent="goPrevLogMatch"
          @keydown.esc="resetSearch"
        />
        <button
          v-if="logSearch"
          type="button"
          class="ui-icon-btn ui-icon-btn-sm ui-icon-btn-ghost ui-icon-btn-close logs-search-clear"
          :title="t('common.clear')"
          :aria-label="t('common.clear')"
          @click="logSearch = ''"
        >
          <AppIcon name="close" size="xs" />
        </button>
      </div>
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
          <AppIcon name="chevron-up" size="xs" />
        </button>
        <button
          type="button"
          class="ui-icon-btn ui-icon-btn-sm ui-icon-btn-ghost"
          :disabled="!logMatchLineIndexes.length"
          :title="t('docker.logs.nextMatch')"
          :aria-label="t('docker.logs.nextMatch')"
          @click="goNextLogMatch"
        >
          <AppIcon name="chevron-down" size="xs" />
        </button>
      </div>
      <div class="logs-actions">
        <button
          type="button"
          class="ui-btn ui-btn-sm ui-btn-ghost"
          :disabled="!entries.length"
          :title="t('docker.logs.clearHint')"
          @click="emit('clear')"
        >
          <AppIcon name="clear" size="xs" />
          {{ t('docker.logs.clear') }}
        </button>
        <button
          type="button"
          class="ui-btn ui-btn-sm ui-btn-ghost"
          :disabled="!entries.length"
          :title="t('docker.logs.copyAllHint')"
          @click="copyLogsAll"
        >
          <AppIcon name="copy" size="xs" />
          {{
            logCopyFeedback === 'ok'
              ? t('docker.logs.copied')
              : logCopyFeedback === 'fail'
                ? t('docker.logs.copyFailed')
                : t('docker.logs.copyAll')
          }}
        </button>
      </div>
    </div>
    <div v-if="droppedCount > 0" class="logs-dropped" aria-live="polite">
      {{ t('docker.logs.dropped', { count: droppedCount }) }}
    </div>
    <div class="logs-viewport">
      <div
        ref="logScrollEl"
        class="logs-scroll"
        role="log"
        aria-live="off"
        tabindex="0"
        :aria-label="t('docker.detail.logs')"
        @scroll="onLogScroll"
      >
        <div v-if="!entries.length" class="logs-empty">
          {{ t('docker.logs.empty') }}
        </div>
        <VirtualList
          ref="virtualListRef"
          :items="entries"
          :item-key="logKey"
          :estimated-size="16"
          :scroll-container="logScrollEl"
          :preserve-anchor="!autoScroll && !hasLogQuery"
          role="presentation"
          @range-resized="onRangeResized"
          v-slot="{ index: idx }"
        >
        <div
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
        </VirtualList>
      </div>
      <button
        v-if="!autoScroll && entries.length"
        type="button"
        class="ui-btn ui-btn-sm logs-jump-latest"
        :title="t('docker.logs.jumpToLatestHint')"
        @click="jumpToLatest"
      >
        <AppIcon name="chevron-down" size="xs" />
        {{ t('docker.logs.jumpToLatest') }}
      </button>
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
  --logs-control-height: var(--control-h-sm);
  --logs-font-size: var(--font-ui-sm);
}

.logs-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  flex-shrink: 0;
}

.logs-field,
.logs-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: var(--logs-control-height);
  font-size: var(--logs-font-size);
  line-height: 1.25;
  color: var(--text-secondary);
  white-space: nowrap;
}

.logs-select {
  width: auto;
  min-width: 72px;
}

.logs-check {
  cursor: pointer;
}

.logs-check input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent);
}

.logs-status {
  margin-left: auto;
  font-size: var(--logs-font-size);
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}

.logs-search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.logs-search-field {
  position: relative;
  flex: 1 1 140px;
  min-width: 100px;
}

.logs-search {
  width: 100%;
  min-width: 0;
  max-width: none;
  padding-right: 34px;
}

.logs-search-clear {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  width: 24px !important;
  height: 24px !important;
}

.logs-nav {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.logs-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.logs-actions .ui-btn {
  font-weight: 500;
}

.logs-viewport {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.logs-jump-latest {
  position: absolute;
  bottom: 12px;
  right: 20px;
  color: var(--accent);
  background: var(--bg-primary);
  border-color: var(--accent);
  box-shadow: 0 2px 8px rgb(0 0 0 / 12%);
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
  overflow-anchor: none;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-tertiary);
  padding: 8px;
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  font-size: 11px;
  line-height: 1.45;
  user-select: text;
  -webkit-user-select: text;
}

.logs-empty {
  color: var(--text-secondary);
  padding: 12px 4px;
}

.log-line {
  min-height: 1.45em;
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
